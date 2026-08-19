// ═══════════════════════════════════════════════════════════════════
//  matching/v2.js —— 三层漏斗第 3 层【V2 重排：手写逻辑回归 + SGD 在线学习 CTR】
//  课堂作业要求"手写 CTR 模型"：预估"这个 Agent 展示给这个雇主后，被点击的概率"。
//
//  直觉（面试话术）：
//   - 线性打分 z = w·x（x=特征向量，w=权重），sigmoid(z) 压到 0~1 当概率
//   - 训练 = 拿真实曝光/点击当教材：预测 p、真值 y，误差 (y-p) 乘特征回填权重
//     —— 这就是 SGD（随机梯度下降），一行公式，没有黑盒
//   - 在线学习：用户每点一次，立刻用这条样本微调权重（模型永远新鲜，不用重训）
//   - 探索/利用：新 Agent 没有 click 历史 → freshness 特征 + V0 洗牌保证曝光，
//     避免马太效应（头部 Agent 永远第一，新 Agent 永远没数据）
//
//  纯函数模块（权重读写由 index.js 管），方便单测。
//  生产替换点：FTRL/GBDT+LR、特征平台、离线批量重训+A/B。
// ═══════════════════════════════════════════════════════════════════

/** 特征名（顺序即向量下标，训练/预测必须同一套；bias 放第一位） */
const FEATURES = [
  "bias", "tagOverlap", "tfidfSim", "scoreNorm", "priceFit", "categoryMatch", "freshness",
];

/**
 * 特征工程：把 (任务, Agent, 上下文) 变成 7 维向量。
 * ctx = { sim: V1 算出的余弦, agentImpressions: 该 Agent 历史曝光数 }
 */
function featurize(task, agent, ctx = {}) {
  const taskTags = new Set((task.tags || []).map((t) => String(t).toLowerCase()));
  const overlap = (agent.tags || []).filter((t) =>
    taskTags.has(String(t).toLowerCase())
  ).length;
  const tagOverlap = overlap / Math.max(1, taskTags.size);

  const tfidfSim = ctx.sim ?? 0;
  const scoreNorm = (agent.score || 0) / 100;

  // 价格契合：Agent 报价越接近任务预算分越高（对数尺度：差 2 倍扣一半）
  const pA = Number(agent.priceWei || 0), pT = Number(task.priceWei || 1);
  const priceFit = pA > 0 && pT > 0 ? 1 / (1 + Math.abs(Math.log(pA / pT))) : 0;

  const categoryMatch =
    agent.category && task.category &&
    agent.category.toLowerCase() === task.category.toLowerCase() ? 1 : 0;

  const freshness = (ctx.agentImpressions ?? 99) < 5 ? 1 : 0; // 冷启动 Agent 标记位

  return [1, tagOverlap, tfidfSim, scoreNorm, priceFit, categoryMatch, freshness];
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** 预估 CTR：w·x 过 sigmoid。权重缺失时全 0 → 恒输出 0.5（冷启动中性先验） */
function predict(weights, x) {
  const w = weights.length ? weights : FEATURES.map(() => 0);
  const z = w.reduce((s, wi, i) => s + wi * (x[i] ?? 0), 0);
  return sigmoid(z);
}

/**
 * SGD 训练一轮：samples = [{x, y}]（y=1 点击 / 0 未点）
 * w ← w + lr * (y - p) * x   （梯度上升最大化对数似然）
 * l2 极小正则防权重爆炸（λ=1e-6，教学保留位数）
 */
function train(samples, { initWeights, lr = 0.1, epochs = 20, l2 = 1e-6 } = {}) {
  const w = initWeights && initWeights.length ? [...initWeights] : FEATURES.map(() => 0);
  for (let e = 0; e < epochs; e++) {
    shuffleInPlace(samples); // 打乱样本顺序，梯度更"随机"（SGD 的 S）
    for (const { x, y } of samples) {
      const p = predict(w, x);
      for (let i = 0; i < w.length; i++) {
        w[i] += lr * ((y - p) * (x[i] ?? 0) - l2 * w[i]);
      }
    }
  }
  return w;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

module.exports = { FEATURES, featurize, predict, train };
