// ═══════════════════════════════════════════════════════════════════
//  routes/agents.js —— Agent 相关端点（对应 S1 市场首页 / S2 详情页）
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
const { ethers } = require("ethers");
const { getDb } = require("../db");
const { computeDims } = require("../scoring");

const router = express.Router();

/** 行结构 → API 输出（顺便做展示层换算：score 87 → 0.87） */
function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    category: row.category,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    priceWei: row.price_wei,
    score: row.score,                       // 链上原始整数
    scoreDisplay: (row.score / 100).toFixed(2), // 前端直接展示用
    description: row.description,
    status: row.status,
    registeredAt: row.registered_at,
    endpoint: row.endpoint,                 // 有执行体=接单后自动交付（回环地址，非机密）
    autoAccept: !!row.auto_accept,          // 自动接单开关（auto-dispatch 的听单标记）
  };
}

// GET /api/agents?category=Writing&q=剧本 —— S1 列表（分类筛选 + 关键词搜索）
router.get("/", (req, res) => {
  const db = getDb();
  const { category, q } = req.query;

  let sql = "SELECT * FROM agents WHERE status != 'delisted'";
  const params = [];
  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  if (q) {
    sql += " AND (name LIKE ? OR tags LIKE ? OR description LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY score DESC, id ASC"; // 分数优先，新 Agent 按注册顺序兜底

  res.json(db.prepare(sql).all(...params).map(toApi));
});

// GET /api/agents/:id —— S2 详情（五维分由 scoring.js 从历史任务聚合）
router.get("/:id", (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "agent not found" });

  const dims = computeDims(db, row.id);
  res.json({
    ...toApi(row),
    scoreDims: dims || { note: "暂无数据" },
  });
});

// POST /api/agents/:id —— 补链下长文本（上架交易已在链上，这里只 enrich）
// ⚠️ owner 签名鉴权：曾经裸奔（任何人可改任意 Agent 的简介/下架状态）。
// 前端（Enrich/AutoAccept）用当前钱包签 `aladdin:enrich:${id}:${ts}`，这里
// recoverAddress 对比 agent.owner。消息绑 agentId 防跨 Agent 盗用、绑时间戳防重放。
// 生产替换点：EIP-712 typed data + 服务端一次性 nonce（当前 ±5min 时间窗是演示级）。
router.post("/:id", (req, res) => {
  const db = getDb();
  const { description, tags, status, autoAccept, sig, ts } = req.body;
  const row = db.prepare("SELECT id, owner FROM agents WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "agent not found" });

  const tsNum = Number(ts);
  if (!sig || !Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > 5 * 60_000) {
    return res.status(401).json({ error: "缺少 owner 签名或时间戳超出 ±5 分钟窗口" });
  }
  let signer;
  try {
    signer = ethers.verifyMessage(`aladdin:enrich:${req.params.id}:${tsNum}`, sig);
  } catch {
    return res.status(401).json({ error: "签名格式不合法" });
  }
  if (signer.toLowerCase() !== row.owner) {
    return res.status(403).json({ error: `签名者 ${signer} 不是这个 Agent 的 owner` });
  }

  db.prepare(`
    UPDATE agents SET
      description = COALESCE(?, description), tags = COALESCE(?, tags),
      status = COALESCE(?, status), auto_accept = COALESCE(?, auto_accept)
    WHERE id = ?
  `).run(
    description ?? null, tags ?? null, status ?? null,
    autoAccept === undefined ? null : (autoAccept ? 1 : 0), // 布尔 → 0/1（SQLite 无布尔）
    req.params.id,
  );
  res.json({ ok: true, signer });
});

module.exports = router;
