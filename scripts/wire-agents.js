// ═══════════════════════════════════════════════════════════════════
//  wire-agents.js —— 给链上 Agent 接上执行体（endpoint 写进链下库）
//
//  设计点（面试话术）：
//  1. endpoint 是"店面装修"不是"执照字段"——所以只写 SQLite 不动链，
//     一秒完成、零 gas。链上登记记录和执行体是两个可独立演进的东西。
//  2. 写完逐个探活（GET /health）：agent 服务没起就当场告诉你，
//     别等到任务接单了才发现没人干活。
//  3. 为什么不做链上 endpoint 字段：地址会随部署变（本地/AWS/Serverless），
//     上链一次就烧一次 gas 还改不了历史——链下库改一行的事。
//
//  用法：node scripts/wire-agents.js
//  （server 开不开都行——WAL 模式允许多进程读写；agent 服务要先起）
// ═══════════════════════════════════════════════════════════════════
const { getDb } = require("../server/db");

// 链上 Agent id → 执行体地址（对应 agents/ 目录五个服务）
// ⚠️ 15/16 是按链上 nextId 预填的（写此表时链上共 14 个）——
//    上架顺序必须是 Contract Guard 先、Storyboard Mate 后；
//    如果实际 id 对不上，改这里或直接 sqlite UPDATE agents SET endpoint=...
const WIRING = {
  1: "http://127.0.0.1:9001", // ScriptWriter Pro → writer-agent（写稿）
  2: "http://127.0.0.1:9003", // CodeWeaver       → review-agent（代码审查）
  3: "http://127.0.0.1:9002", // DataMiner X      → data-agent（数据报告）
  15: "http://127.0.0.1:9004", // Contract Guard   → contract-agent（合同审查·待上架）
  16: "http://127.0.0.1:9005", // Storyboard Mate  → storyboard-agent（分镜脚本·待上架）
  17: "http://127.0.0.1:9006", // Title Forge      → title-agent/server.mjs（Mastra 框架版·待上架）
};

async function main() {
  const db = getDb();
  console.log("🔌 开始接线：链上 Agent ↔ 本地执行体\n");

  for (const [id, endpoint] of Object.entries(WIRING)) {
    const a = db.prepare("SELECT name FROM agents WHERE id = ?").get(id);
    if (!a) { console.log(`⛔ Agent#${id} 不在库（先上架或起 server 让 Relayer 补账）`); continue; }
    db.prepare("UPDATE agents SET endpoint = ? WHERE id = ?").run(endpoint, id);

    let health = "❌ 探活失败（服务没起？node agents/start-all.js）";
    try {
      const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) });
      const j = await r.json();
      if (j.ok) health = `✅ ${j.agent} 在线（uptime ${j.uptimeSec}s）`;
    } catch { /* 上面默认文案就是失败提示 */ }
    console.log(`Agent#${id} ${a.name.padEnd(18)} → ${endpoint}  ${health}`);
  }

  const wired = db.prepare("SELECT COUNT(*) AS c FROM agents WHERE endpoint != ''").get().c;
  const total = db.prepare("SELECT COUNT(*) AS c FROM agents").get().c;
  console.log(`\n→ ${wired}/${total} 个 Agent 有执行体，其余纯挂牌（接单后等手动 submit，行为兼容）`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
