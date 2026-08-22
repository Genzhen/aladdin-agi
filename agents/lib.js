// ═══════════════════════════════════════════════════════════════════
//  lib.js —— 三个 Agent 服务共用的"躯干"（HTTP 壳 + LLM 通道），不含业务智能
//
//  为什么零依赖 node:http：Agent 的本质是"收到任务 → 干活 → 交回结果"，
//  一个 HTTP 服务足够说明问题。Express 在这里是多余的一层。
//  （生产替换点：每个 Agent 独立部署/独立仓库，注册中心存的是它的
//   服务发现地址——本 MVP 用 localhost:900x 代替。）
//
//  三个服务统一契约（agents/index.md 有完整说明）：
//    GET  /health → {ok:true, agent, uptimeSec}     （wire-agents.js 探活用）
//    POST /run    → {ok, agent, type:"markdown", output, meta}
//    其余 404。请求体上限 64KB；超时 60s 由调用方（agent-runner）控制。
//
//  brain 既可以是同步纯函数（可复现、可测试），也可以是 async
//  （LLM 调用）——躯干不关心，统一 await。LLM 通道见下方 llm()。
// ═══════════════════════════════════════════════════════════════════
const http = require("http");
const fs = require("fs");
const path = require("path");

const BODY_LIMIT = 64 * 1024;

// ── mini dotenv：读 cwd/.env（零依赖）。真实环境变量优先，不覆盖 ──
// PM2/裸 node 启动都能拿到 DEEPSEEK_API_KEY；key 永不硬编码进代码。
(function loadEnv() {
  try {
    const p = path.join(process.cwd(), ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) {
    console.error("⚠️ [lib] .env 读取失败（LLM 将走降级路径）:", e.message); // 坑#6：不静默吞
  }
})();

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

// ── 自报到（服务自注册）：启动即向平台登记"我是谁、我在哪"，之后 30s 心跳 ──
// 平台收到报到（routes/executors.js）或链上 AgentRegistered（relayer.js）任一事件，
// 双向对账自动接线——上架/启动谁先谁后都行，wire-agents.js 只剩诊断用途。
// 用 node:http 直连而非 fetch：系统代理环境变量（坑#4/#11）影响不到 127.0.0.1 直连。
const manifest = require("./manifest");

function postJson(url, obj, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(obj);
    const req = http.request(
      {
        hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch { reject(new Error(`报到响应不是 JSON（HTTP ${res.statusCode}）`)); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("报到超时")));
    req.on("error", reject);
    req.end(payload);
  });
}

