// ═══════════════════════════════════════════════════════════════════
//  scoring.js —— 五维评分聚合（纯读库计算，PRD §5 权重 70/15/10/5）
//
//  维度定义（每一维 0~100，无数据给中性值，绝不因"新"而惩罚）：
//    quality 质量(70%)：接单里最终结算（含仲裁胜/平）的占比——干了活拿到钱的比率
//    speed   速度(15%)：交付是否赶在 deadline 前（按 task_events 的提交时间戳）
//    price   价格(10%)：报价在全体 Agent 里的便宜百分位（越便宜越高）
//    resp    响应(5%)：被推荐后被点击的比率（曝光→点击，代理"响应速度"）
//  综合 score = 0.7q + 0.15s + 0.1p + 0.05r，四舍五入成链上 0~100 整数。
// ═══════════════════════════════════════════════════════════════════

/** 给定 agentId，算五维分 + 综合分（detail 页 & updateScore 上链共用） */
function computeDims(db, agentId) {
  const agent = db.prepare("SELECT price_wei FROM agents WHERE id = ?").get(agentId);
  if (!agent) return null;

  // ── 质量：assigned = 接过的单；settled = 走到结算的（含裁决平/胜）──
  const assigned = db.prepare(
    "SELECT COUNT(*) AS c FROM tasks WHERE agent_id = ? AND state IN ('running','review','settled')"
  ).get(agentId).c;
  const settled = db.prepare(
    "SELECT COUNT(*) AS c FROM tasks WHERE agent_id = ? AND state = 'settled'"
  ).get(agentId).c;
  const quality = assigned === 0 ? 50 : Math.round(60 + (40 * settled) / assigned);

  // ── 速度：所有 TaskSubmitted 事件里，交付时间 < deadline 的占比 ──
  const submits = db.prepare(`
    SELECT e.created_at AS at, t.deadline AS dl
    FROM task_events e JOIN tasks t ON t.id = e.task_id
    WHERE e.name = 'TaskSubmitted' AND t.agent_id = ?
  `).all(agentId);
  const onTime = submits.filter((s) => new Date(s.at).getTime() / 1000 < Number(s.dl)).length;
  const speed = submits.length === 0 ? 50 : Math.round((100 * onTime) / submits.length);

  // ── 价格：报价百分位（最便宜=100，最贵=0；只有一个 Agent 时=75）──
  const prices = db.prepare("SELECT id, price_wei FROM agents WHERE status != 'delisted' ORDER BY CAST(price_wei AS INTEGER)").all();
  const rank = prices.findIndex((p) => p.id === agentId);
  const price = prices.length <= 1 ? 75 : Math.round(100 - (100 * rank) / (prices.length - 1));

  // ── 响应：曝光→点击比率（无曝光给中性 50）──
  const imp = db.prepare("SELECT COUNT(*) AS c FROM impressions WHERE agent_id = ?").get(agentId).c;
  const clicks = db.prepare("SELECT COUNT(*) AS c FROM impressions WHERE agent_id = ? AND clicked = 1").get(agentId).c;
  const resp = imp === 0 ? 50 : Math.round((100 * clicks) / imp);

  const score = Math.round(0.7 * quality + 0.15 * speed + 0.1 * price + 0.05 * resp);
  return {
    quality, speed, price, resp, score,
    note: `质量${assigned}单结算${settled} · 提交${submits.length}次准时${onTime} · 报价第${rank + 1}档 · 曝光${imp}点击${clicks}`,
  };
}

module.exports = { computeDims };
