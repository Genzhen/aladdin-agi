// ═══════════════════════════════════════════════════════════════════
//  routes/tasks.js —— 任务相关端点（对应 S3 发布 / S4 详情）
// 双写模式：雇主先 POST 草稿（长文本落库）→ 钱包调链上 postTask 质押
// → Relayer 听到 TaskPosted 事件，按（publisher+price）把草稿合体成正式任务
// ═══════════════════════════════════════════════════════════════════
const express = require("express");
const { ethers } = require("ethers");
const { getDb } = require("../db");
const { rescore } = require("../admin");

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
    rating: row.rating ?? null,      // 雇主星级 1~5（null=未评；仲裁单没有）
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
  // 预览门控（防白嫖）：任务未结算（state != settled）只放样章前 200 字；
  // 验收打款或仲裁裁决后（殊途同归到 settled）解锁全文。失败原因（ok=0）不锁——
  // 雇主不该付费才能看到"为什么失败"。
  // 生产替换点：仲裁员端点带 admin 鉴权可取全文；更强 = 交付时 output 哈希上链防篡改。
  const PREVIEW_CHARS = 200;
  const d = db.prepare("SELECT * FROM task_results WHERE task_id = ?").get(req.params.id);
  let deliverable = null;
  if (d) {
    const full = String(d.output || "");
    const locked = row.state !== "settled" && d.ok === 1 && full.length > PREVIEW_CHARS;
    deliverable = {
      ok: !!d.ok,
      agentId: d.agent_id,
      error: d.error,
      createdAt: d.created_at,
      output: locked ? full.slice(0, PREVIEW_CHARS) : full,
      truncated: locked,
      previewChars: PREVIEW_CHARS,
    };
  }

  res.json({ ...toApi(row), events, deliverable });
});

// POST /api/tasks/:id/rate —— 雇主验收打星（1~5，进五维分的"雇主评分"维）
// 时序约定：前端先调这里再签链上 approve——TaskApproved 事件到达时星级已在库，
// relayer 的 rescore 立刻能算进综合分。漏了没打（直接在钱包签的）也可 settled 后补评，
// 补评路由里再触发一次 rescore。只能评一次（防自刷）；仲裁单雇主没资格评（款没付）。
router.post("/:id/rate", async (req, res) => {
  const db = getDb();
  const { rating, publisher } = req.body || {};
  const stars = Number(rating);

  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: "rating 必须是 1~5 的整数" });
  }
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "task not found" });
  if (!publisher || publisher.toLowerCase() !== row.publisher.toLowerCase()) {
    return res.status(403).json({ error: "只有任务发布者能打分" });
  }
  if (!["review", "settled"].includes(row.state)) {
    return res.status(400).json({ error: `当前状态 ${row.state} 不可评分（待验收/已结算才行）` });
  }
  if (row.rating != null) {
    return res.status(400).json({ error: `已评过 ${row.rating} 星（一单一评，防刷）` });
  }
  if (!row.agent_id) {
    return res.status(400).json({ error: "任务还没有 Agent 接单，没有评分对象" });
  }

  db.prepare("UPDATE tasks SET rating = ? WHERE id = ?").run(stars, row.id);

  // 补评场景（事件早过了，rescore 没吃到这颗星）→ 现在重算一次；
  // review 态不用：马上要 approve，事件回调会 rescore，别重复上链
  if (row.state === "settled") {
    await rescore(db, row.agent_id);
  }
  res.json({ ok: true, taskId: row.id, rating: stars });
});

module.exports = router;
