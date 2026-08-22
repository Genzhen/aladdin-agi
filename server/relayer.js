// ═══════════════════════════════════════════════════════════════════
//  relayer.js —— 链上事件 → SQLite 同步器（复用「Web3 大学」Relayer 模式）
//  核心思想：链是真相源，SQLite 是可重建的缓存。
//  监听 TaskEscrow / AgentRegistry 的全部状态迁移事件，实时落库。
//  （生产版还要加"启动补账"：扫历史块回放事件——结业优化项）
// ═══════════════════════════════════════════════════════════════════
const { registry, escrow } = require("./chain");
const { getDb } = require("./db");
const { enqueue } = require("./queue");
const { dispatch } = require("./matching");
const { rescore } = require("./admin");
const { handleAccepted } = require("./agent-runner");

const now = () => new Date().toISOString();
const lo = (addr) => (addr ? String(addr).toLowerCase() : null);

// 空投记账（PRD §7：上架 +10 / 发单 +5 / 完单 +20 MYT；幂等靠 UNIQUE 约束）
const MYT = (n) => String(BigInt(n) * 10n ** 18n); // ⚠️ BigInt 家族坑第 4 次：n 是 Number，必须显式 BigInt() 再乘
function creditAirdrop(db, addr, amount, reason, refId) {
  if (!addr) return;
  try {
    db.prepare("INSERT OR IGNORE INTO airdrop_eligible (addr, amount_wei, reason, ref_id) VALUES (?,?,?,?)")
      .run(lo(addr), MYT(amount), reason, refId);
  } catch (e) {
    // 幂等冲突（UNIQUE）=已记过，静默；其他错误必须喊出来——静默吞错误让这次 bug 藏了半小时
    if (!/UNIQUE/.test(e.message)) console.error("⚠️ [Relayer] 空投记账失败:", e.message);
  }
}

function log(name, extra = "") {
  console.log(`🔁 [Relayer] ${name} ${extra}`);
}

// 五维重算 rescore 已挪到 admin.js：relayer 的结算事件回调与 routes/tasks 的补评接口共用

/** 记一条事件流水 */
function recordEvent(db, taskId, name, block, args) {
  db.prepare(
    "INSERT INTO task_events (task_id, name, block, args, created_at) VALUES (?,?,?,?,?)"
  ).run(taskId, name, block ?? 0, JSON.stringify(args, (k, v) =>
    typeof v === "bigint" ? String(v) : v
  ), now());
}

