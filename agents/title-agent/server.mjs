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
import manifest from "../manifest.js"; // CJS 数组，ESM 默认导入直接可用

const PORT = 9006;
const startedAt = Date.now();

// ── 自报到（与手写版 lib.js 同款，ESM 版）：启动登记 + 30s 心跳 ──
// node:http 直连 127.0.0.1，不受系统代理环境变量影响（坑#4/#11）
function postJson(url, obj, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(obj);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error("报到响应不是 JSON")); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("报到超时")));
    req.on("error", reject);
    req.end(payload);
  });
}

async function announceLoop() {
  const self = manifest.find((m) => m.port === PORT);
  const api = process.env.ALADDIN_API_URL || "http://127.0.0.1:3001";
  const endpoint = `http://127.0.0.1:${PORT}`;
  let up = false;
  for (;;) {
    try {
      const r = await postJson(`${api}/api/executors/announce`, { chainName: self.chainName, endpoint });
      if (r.ok !== true) throw new Error(r.error || "平台拒绝报到");
      if (!up) {
        up = true;
        console.log(`📡 [title-agent] 已向平台报到：${self.chainName} @ ${endpoint}${r.wired ? "，自动接线完成" : "（链上还没挂牌，挂上即接）"}`);
      }
    } catch (e) {
      if (up) { up = false; console.warn(`⚠️ [title-agent] 心跳失联，转 5s 重试：${e.message}`); }
      else console.warn(`⏳ [title-agent] 平台未就绪，5s 后再报到：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, up ? 30_000 : 5_000));
  }
}

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

server.listen(PORT, () => {
  console.log(`🤖 [title-agent] Mastra 执行体就绪 → http://127.0.0.1:${PORT}`);
  announceLoop(); // 自报到 + 心跳（.env 的 ALADDIN_API_URL 可覆盖平台地址；默认本机 3001）
});
