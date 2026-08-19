// ═══════════════════════════════════════════════════════════════════
//  test/matching.test.js —— 三层漏斗单测（node:test，零额外依赖）
//  跑法：在 server/ 目录下  node --test
// ═══════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert");

const v0 = require("../matching/v0");
const v1 = require("../matching/v1");
const v2 = require("../matching/v2");

// ── 测试数据：3 个 Agent + 1 个写作任务 ──
const AGENTS = [
  { id: 1, name: "ScriptWriter Pro", category: "Writing", tags: ["script", "drama", "gpt"], priceWei: "50000000000000000", score: 80, status: "active" },
  { id: 2, name: "CodeWeaver", category: "Coding", tags: ["solidity", "audit", "defi"], priceWei: "120000000000000000", score: 60, status: "active" },
  { id: 3, name: "DataMiner X", category: "Data", tags: ["analysis", "pandas", "report"], priceWei: "80000000000000000", score: 40, status: "active" },
];
const TASK = {
  title: "写一个短视频带货剧本",
  category: "Writing",
  tags: ["script", "drama"],
  description: "需要 60 秒短剧脚本，带货美妆产品",
  priceWei: "50000000000000000",
};

// ── V0 ──
test("V0：tag 交集召回，只留沾边的", () => {
  const { candidates, recallCount, coldStart } = v0.recall(TASK, AGENTS);
  assert.equal(coldStart, false);
  assert.equal(recallCount, 1); // 只有 ScriptWriter Pro 命中 script/drama + Writing
  assert.equal(candidates[0].id, 1);
});

test("V0：无人沾边 → 冷启动全量兜底", () => {
  const odd = { ...TASK, tags: ["quantum"], category: "Quantum" };
  const { candidates, coldStart } = v0.recall(odd, AGENTS);
  assert.equal(coldStart, true);
  assert.equal(candidates.length, 3);
});

test("V0：Fisher-Yates 洗牌不丢不多（排列校验）", () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = v0.shuffle(src);
  assert.deepEqual([...out].sort((a, b) => a - b), src); // 元素一个不少
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8]);       // 原数组没被动
});

// ── V1 ──
test("V1：TF-IDF 余弦——最相关的 Agent 排第一", () => {
  const ranked = v1.rank(TASK, AGENTS);
  assert.equal(ranked[0].agentId, 1); // ScriptWriter Pro 文本最像
  assert.ok(ranked[0].sim > ranked[ranked.length - 1].sim);
});

test("V1：cosine 自身=1、正交=0（数学性质回归）", () => {
  const a = new Map([["x", 1], ["y", 2]]);
  const b = new Map([["x", 2], ["y", 4]]); // 同方向
  const c = new Map([["z", 3]]);           // 完全不同词
  assert.ok(Math.abs(v1.cosine(a, b) - 1) < 1e-9);
  assert.equal(v1.cosine(a, c), 0);
});

// ── V2 ──
test("V2：全零权重 → 中性先验 0.5（冷启动不瞎猜）", () => {
  const x = v2.featurize(TASK, AGENTS[0], { sim: 0.3, agentImpressions: 0 });
  assert.equal(v2.predict([], x), 0.5);
});

test("V2：SGD 训练可分数据 → 学出正确的偏好方向", () => {
  // 造 200 条样本：x[1]（tagOverlap）=1 的组 75% 被点击，=0 的组 25%
  // 用乘法散列造"确定性伪随机"——测试可重复，不靠 Math.random 碰运气
  const samples = [];
  for (let i = 0; i < 200; i++) {
    const overlap = i % 2;
    const clickProb = overlap === 1 ? 0.75 : 0.25;
    const r = ((i * 2654435761) % 1000) / 1000; // 0~1 伪随机
    samples.push({ x: [1, overlap, 0.2, 0.5, 0.5, 0, 0], y: r < clickProb ? 1 : 0 });
  }
  const w = v2.train(samples, { lr: 0.1, epochs: 100 });
  const good = v2.predict(w, [1, 1, 0.2, 0.5, 0.5, 0, 0]);
  const bad = v2.predict(w, [1, 0, 0.2, 0.5, 0.5, 0, 0]);
  // 逻辑回归的理论最优解就是组内真实点击率：≈0.75 / ≈0.25
  assert.ok(good > bad, `good=${good} 应大于 bad=${bad}`);
  assert.ok(good > 0.6 && bad < 0.4, `good=${good} bad=${bad}`);
});

test("V2：在线学习——点一次，该特征方向权重上调", () => {
  const x = v2.featurize(TASK, AGENTS[0], { sim: 0.5 });
  const before = v2.predict([], x);
  const w1 = v2.train([{ x, y: 1 }], { lr: 0.1, epochs: 1 });
  const after = v2.predict(w1, x);
  assert.ok(after > before, "点击后同特征预估 CTR 应上升");
});