/** 报到循环：平台没起就 5s 猛重试（启动顺序解放），连上后 30s 心跳，失联自动回落重试 */
async function announceLoop(port, agentName) {
  const self = manifest.find((m) => m.port === port);
  if (!self) {
    console.warn(`⚠️ [${agentName}] 不在 agents/manifest.js 清单里，跳过自报到（接线只能走 wire-agents 手动）`);
    return;
  }
  const api = process.env.ALADDIN_API_URL || "http://127.0.0.1:3001";
  const endpoint = `http://127.0.0.1:${port}`;
  let up = false;
  for (;;) {
    try {
      const r = await postJson(`${api}/api/executors/announce`, { chainName: self.chainName, endpoint });
      if (r.body?.ok !== true) throw new Error(r.body?.error || `HTTP ${r.status}`);
      if (!up) {
        up = true;
        console.log(`📡 [${agentName}] 已向平台报到：${self.chainName} @ ${endpoint}${r.body.wired ? "，自动接线完成" : "（链上还没挂牌，挂上即接）"}`);
      }
    } catch (e) {
      if (up) { up = false; console.warn(`⚠️ [${agentName}] 心跳失联（平台重启？），转 5s 重试：${e.message}`); }
      else console.warn(`⏳ [${agentName}] 平台未就绪，5s 后再报到：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, up ? 30_000 : 5_000));
  }
}

// ── L3 自签 submit：执行体自持钥，不再让平台代签 ──
// 合约法条：submit 要求 msg.sender == t.agent（接单者）。L1/L2 里所有
// Agent owner 都是部署钱包，平台拿同一把钥匙"代签"合法；L3 起第二钱包
// 拥有的 Agent（如 xhs-agent）接单后，只有那把钥匙能 submit——执行体
// 自己持钥（env 注入），平台 relayer 退回纯路由。这正是"接单权归钱包"。
// ethers 用根 node_modules（agents/ 无依赖红线不动），deployed.json/artifacts
// 也都在项目根——路径锚定 __dirname 而非 cwd，从哪启动都行。
// 生产替换点：钥匙进 KMS/TEE，或改成 per-task 授权（EIP-712 会话密钥）。
const ROOT = path.join(__dirname, "..");

async function submitSelf(taskId, keyEnv = "XHS_PRIVATE_KEY") {
  // key 归一化：先剥 0x 前缀再清洗（顺序反了会把前缀里的 x 也剥掉，key 多出一位→
  // invalid BytesLike——坑#21 实录：服务器 .env 带前缀、本地不带，两种都得能吃）
  const rawKey = (process.env[keyEnv] || "").replace(/^0[xX]/, "").replace(/[^0-9a-fA-F]/g, "");
  if (!rawKey) throw new Error(`${keyEnv} 未配置——执行体没钥匙，无法自签 submit`);
  if (rawKey.length !== 64) throw new Error(`${keyEnv} 长度 ${rawKey.length} ≠ 64——.env 里 key 形状不对`);
  const { ethers } = require(path.join(ROOT, "node_modules", "ethers")); // 惰性加载：别的 agent 不背这依赖
  const deployed = JSON.parse(fs.readFileSync(path.join(ROOT, "deployed.json"), "utf8"));
  const abi = JSON.parse(
    fs.readFileSync(path.join(ROOT, "artifacts", "contracts", "TaskEscrow.sol", "TaskEscrow.json"), "utf8")
  ).abi;
  // RPC 兜底与 server/chain.js 同款：SEPOLIA_RPC_URL 留空时走公共节点
  const rpc = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet("0x" + rawKey, provider);
  const escrow = new ethers.Contract(deployed.contracts.TaskEscrow, abi, wallet);
  const tx = await escrow.submit(taskId);
  const rc = await tx.wait();
  return rc.hash;
}

// ── LLM 通道：DeepSeek（OpenAI 兼容 /chat/completions），原生 fetch 零依赖 ──
// 失败（key 未配/网络/超时/空返回）一律 throw，由各 agent 的 brain 决定降级。
// 生产替换点：换 provider 只改 BASE_URL/MODEL 环境变量；流式加 stream:true。
const LLM_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const LLM_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

async function llm({ system, user, maxTokens = 1500, temperature = 0.7, timeoutMs = 50_000 }) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY 未配置");
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs), // 50s < agent-runner 的 60s，留 10s 给落库+上链
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  const output = j.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error("DeepSeek 返回空内容");
  return { output, usage: j.usage || null };
}

/**
 * 起一个 Agent 服务：把"HTTP 壳"和"大脑"分离——
 * brain(payload) 是各 agent 唯一要写的函数，返回 {output, meta}；
 * 同步纯函数或 async（LLM）都行，这里统一 await。
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
        const { output, meta } = await brain(payload); // 大脑干活（同步/LLM 通吃）
        return sendJson(res, 200, { ok: true, agent: agentName, type: "markdown", output, meta });
      }
      return sendJson(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      // 失败要喊出来 + 交回结构化错误：调用方（agent-runner）靠 ok:false 决定不上链 submit
      console.error(`⚠️ [${agentName}]`, e.message);
      return sendJson(res, 500, { ok: false, agent: agentName, error: e.message });
    }
  });
  server.listen(port, () => {
    console.log(`🤖 [${agentName}] 执行体就绪 → http://127.0.0.1:${port}`);
    announceLoop(port, agentName); // 自报到 + 心跳：平台据此自动接线（不再需要人工跑 wire-agents）
  });
  return server;
}

module.exports = { listen, llm, submitSelf };
