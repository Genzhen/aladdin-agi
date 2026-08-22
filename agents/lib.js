// ═══════════════════════════════════════════════════════════════════
//  lib.js —— 三个 Agent 服务共用的"躯干"（HTTP 壳），不含任何智能
//
//  为什么零依赖 node:http：Agent 的本质是"收到任务 → 干活 → 交回结果"，
//  一个 HTTP 服务足够说明问题。Express 在这里是多余的一层。
//  （生产替换点：每个 Agent 独立部署/独立仓库，注册中心存的是它的
//   服务发现地址——本 MVP 用 localhost:900x 代替。）
//
//  三个服务统一契约（agents/index.md 有完整说明）：
//    GET  /health → {ok:true, agent, uptimeSec}     （wire-agents.js 探活用）
//    POST /run    → {ok, agent, type:"markdown", output, meta}
//    其余 404。请求体上限 64KB，超时 15s 由调用方（agent-runner）控制。
// ═══════════════════════════════════════════════════════════════════
const http = require("http");

const BODY_LIMIT = 64 * 1024;

/** 读 JSON body（带 64KB 上限——agent 是内部服务，但坏输入照样要挡） */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new Error("body 超 64KB")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch (e) { reject(new Error("body 不是合法 JSON")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

/**
 * 起一个 Agent 服务：把"HTTP 壳"和"大脑"分离——
 * brain(payload) 是各 agent 唯一要写的函数，返回 {output, meta}。
 */
function listen(port, agentName, brain) {
  const startedAt = Date.now();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, { ok: true, agent: agentName, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
      }
      if (req.method === "GET" && req.url === "/") {
        return sendJson(res, 200, {
          ok: true, agent: agentName,
          usage: 'POST /run {"taskId":1,"title":"…","description":"…","tags":"…"}',
        });
      }
      if (req.method === "POST" && req.url === "/run") {
        const payload = await readJson(req);
        const { output, meta } = brain(payload); // 大脑干活（同步纯函数：可复现、可测试）
        return sendJson(res, 200, { ok: true, agent: agentName, type: "markdown", output, meta });
      }
      return sendJson(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      // 失败要喊出来 + 交回结构化错误：调用方（agent-runner）靠 ok:false 决定不上链 submit
      console.error(`⚠️ [${agentName}]`, e.message);
      return sendJson(res, 500, { ok: false, agent: agentName, error: e.message });
    }
  });
  server.listen(port, () => console.log(`🤖 [${agentName}] 执行体就绪 → http://127.0.0.1:${port}`));
  return server;
}

module.exports = { listen };
