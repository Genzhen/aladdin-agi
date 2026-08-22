// ═══════════════════════════════════════════════════════════════════
//  server.mjs —— 平台契约壳（端口 9006），和手写版 lib.js 壳对齐
//  唯一区别：brain 不是本文件里的函数，而是 Mastra Agent.generate()
//  （内部含工具调用循环：生成→调 seoScore→按分决策）
//
//  用法：在项目根目录跑 `node agents/title-agent/server.mjs`
//  （cwd 必须是项目根——.env 在那；start-all.js 已经这么启动它）
// ═══════════════════════════════════════════════════════════════════
import http from "node:http";
import { titleAgent } from "./agent.mjs";

const PORT = 9006;
const startedAt = Date.now();

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error("body 超 64KB")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(new Error("body 不是合法 JSON")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true, agent: "title-agent", framework: "mastra", uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
    }
    if (req.method === "GET" && req.url === "/") {
      return sendJson(res, 200, { ok: true, agent: "title-agent", framework: "mastra", usage: 'POST /run {"title":"…","description":"…"}' });
    }
    if (req.method === "POST" && req.url === "/run") {
      const { taskId, title, description, tags } = await readJson(req);
      if (!description || String(description).trim().length < 10) {
        throw new Error("description 太短（≥10 字）——写清内容主题和目标读者");
      }

      // Mastra 0.10 的签名是位置参数：generate(messages, options)
      // （官网示例的 generate({prompt}) 是更新版本——坑同 hardhat 文档漂移）
      const brief = `任务标题：${title || "（未命名）"}\n标签：${tags || "（无）"}\n内容简报：\n${description}`;
      const result = await titleAgent.generate(
        [{ role: "user", content: brief }],
        { maxSteps: 6 } // 工具调用循环预算：生成→seoScore→再生成，6 步足够
      );

      const output = String(result.text || "").trim();
      if (!output) throw new Error("Agent 返回空内容");

      return sendJson(res, 200, {
        ok: true,
        agent: "title-agent",
        type: "markdown",
        output: `${output}\n\n---\n*标题工厂：Title Forge · 框架 Mastra（Agent+seoScore 工具循环）· 引擎 DeepSeek*`,
        meta: { engine: "deepseek-chat", framework: "mastra", usage: result.usage ?? null, taskId },
      });
    }
    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    console.error("⚠️ [title-agent]", e.message); // 失败不静默：ok:false → agent-runner 不上链
    return sendJson(res, 500, { ok: false, agent: "title-agent", error: String(e.message).slice(0, 300) });
  }
});

server.listen(PORT, () => console.log(`🤖 [title-agent] Mastra 执行体就绪 → http://127.0.0.1:${PORT}`));
