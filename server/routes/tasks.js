// ═══════════════════════════════════════════════════════════════════
//  routes/tasks.js —— 任务相关端点（对应 S3 发布 / S4 详情）
// 双写模式：雇主先 POST 草稿（长文本落库）→ 钱包调链上 postTask 质押
// → Relayer 听到 TaskPosted 事件，按（publisher+price）把草稿合体成正式任务
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
const { ethers } = require("ethers");
const { getDb } = require("../db");

const router = express.Router();

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    publisher: row.publisher,
    agentAddr: row.agent_addr,
    agentId: row.agent_id,
    priceWei: row.price_wei,
    priceEth: ethers.formatEther(row.price_wei || "0"),
    depositWei: row.deposit_wei,
    deadline: row.deadline,
    state: row.state,
    title: row.title,
    category: row.category,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    description: row.description,
    candidates: JSON.parse(row.candidates || "[]"),
    createdAt: row.created_at,
  };
}

// POST /api/tasks —— 存草稿（S3 表单提交的第一步，链上质押由前端钱包做）
router.post("/", (req, res) => {
  const db = getDb();
  const { publisher, priceEth, deadline, title, category, tags, description } = req.body;

  // 入参校验：报错信息直接告诉前端缺什么（fail fast，同合约哲学）
  if (!publisher || !priceEth || !title) {
    return res.status(400).json({ error: "publisher / priceEth / title 必填" });
  }
  let priceWei;
  try {
    priceWei = String(ethers.parseEther(String(priceEth))); // "0.1" → "100000000000000000"
  } catch {
    return res.status(400).json({ error: "priceEth 不是合法数字（例：0.1）" });
  }

  const r = db.prepare(`
    INSERT INTO task_drafts (publisher, price_wei, deadline, title, category, tags, description, created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    String(publisher).toLowerCase(), priceWei, Number(deadline) || 0,
    title, category || "", tags || "", description || "", new Date().toISOString()
  );

  res.json({
    ok: true,
    draftId: r.lastInsertRowid,
    priceWei, // 前端接着调 escrow.postTask 时直接用这个数（保证对账钥匙一致）
    hint: "下一步：用钱包调 TaskEscrow.postTask 质押，Relayer 会自动把草稿合体",
  });
});

// GET /api/tasks?state=running —— 列表（S6 我的任务）
router.get("/", (req, res) => {
  const db = getDb();
  const { state } = req.query;
  const sql = state
    ? "SELECT * FROM tasks WHERE state = ? ORDER BY id DESC"
    : "SELECT * FROM tasks ORDER BY id DESC";
  res.json(db.prepare(sql).all(...(state ? [state] : [])).map(toApi));
});

// GET /api/tasks/:id —— 详情 + 事件时间线（S4 stepper 的数据源）
router.get("/:id", (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "task not found" });

  const events = db.prepare(
    "SELECT name, block, args, created_at FROM task_events WHERE task_id = ? ORDER BY id"
  ).all(req.params.id);

  // 交付物：Agent 执行体的真实产出（running 中可能还没好；无执行体则恒为 null）
  const d = db.prepare("SELECT * FROM task_results WHERE task_id = ?").get(req.params.id);
  const deliverable = d
    ? { ok: !!d.ok, agentId: d.agent_id, output: d.output, error: d.error, createdAt: d.created_at }
    : null;

  res.json({ ...toApi(row), events, deliverable });
});

module.exports = router;
