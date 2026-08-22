// ═══════════════════════════════════════════════════════════════════
//  wire-agents.js —— 接线诊断/修复工具（正常流程已全自动，平时不用跑）
//
//  自动接线闭环（谁后到都能接上，两个方向）：
//    ① 执行体启动即向平台心跳报到（agents/lib.js 的 announceLoop
//       → POST /api/executors/announce）——报到时链上已有同名 active
//       Agent 就当场点亮（覆盖"先上架后启动"）
//    ② 链上 AgentRegistered（server/relayer.js）——报到表里已有心跳
//       就当场点亮（覆盖"先启动后上架"）
//  本脚本保留价值：批量体检探活、修接线、上线前 audit。
//  设计点：链上自增 id 不进工程配置（编号是实现细节），一律按
//  manifest 声明的 chainName 对账；endpoint 只写 SQLite 零 gas。
//
//  用法：node scripts/wire-agents.js（agent 服务要先起）
// ═══════════════════════════════════════════════════════════════════
const { getDb } = require("../server/db");
const MANIFEST = require("../agents/manifest");

/** 探活一个执行体：活着返回 true（2s 超时，health 非 ok 也算死） */
async function isAlive(endpoint) {
  try {
    const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) });
    return (await r.json()).ok === true;
  } catch {
    return false;
  }
}

/** 按名找链上 Agent：active 优先，同名取最新 id（下架重挂场景） */
function findOnChain(db, chainName) {
  return db.prepare(`
    SELECT id, status FROM agents WHERE name = ?
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id DESC
  `).get(chainName);
}

async function main() {
  const db = getDb();
  console.log("🔌 开始按名接线：执行体 manifest ↔ 链上挂牌（编号无关）\n");

  for (const { port, chainName } of MANIFEST) {
    const endpoint = `http://127.0.0.1:${port}`;

    if (!(await isAlive(endpoint))) {
      console.log(`❌ :${port}  ${chainName.padEnd(16)} 服务没起（node agents/start-all.js），跳过`);
      continue;
    }

    const row = findOnChain(db, chainName);
    if (!row) {
      console.log(`⏳ :${port}  ${chainName.padEnd(16)} 服务在线，链上还没这个名字——上架后重跑本脚本即可`);
      continue;
    }
    if (row.status !== "active") {
      console.log(`⛔ :${port}  ${chainName.padEnd(16)} 链上#${row.id} 状态=${row.status}（已下架），不接线`);
      continue;
    }

    db.prepare("UPDATE agents SET endpoint = ? WHERE id = ?").run(endpoint, row.id);
    console.log(`✅ :${port}  ${chainName.padEnd(16)} → 链上#${row.id}（${endpoint}）`);
  }

  // 全景收尾：还挂着牌但没身体的（纯挂牌，接单后等手动 submit）
  const bare = db.prepare("SELECT id, name FROM agents WHERE status = 'active' AND endpoint = '' ORDER BY id").all();
  if (bare.length) {
    console.log(`\n→ 纯挂牌无执行体：${bare.map((b) => `#${b.id} ${b.name}`).join("、")}`);
  }
  const wired = db.prepare("SELECT COUNT(*) AS c FROM agents WHERE status = 'active' AND endpoint != ''").get().c;
  console.log(`→ 已点亮 ${wired} 个执行体`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
