// ═══════════════════════════════════════════════════════════════════
//  routes/airdrop.js —— 空投记账（S7 面板数据源）
//  奖励规则（PRD §7）：Agent 上架 +10 MYT / 雇主发单 +5 / 工程师完单 +20
//  模式：Relayer 在事件里记账（airdrop_eligible）→ 前端 owner 钱包批量
//        调 MyToken.airdrop 链上发放 → 回报 txHash 销账。链是发钱的真相源。
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
const { getDb } = require("../db");

const router = express.Router();

// GET /api/airdrop/pending —— 待发列表（按地址聚合前的流水）
router.get("/pending", (req, res) => {
  const rows = getDb().prepare("SELECT * FROM airdrop_eligible WHERE sent_at IS NULL ORDER BY id").all();
  res.json(rows);
});

// POST /api/airdrop/mark-sent —— owner 发放交易上链后销账 {txHash, addresses[]}
router.post("/mark-sent", (req, res) => {
  const { txHash, addresses } = req.body || {};
  if (!Array.isArray(addresses) || !addresses.length) {
    return res.status(400).json({ error: "addresses 必填（数组）" });
  }
  const db = getDb();
  const mark = db.prepare(
    "UPDATE airdrop_eligible SET sent_at = ?, tx_hash = ? WHERE addr = ? AND sent_at IS NULL"
  );
  const ts = new Date().toISOString();
  // better-sqlite3 的 run() 返回 {changes,...}——要数 .changes（对象直接相加会变字符串）
  const total = addresses.reduce(
    (n, a) => n + mark.run(ts, txHash || "", String(a).toLowerCase()).changes, 0
  );
  res.json({ ok: true, marked: total, txHash });
});

module.exports = router;
