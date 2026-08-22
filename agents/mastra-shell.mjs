// ═══════════════════════════════════════════════════════════════════
//  mastra-shell.mjs —— Mastra 执行体共享契约壳（ESM）
//
//  第三个 Mastra 执行体出现时从 title-agent/server.mjs 抽出：
//  HTTP 三端点（/health / /run）+ 自报到心跳 + .env 装载，
//  这些和"执行体脑子是什么"无关——每个执行体只写自己的 agent/workflow。
//
//  平台契约（与手写版 lib.js 壳完全一致，agent-runner 无感）：
//    POST /run {taskId,title,description,category,tags,deadline}
//      → 200 {ok:true, output:"交付物全文", meta:{…}}
//      → 500 {ok:false, error:"…"}（失败不上链，任务留在 Running）
//
//  对 title-agent 的两处改进（那目录是"框架版第一例"教学样本，不动它）：
//    1. .env 从模块位置解析（../../.env），不再依赖 cwd=项目根；
//    2. run 处理函数由执行体注入，壳里零业务。
// ═══════════════════════════════════════════════════════════════════
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./manifest.js";

// mini-dotenv：读项目根 .env（模块位置向上两级），已存在的环境变量不覆盖
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
try {
  if (fs.existsSync(rootEnv)) {
    for (const line of fs.readFileSync(rootEnv, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch (e) {
  console.error(`⚠️ [mastra-shell] .env 读取失败: ${e.message}`); // 坑#6：不静默吞
}

// node:http 直连 127.0.0.1 —— 不走系统代理环境变量（坑#4/#11）
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

// 自报到：启动登记 + 30s 心跳（平台侧 executors.js 收，挂链上即自动接线）
async function announceLoop(port, name) {
  const self = manifest.find((m) => m.port === port);
  if (!self) throw new Error(`端口 ${port} 不在 manifest.js 里——先登记再启动`);
  const api = process.env.ALADDIN_API_URL || "http://127.0.0.1:3001";
  const endpoint = `http://127.0.0.1:${port}`;
  let up = false;
  for (;;) {
    try {
      const r = await postJson(`${api}/api/executors/announce`, { chainName: self.chainName, endpoint });
      if (r.ok !== true) throw new Error(r.error || "平台拒绝报到");
      if (!up) {
        up = true;
        console.log(`📡 [${name}] 已向平台报到：${self.chainName} @ ${endpoint}${r.wired ? "，自动接线完成" : "（链上还没挂牌，挂上即接）"}`);
      }
    } catch (e) {
      if (up) { up = false; console.warn(`⚠️ [${name}] 心跳失联，转 5s 重试：${e.message}`); }
      else console.warn(`⏳ [${name}] 平台未就绪，5s 后再报到：${e.message}`);
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

/**
 * 起一个执行体。run(body) 返回 {ok, output, meta}；抛错按 ok:false 处理。
 * 用法见 image-agent/server.mjs / web-agent/server.mjs。
 */
export function createExecutorServer({ port, name, run }) {
  const startedAt = Date.now();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, { ok: true, agent: name, framework: "mastra", uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
      }
      if (req.method === "GET" && req.url === "/") {
        return sendJson(res, 200, { ok: true, agent: name, framework: "mastra", usage: 'POST /run {"title":"…","description":"…"}' });
      }
      if (req.method === "POST" && req.url === "/run") {
        const body = await readJson(req);
        const r = await run(body); // 执行体注入的脑子；异常走 catch
        return sendJson(res, 200, r);
      }
      return sendJson(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      console.error(`⚠️ [${name}]`, e.message); // 失败不静默：ok:false → agent-runner 不上链
      return sendJson(res, 500, { ok: false, agent: name, error: String(e.message).slice(0, 300) });
    }
  });
  server.listen(port, () => {
    console.log(`🤖 [${name}] Mastra 执行体就绪 → http://127.0.0.1:${port}`);
    announceLoop(port, name).catch((e) => console.error(`⚠️ [${name}] 心跳线程退出：`, e.message));
  });
  return server;
}

/** 任务简报拼装（image/web 两个执行体同款格式） */
export function buildBrief({ title, description, tags, category }) {
  return `任务标题：${title || "（未命名）"}\n分类：${category || "（无）"}\n标签：${tags || "（无）"}\n内容简报：\n${description}`;
}
