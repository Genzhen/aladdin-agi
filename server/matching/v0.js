// ═══════════════════════════════════════════════════════════════════
//  matching/v0.js —— 三层漏斗第 1 层【V0 粗召回】（课堂作业：tag 硬匹配+洗牌选3+冷启动）
//  职责：从全体 Agent 里"宁多勿漏"地捞出沾边的候选，便宜、可解释。
//  规则：tag 有交集 或 category 相同 → 进漏斗；
//        一个都不沾 → 冷启动兜底（全量进漏斗——平台早期没数据，先保证有人接单）；
//        Fisher-Yates 洗牌 → 同分候选的曝光机会均等（新 Agent 也能被看到 = exploration）。
//  生产替换点：倒排索引（tag → agent 集合）、向量库 ANN 检索。
// ═══════════════════════════════════════════════════════════════════

/** Fisher-Yates 洗牌：从后往前，每个位置和"它之前的随机位置"交换。O(n)，不动原数组 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 召回：task {category, tags[]} × agents [{id, category, tags, status}]
 * 返回 { candidates, recallCount, coldStart }——candidates 已洗牌、截断到 limit
 */
function recall(task, agents, { limit = 12 } = {}) {
  const active = agents.filter((a) => a.status !== "delisted");
  const taskTags = new Set((task.tags || []).map((t) => String(t).toLowerCase()));

  const hit = active.filter((a) => {
    const sameCat =
      a.category && task.category &&
      a.category.toLowerCase() === task.category.toLowerCase();
    const overlap = (a.tags || []).some((t) => taskTags.has(String(t).toLowerCase()));
    return sameCat || overlap;
  });

  const coldStart = hit.length === 0; // 没人沾边 → 全量兜底（记进报告，S5 页面要展示）
  const pool = coldStart ? active : hit;

  return {
    candidates: shuffle(pool).slice(0, limit),
    recallCount: pool.length,
    coldStart,
  };
}

module.exports = { recall, shuffle };
