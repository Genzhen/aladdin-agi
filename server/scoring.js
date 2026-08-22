// ═══════════════════════════════════════════════════════════════════
//  scoring.js —— 五维评分聚合（纯读库计算，PRD §5 权重 70/15/10/2.5/2.5）
//
//  维度定义（每一维 0~100，无数据给中性值，绝不因"新"而惩罚）：
//    completion 完成强度(70%)：结算率 + 准时率加权——干了活拿到钱、还赶在
//               deadline 前交付（结算含仲裁胜/平，同样算"完成"）
//    rating    雇主评分(15%)：验收时雇主打的星级 1~5（均价归一 0~100）
//    resp      沟通响应(10%)：被推荐后被点击的比率（曝光→点击，代理响应速度）
//    dispute   争议率(2.5%)：无争议=满分；有争议按非败诉占比（败诉=裁决归雇主）
//    scale     历史规模(2.5%)：累计结算单量对数刻度，10 单封顶 100
//
//  被删掉的旧维度：speed（并进 completion）、price（便宜≠信誉，价格信号
//  留在匹配层 V2 的 priceFit 特征里，不进信誉分）。
//  数学彩蛋：全新 Agent（全无数据）恰好得 50 分中性分——
//    0.7×50 + 0.15×50 + 0.1×50 + 0.025×100 + 0.025×0 = 50
//  （dispute 无争议=100 与 scale 无单=0 相互抵消，冷启动不偏不倚）。
// ═══════════════════════════════════════════════════════════════════

/** 给定 agentId，算五维分 + 综合分（detail 页 & updateScore 上链共用） */
function computeDims(db, agentId) {
  const agent = db.prepare("SELECT price_wei FROM agents WHERE id = ?").get(agentId);
  if (!agent) return null;

  // ── 完成强度：结算率（0.6）+ 准时率（0.4）──
  // assigned = 接过的单（进了运行态）；settled = 走到结算的（含裁决胜/平）
  const assigned = db.prepare(
    "SELECT COUNT(*) AS c FROM tasks WHERE agent_id = ? AND state IN ('running','review','settled')"
  ).get(agentId).c;
  const settled = db.prepare(
    "SELECT COUNT(*) AS c FROM tasks WHERE agent_id = ? AND state = 'settled'"
  ).get(agentId).c;
  const settleRate = assigned === 0 ? 0.5 : settled / assigned;

  // 准时率：所有 TaskSubmitted 事件里，交付时间 < deadline 的占比
  const submits = db.prepare(`
    SELECT e.created_at AS at, t.deadline AS dl
    FROM task_events e JOIN tasks t ON t.id = e.task_id
    WHERE e.name = 'TaskSubmitted' AND t.agent_id = ?
  `).all(agentId);
  const onTime = submits.filter((s) => new Date(s.at).getTime() / 1000 < Number(s.dl)).length;
  const onTimeRate = submits.length === 0 ? 0.5 : onTime / submits.length;

  const completion = assigned === 0 && submits.length === 0
    ? 50 // 全新 Agent：中性
    : Math.round(100 * (0.6 * settleRate + 0.4 * onTimeRate));

  // ── 雇主评分：验收星级均价（1~5 → 0~100），未评给中性 50 ──
  const r = db.prepare(
    "SELECT AVG(rating) AS avg, COUNT(*) AS n FROM tasks WHERE agent_id = ? AND rating IS NOT NULL"
  ).get(agentId);
  const rating = r.n === 0 ? 50 : Math.round((r.avg / 5) * 100);

  // ── 沟通响应：曝光→点击比率（无曝光给中性 50）──
  const imp = db.prepare("SELECT COUNT(*) AS c FROM impressions WHERE agent_id = ?").get(agentId).c;
  const clicks = db.prepare("SELECT COUNT(*) AS c FROM impressions WHERE agent_id = ? AND clicked = 1").get(agentId).c;
  const resp = imp === 0 ? 50 : Math.round((100 * clicks) / imp);

  // ── 争议率：无争议=满分；有争议按非败诉占比（败诉=裁决 0/雇主胜）──
  const rulings = db.prepare(`
    SELECT e.args FROM task_events e JOIN tasks t ON t.id = e.task_id
    WHERE e.name = 'TaskRuled' AND t.agent_id = ?
  `).all(agentId).map((e) => { try { return JSON.parse(e.args).ruling; } catch { return null; } });
  const dispute = rulings.length === 0
    ? 100
    : Math.round((100 * rulings.filter((x) => x !== 0).length) / rulings.length);

  // ── 历史规模：结算单量对数刻度，10 单封顶（第 1 单=29，第 3 单=58，第 10 单=100）──
  const scale = Math.min(100, Math.round((100 * Math.log2(settled + 1)) / Math.log2(11)));

  const score = Math.round(0.7 * completion + 0.15 * rating + 0.1 * resp + 0.025 * dispute + 0.025 * scale);
  return {
    completion, rating, resp, dispute, scale, score,
    note: `接${assigned}单结${settled} · 提交${submits.length}次准时${onTime} · 星级${r.n ? r.avg.toFixed(1) : '–'}(${r.n}) · 曝光${imp}点击${clicks} · 争议${rulings.length}次 · 结算规模${settled}单`,
  };
}

module.exports = { computeDims };
