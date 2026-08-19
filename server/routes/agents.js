// ═══════════════════════════════════════════════════════════════════
//  routes/agents.js —— Agent 相关端点（对应 S1 市场首页 / S2 详情页）
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
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
router.post("/:id", (req, res) => {
  const db = getDb();
  const { description, tags, status } = req.body;
  const row = db.prepare("SELECT id FROM agents WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "agent not found" });

  db.prepare("UPDATE agents SET description = COALESCE(?, description), tags = COALESCE(?, tags), status = COALESCE(?, status) WHERE id = ?")
    .run(description ?? null, tags ?? null, status ?? null, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