/** 保证 tasks 行存在（链上直接发布、草稿被手动删时兜底） */
function ensureTask(db, id, publisher, priceWei, deadline) {
  const row = db.prepare("SELECT id FROM tasks WHERE id = ?").get(id);
  if (row) return;
  db.prepare(`
    INSERT INTO tasks (id, publisher, price_wei, fee_wei, deadline, state, title, created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, lo(publisher), String(priceWei), String(priceWei * 10n / 10000n),
    Number(deadline), "matching", "(链上直接发布)", now());
}

/**
 * 启动补账：以链上 AgentRegistry 为准，把库里缺行/旧数据补齐（幂等）。
 * 场景：Relayer 宕机期间有新 Agent 上架、或旧数据有缺口（如 tags 为空）。
 * 这就是"链是真相源、SQLite 是可重建缓存"的落地——库丢了照着链重放就行。
 */
async function backfillAgents(db) {
  const total = Number(await registry.totalAgents());
  for (let id = 1; id <= total; id++) {
    const a = await registry.agents(id); // struct：owner/name/category/tags/pricePerRun/score
    db.prepare(`
      INSERT INTO agents (id, owner, name, category, tags, price_wei, score, description, status, registered_at)
      VALUES (?,?,?,?,?,?,?, COALESCE((SELECT description FROM agents WHERE id=?), ''), COALESCE((SELECT status FROM agents WHERE id=?), 'active'), ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, tags=excluded.tags, price_wei=excluded.price_wei, score=excluded.score
    `).run(id, lo(a.owner), a.name, a.category, a.tags, String(a.pricePerRun), Number(a.score), id, id, now());
    creditAirdrop(db, a.owner, 10, "agent_listed", id); // 上架奖励补记账（幂等）
  }
  if (total > 0) log("Backfill", `agents ×${total} 已按链上最新状态补齐（tags/score/上架奖励）`);

  // 历史已结算任务的完单奖励补记账（Relayer 停机期间结算的单子也不漏）
  const done = db.prepare(`
    SELECT t.id, t.publisher, t.agent_addr, t.agent_id,
           EXISTS(SELECT 1 FROM task_events e WHERE e.task_id = t.id AND e.name = 'TaskRuled') AS ruled,
           (SELECT args FROM task_events e WHERE e.task_id = t.id AND e.name = 'TaskRuled' LIMIT 1) AS ruling_args
    FROM tasks t WHERE t.state = 'settled'
  `).all();
  for (const t of done) {
    creditAirdrop(db, t.publisher, 5, "task_published", t.id);
    const agentWon = !t.ruled || (JSON.parse(t.ruling_args || "{}").ruling !== 1);
    if (agentWon) creditAirdrop(db, t.agent_addr, 20, "task_done", t.id);
  }
  if (done.length) log("Backfill", `settled tasks ×${done.length} 完单奖励已补记账`);
}

function startRelayer() {
  const db = getDb();

  // ── AgentRegistry 事件 ──
  registry.on("AgentRegistered", async (id, owner, name, category, pricePerRun, ev) => {
    // 事件里没带 tags（省事件体积），回链上读 struct 补齐——链是真相源
    let tags = "";
    try {
      const a = await registry.agents(Number(id));
      tags = a.tags;
    } catch { /* 拿不到先空着，启动补账会兜底 */ }

    db.prepare(`
      INSERT OR REPLACE INTO agents (id, owner, name, category, tags, price_wei, score, description, status, registered_at)
      VALUES (?,?,?,?,?,?, COALESCE((SELECT score FROM agents WHERE id=?), 0), COALESCE((SELECT description FROM agents WHERE id=?), ''), COALESCE((SELECT status FROM agents WHERE id=?), 'active'), ?)
    `).run(Number(id), lo(owner), name, category, tags, String(pricePerRun), Number(id), Number(id), Number(id), now());
    log("AgentRegistered", `#${id} ${name}`);
    creditAirdrop(db, owner, 10, "agent_listed", Number(id)); // 上架奖励 10 MYT

    // 自动接线（反向对账）：执行体先启动、链上后上架——报到表里早有心跳，当场点亮。
    // 上架从此零后续操作：页面签完 register，几秒内 endpoint 就位（wire-agents 降级为诊断工具）
    const ex = db.prepare("SELECT endpoint FROM executor_registry WHERE chain_name = ?").get(name);
    if (ex) {
      db.prepare("UPDATE agents SET endpoint = ? WHERE id = ? AND status = 'active'")
        .run(ex.endpoint, Number(id));
      log("AutoWire", `#${id} ${name} → ${ex.endpoint}（执行体已在心跳报到）`);
    }
  });

  registry.on("AgentScoreUpdated", (id, oldScore, newScore, ev) => {
    db.prepare("UPDATE agents SET score = ? WHERE id = ?")
      .run(Number(newScore), Number(id));
    log("AgentScoreUpdated", `#${id} ${oldScore} → ${newScore}`);
  });

  // ── TaskEscrow 状态机事件 ──
  escrow.on("TaskPosted", async (id, publisher, price, totalStaked, deadline, ev) => {
    const taskId = Number(id);
    // 双写对账：找到同雇主同价钱的最新草稿，把长文本字段"合体"进正式任务
    const draft = db.prepare(
      "SELECT * FROM task_drafts WHERE publisher = ? AND price_wei = ? ORDER BY id DESC LIMIT 1"
    ).get(lo(publisher), String(price));

    if (draft) {
      db.prepare(`
        INSERT OR REPLACE INTO tasks (id, publisher, price_wei, fee_wei, deadline, state, title, category, tags, description, candidates, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(taskId, lo(publisher), String(price), String(totalStaked - price),
        Number(deadline), "matching", draft.title, draft.category, draft.tags,
        draft.description, "[]", now());
      db.prepare("DELETE FROM task_drafts WHERE id = ?").run(draft.id);
      log("TaskPosted", `#${taskId}（已合并草稿 "${draft.title}"）`);
    } else {
      ensureTask(db, taskId, publisher, price, deadline);
      log("TaskPosted", `#${taskId}（无草稿，仅链上字段）`);
    }
    recordEvent(db, taskId, "TaskPosted", ev?.log?.blockNumber, { publisher, price: String(price) });

    // 新任务 → 推进匹配队列（第 9 步：Go 引擎消费）；Redis 不在就降级同步分发
    try {
      await enqueue(taskId);
      log("Enqueue", `任务#${taskId} 已入匹配队列（等 Go 引擎消费）`);
    } catch {
      log("Enqueue", `队列不可用，任务#${taskId} 降级为同步分发`);
      try { await dispatch(db, taskId); } catch { /* 匹配失败已有 match_runs 记录 */ }
    }
  });

  escrow.on("AgentAccepted", (id, agentId, agent, deposit, ev) => {
    const taskId = Number(id);
    ensureTask(db, taskId, "0x0000000000000000000000000000000000000000", 0n, 0n);
    db.prepare("UPDATE tasks SET agent_addr = ?, agent_id = ?, deposit_wei = ?, state = 'running' WHERE id = ?")
      .run(lo(agent), Number(agentId), String(deposit), taskId);
    recordEvent(db, taskId, "AgentAccepted", ev?.log?.blockNumber, { agent: lo(agent), deposit: String(deposit) });
    log("AgentAccepted", `#${taskId} → running`);

    // 接单即开工：有执行体的 Agent 真的跑去干活 → 交付物落库 → 代 submit 上链。
    // 不 await：链上事件监听绝不能被一个慢 Agent 拖住（失败它自己会落库记录）
    handleAccepted(taskId);
  });

  escrow.on("TaskSubmitted", (id, ev) => {
    db.prepare("UPDATE tasks SET state = 'review' WHERE id = ?").run(Number(id));
    recordEvent(db, Number(id), "TaskSubmitted", ev?.log?.blockNumber, {});
    log("TaskSubmitted", `#${id} → review`);
  });

  escrow.on("TaskApproved", async (id, agent, payout, ev) => {
    const taskId = Number(id);
    const t = db.prepare("SELECT publisher, agent_id FROM tasks WHERE id = ?").get(taskId);
    db.prepare("UPDATE tasks SET state = 'settled' WHERE id = ?").run(taskId);
    recordEvent(db, taskId, "TaskApproved", ev?.log?.blockNumber, { payout: String(payout) });
    creditAirdrop(db, t?.publisher, 5, "task_published", taskId);  // 雇主完单 +5
    creditAirdrop(db, agent, 20, "task_done", taskId);             // 工程师完单 +20
    log("TaskApproved", `#${id} → settled`);
    rescore(db, t?.agent_id); // 五维分落库 + 上链（不 await：别堵住后面的监听）
  });

  escrow.on("DisputeOpened", (id, by, ev) => {
    db.prepare("UPDATE tasks SET state = 'disputed' WHERE id = ?").run(Number(id));
    recordEvent(db, Number(id), "DisputeOpened", ev?.log?.blockNumber, { by: lo(by) });
    log("DisputeOpened", `#${id} → disputed`);
  });

  escrow.on("TaskRuled", async (id, ruling, arbitrationFee, ev) => {
    const taskId = Number(id);
    const t = db.prepare("SELECT publisher, agent_addr, agent_id FROM tasks WHERE id = ?").get(taskId);
    db.prepare("UPDATE tasks SET state = 'settled', ruling = ? WHERE id = ?").run(Number(ruling), taskId);
    recordEvent(db, taskId, "TaskRuled", ev?.log?.blockNumber, { ruling: Number(ruling) });
    // 裁决=完单的另一种形态：只给胜方记奖励（AgentWins/Split 给工程师，PublisherWins/ Split 给雇主）
    if (Number(ruling) !== 1) creditAirdrop(db, t?.agent_addr, 20, "task_done", taskId);
    if (Number(ruling) !== 0) creditAirdrop(db, t?.publisher, 5, "task_published", taskId);
    log("TaskRuled", `#${id} → settled（裁决 ${Number(ruling)}）`);
    rescore(db, t?.agent_id);
  });

  escrow.on("TaskCancelled", (id, refundedTo, depositSlashed, ev) => {
    db.prepare("UPDATE tasks SET state = 'cancelled' WHERE id = ?").run(Number(id));
    recordEvent(db, Number(id), "TaskCancelled", ev?.log?.blockNumber, { slashed: Boolean(depositSlashed) });
    log("TaskCancelled", `#${id} → cancelled`);
  });

  console.log("👂 [Relayer] 已挂载 9 个链上事件监听（AgentRegistry×2 + TaskEscrow×7）");

  // 启动即对一次账（不阻塞监听；失败只告警不崩——事件监听还在，实时数据不丢）
  backfillAgents(db).catch((e) => console.error("⚠️ [Relayer] 启动补账失败：", e.message));
}

module.exports = { startRelayer };
