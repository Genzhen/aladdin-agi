// ═══════════════════════════════════════════════════════════════════
//  routes/internal.js —— 内部端点（给 Go 引擎调，不对公网暴露）
//  POST /api/internal/run-match   {taskId}  同步跑三层漏斗
//  POST /api/internal/mark-dead   {taskId}  队列重试耗尽 → 记死信
//  鉴权：x-internal-token 头（同机部署靠它 + 不开公网；生产加 mTLS/VPC）
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
const { getDb } = require("../db");
const { dispatch } = require("../matching");

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "dev-token";
const router = express.Router();

router.use((req, res, next) => {
  if (req.get("x-internal-token") !== INTERNAL_TOKEN) {
    return res.status(401).json({ error: "bad internal token" });
  }
  next();
});

router.post("/run-match", (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: "taskId 必填" });
  try {
    res.json({ ok: true, report: dispatch(getDb(), Number(taskId)) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message }); // 5xx → Go 引擎会重试
  }
});

router.post("/mark-dead", (req, res) => {
  const { taskId, reason } = req.body || {};
  if (!taskId) return res.status(400).json({ error: "taskId 必填" });
  getDb().prepare("INSERT INTO match_runs (task_id, status, detail, created_at) VALUES (?,?,?,?)")
    .run(Number(taskId), "dead", JSON.stringify({ dead: true, reason: reason || "queue_retry_exhausted" }), new Date().toISOString());
  res.json({ ok: true, taskId, dead: true });
});

module.exports = router;
