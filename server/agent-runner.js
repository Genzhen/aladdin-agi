// ═══════════════════════════════════════════════════════════════════
//  agent-runner.js —— 任务派发器：接单后把活真的派给 Agent 执行体
//
//  位置在链路里（这就是 MVP 里被掏空的那一环，现在填上了）：
//    AgentAccepted(链上 Running) →【本文件】→ POST 执行体 /run
//      → 交付物落 task_results → 代工程师 submit 上链 → Review
//
//  设计点（面试话术）：
//  1. endpoint 为空的 Agent 直接跳过——"纯挂牌"和"有执行体"两种
//     Agent 在同一个市场共存，行为完全兼容（登记记录≠执行体）。
//  2. 执行体失败（挂了/超时/返回 ok:false）只落库不上链：任务的
//     Running 状态不动，工程师仍可手动 submit 或等超时罚没——
//     失败被诚实暴露，而不是硬推状态机。
//  3. 生产替换点：这一步换成 MQ 派发 + Agent 侧心跳/重试/幂等键；
//     submit 改为 Agent 自己签名，本 relayer 只做路由。
// ═══════════════════════════════════════════════════════════════════
const { getDb } = require("./db");
const { submitOnchain } = require("./admin");

const now = () => new Date().toISOString();
const log = (tag, msg) => console.log(`🏃 [agent-runner] ${tag} ${msg}`);

/** 把任务派给接单 Agent 的执行体；成功则代 submit。任何异常都向上抛（调用方 catch 记录） */
async function runAgentForTask(taskId) {
  const db = getDb();
  const t = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!t || !t.agent_id) return;

  const a = db.prepare("SELECT id, name, endpoint FROM agents WHERE id = ?").get(t.agent_id);
  if (!a || !a.endpoint) {
    log("Skip", `任务#${taskId} 的 Agent#${t.agent_id} 无执行体（纯挂牌），状态保持 running 等手动 submit`);
    return;
  }

  log("Start", `任务#${taskId} → ${a.name}（${a.endpoint}）开始干活`);
  const res = await fetch(`${a.endpoint.replace(/\/$/, "")}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId,
      title: t.title,
      description: t.description,
      category: t.category,
      tags: t.tags,
      deadline: t.deadline,
    }),
    signal: AbortSignal.timeout(60_000), // 执行体卡死不能拖垮 Relayer（LLM 生成预算 ~50s + 落库余量；本地算法执行体远用不到）
  });
  const data = await res.json();

  if (!data.ok) throw new Error(data.error || `执行体返回 ok:false`);

  db.prepare(`
    INSERT INTO task_results (task_id, agent_id, endpoint, ok, output, error, created_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(task_id) DO UPDATE SET agent_id=excluded.agent_id, endpoint=excluded.endpoint,
      ok=excluded.ok, output=excluded.output, error=excluded.error, created_at=excluded.created_at
  `).run(taskId, t.agent_id, a.endpoint, 1, data.output, "", now());
  log("Done", `任务#${taskId} 交付物 ${(String(data.output).length / 1000).toFixed(1)}k 字已落库，准备上链 submit`);

  await submitOnchain(taskId); // Running → Review，链上事件回来再翻库里的 state
}

/**
 * 失败落库（ok=0）：任务留在 Running，工程师可手动 submit 补救。
 * 单独包一层是为了让 runAgentForTask 的 try/catch 都走这一个出口。
 */
function recordFailure(taskId, agentId, endpoint, message) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO task_results (task_id, agent_id, endpoint, ok, output, error, created_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(task_id) DO UPDATE SET ok=0, error=excluded.error, created_at=excluded.created_at
    `).run(taskId, agentId || 0, endpoint || "", 0, "", String(message).slice(0, 500), now());
  } catch (e) {
    console.error("⚠️ [agent-runner] 失败信息落库也失败了:", e.message);
  }
}

/** Relayer 的 AgentAccepted 钩子调这个：干活 + 记失败，永不 reject（不堵事件监听） */
async function handleAccepted(taskId) {
  const db = getDb();
  const t = db.prepare("SELECT agent_id FROM tasks WHERE id = ?").get(taskId);
  const a = t?.agent_id ? db.prepare("SELECT endpoint FROM agents WHERE id = ?").get(t.agent_id) : null;
  try {
    await runAgentForTask(taskId);
  } catch (e) {
    console.error(`⚠️ [agent-runner] 任务#${taskId} 执行失败:`, e.message);
    recordFailure(taskId, t?.agent_id, a?.endpoint || "", e.message);
  }
}

module.exports = { handleAccepted };
