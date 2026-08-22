// ═══════════════════════════════════════════════════════════════════
//  executors.js —— 执行体心跳报到 + 自动接线（真实产品的"服务自注册"）
//
//  闭环逻辑（两个方向都覆盖，谁后到都能接上）：
//    ① 执行体启动/心跳 → 本路由：登记 + 若链上已有同名 active Agent 则当场接线
//    ② 链上 AgentRegistered（relayer.js）→ 查本表：若执行体早已心跳报到则当场接线
//  生产替换点：demo 级防冒认=只认 manifest 登记过的名字和端口；
//  真正的身份证明是 owner 私钥签名（EIP-712 announce）——双钱包方案落地时替换。
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
const { getDb } = require("../db");
const MANIFEST = require("../../agents/manifest"); // 报到只认清单内的执行体

const router = express.Router();

/** demo 级校验：chainName 在 manifest 里、端口与 manifest 一致（host 可变——本地/AWS） */
function validate(body) {
  const m = MANIFEST.find((x) => x.chainName === body?.chainName);
  if (!m) return { error: `未登记的执行体：${body?.chainName ?? "(空)"}` };
  try {
    if (new URL(body.endpoint).port !== String(m.port)) {
      return { error: `端口与 manifest 不符（期望 :${m.port}）` };
    }
  } catch {
    return { error: "endpoint 不是合法 URL" };
  }
  return { m };
}

// POST /api/executors/announce {chainName, endpoint}
router.post("/announce", (req, res) => {
  const { error } = validate(req.body);
  if (error) return res.status(400).json({ ok: false, error });

  const { chainName, endpoint } = req.body;
  const db = getDb();
  db.prepare(`
    INSERT INTO executor_registry (chain_name, endpoint, last_seen) VALUES (?,?,?)
    ON CONFLICT(chain_name) DO UPDATE SET endpoint=excluded.endpoint, last_seen=excluded.last_seen
  `).run(chainName, endpoint, new Date().toISOString());

  // 自动接线：链上已有同名 active Agent → 当场点亮（覆盖"先上架后启动"方向）
  const r = db.prepare("UPDATE agents SET endpoint = ? WHERE name = ? AND status = 'active'")
    .run(endpoint, chainName);
  res.json({ ok: true, wired: r.changes > 0 });
});

// GET /api/executors —— 调试/运维：看谁在心跳（失联判断交给调用方看 last_seen）
router.get("/", (_req, res) => {
  const rows = getDb().prepare("SELECT * FROM executor_registry ORDER BY chain_name").all();
  res.json({ ok: true, count: rows.length, executors: rows });
});

module.exports = router;
