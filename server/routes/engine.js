// ═══════════════════════════════════════════════════════════════════
//  routes/engine.js —— S5 匹配引擎总览（队列深度 + 漏斗历史 + 模型状态）
//  GET /api/engine/overview
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
const { getDb } = require("../db");
const { queueDepth } = require("../queue");

const router = express.Router();

router.get("/overview", async (req, res) => {
  const db = getDb();

  const recentRuns = db.prepare(
    "SELECT id, task_id, status, detail, created_at FROM match_runs ORDER BY id DESC LIMIT 10"
  ).all().map((r) => {
    let detail = {};
    try { detail = JSON.parse(r.detail); } catch { /* 旧格式忽略 */ }
    return { id: r.id, task_id: r.task_id, status: r.status, created_at: r.created_at, ...detail };
  });

  const weights = db.prepare("SELECT updated_at, weights FROM model_weights WHERE key='v2'").get();
  let trained = false;
  try { trained = weights ? JSON.parse(weights.weights).some((w) => w !== 0) : false; } catch { }

  res.json({
    agents: db.prepare("SELECT COUNT(*) AS c FROM agents").get().c,
    tasks: db.prepare("SELECT COUNT(*) AS c FROM tasks").get().c,
    deadCount: db.prepare("SELECT COUNT(*) AS c FROM match_runs WHERE status='dead'").get().c,
    model: { trained, updatedAt: weights?.updated_at || null },
    recentRuns,
    queueDepth: await queueDepth().catch(() => null), // Redis 没起 → null（前端显示 —）
  });
});

module.exports = router;
