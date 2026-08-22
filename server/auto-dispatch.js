// ═══════════════════════════════════════════════════════════════════
//  auto-dispatch.js —— 自动派遣器（替开了"自动接单"的 Agent 抢单）
//
//  语义（对齐真实市场：滴滴司机听单）：
//    Agent owner 在详情页打开「自动接单」→ 新任务匹配完成 45s 内无人手动接
//    → 平台替候选里第一个（开开关 + active + 有执行体）的 Agent 代签 accept
//    → AgentAccepted 事件走既有 agent-runner 链路（交付 → 代签 submit）。
//
//  设计点（面试话术）：
//  1. 轮询而非事件驱动：matching 完成时刻只落在 match_runs 表（无链上事件），
//     15s 扫一次对演示规模绰绰有余。生产替换点：匹配引擎算完投延迟队列。
//  2. 幂等的最后裁决权在合约：accept 时任务若已非 matching 会 revert，
//     catch 记日志即放弃——手动/自动竞态不用脚本里的锁，链上天然仲裁。
//  3. 资金安全：只花部署钱包自己的 ETH；垫付的保证金验收后随货款回同一钱包。
// ═══════════════════════════════════════════════════════════════════
const { getDb } = require("./db");
const { acceptOnchain } = require("./admin");

const SCAN_EVERY_MS = 15_000;    // 扫描间隔
const LISTEN_WINDOW_MS = 45_000; // 手动接单优先窗口：匹配完成 45s 后才自动派

const log = (msg) => console.log(`🎯 [auto-dispatch] ${msg}`);

/** 该任务最近一次匹配成功的时刻（无 = 引擎还没跑过，不派） */
function lastMatchedAtMs(db, taskId) {
  const r = db.prepare(
    "SELECT created_at FROM match_runs WHERE task_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1"
  ).get(taskId);
  return r ? Date.parse(r.created_at) : null;
}

/** 候选列表（按推荐名次）里第一个"愿意听单"的 Agent：active + 有执行体 + 开了自动接单 */
function firstListener(db, candidates) {
  for (const c of candidates || []) {
    const a = db.prepare(
      "SELECT id, name, auto_accept, status, endpoint FROM agents WHERE id = ?"
    ).get(c.agentId);
    if (a && a.status !== "delisted" && a.endpoint && a.auto_accept) return a;
  }
  return null;
}

async function scanOnce() {
  const db = getDb();
  const rows = db.prepare("SELECT id, price_wei, candidates FROM tasks WHERE state = 'matching'").all();
  for (const t of rows) {
    const matchedAt = lastMatchedAtMs(db, t.id);
    if (!matchedAt || Date.now() - matchedAt < LISTEN_WINDOW_MS) continue; // 没匹配过 / 还在手动窗口

    const listener = firstListener(db, JSON.parse(t.candidates || "[]"));
    if (!listener) continue; // 没人听单，留给手动（保持日志干净）

    try {
      await acceptOnchain(t.id, listener.id, t.price_wei);
      log(`任务#${t.id} 已替 Agent#${listener.id} ${listener.name} 接单（45s 窗口无人手动接）`);
    } catch (e) {
      // 多半是竞态：窗口内被人手动接了，accept 被 revert——链上已裁决，认输即可
      log(`任务#${t.id} 派遣放弃：${String(e.message || e).slice(0, 140)}`);
    }
  }
}

/** 启动轮询（index.js 调）。deployed/artifacts 缺失会在这里抛错，捕获后降级为不启动 */
function startAutoDispatch() {
  try {
    if (!require("./admin").adminAddress) {
      return console.warn("⚠️ [auto-dispatch] 无 admin 签名者，自动派遣不启动");
    }
    setInterval(() => {
      scanOnce().catch((e) => console.error("⚠️ [auto-dispatch] 扫描异常:", e.message));
    }, SCAN_EVERY_MS);
    log(`就绪：每 ${SCAN_EVERY_MS / 1000}s 扫描，匹配后 ${LISTEN_WINDOW_MS / 1000}s 无人接则替听单 Agent 抢单`);
  } catch (e) {
    console.warn("⚠️ [auto-dispatch] 未启动:", e.message);
  }
}

module.exports = { startAutoDispatch, scanOnce, firstListener, lastMatchedAtMs };
