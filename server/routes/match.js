// ═══════════════════════════════════════════════════════════════════
//  routes/match.js —— 匹配引擎入口（S5 页面的后端）
//  POST /api/tasks/:id/dispatch  跑三层漏斗（同步版，演示用；异步走第 9 步队列）
//  POST /api/tasks/:id/click    雇主点了某候选 → CTR 在线学习一步
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
const { getDb } = require("../db");
const { dispatch, recordClick } = require("../matching");

const router = express.Router();

router.post("/:id/dispatch", async (req, res) => {
  try {
    const report = await dispatch(getDb(), Number(req.params.id));
    res.json(report);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:id/click", (req, res) => {
  const { agentId } = req.body || {};
  if (!agentId) return res.status(400).json({ error: "agentId 必填" });
  const r = recordClick(getDb(), Number(req.params.id), Number(agentId));
  res.status(r.ok ? 200 : 400).json(r);
});

module.exports = router;
