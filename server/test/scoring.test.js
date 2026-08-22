// ═══════════════════════════════════════════════════════════════════
//  test/scoring.test.js —— 五维评分单测（node:test，内存库零污染）
//  跑法：在 server/ 目录下  node --test
//  用 initSchema 建 :memory: 库——和生产同一个 schema 工厂，不会漂移
// ═══════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert");
const Database = require("better-sqlite3");
const { initSchema } = require("../db");
const { computeDims } = require("../scoring");

/** 造一个空库 + 1 个 Agent#1 */
function freshDb() {
  const db = new Database(":memory:");
  initSchema(db);
  db.prepare(
    "INSERT INTO agents (id, owner, name, price_wei) VALUES (1, '0xabc', 'T', '1000')"
  ).run();
  return db;
}

const addTask = (db, { id, state = "settled", rating = null, submittedAt = null, deadline = 9e9 }) => {
  db.prepare(
    "INSERT INTO tasks (id, publisher, agent_id, state, deadline, rating) VALUES (?, '0xpub', 1, ?, ?, ?)"
  ).run(id, state, deadline, rating);
  if (submittedAt) {
    db.prepare(
      "INSERT INTO task_events (task_id, name, args, created_at) VALUES (?, 'TaskSubmitted', '{}', ?)"
    ).run(id, new Date(submittedAt * 1000).toISOString());
  }
};

test("五维：全新 Agent（全无数据）恰好 50 分中性", () => {
  const dims = computeDims(freshDb(), 1);
  assert.equal(dims.completion, 50);
  assert.equal(dims.rating, 50);
  assert.equal(dims.resp, 50);
  assert.equal(dims.dispute, 100); // 无争议满分
  assert.equal(dims.scale, 0);     // 无单零分——两者刚好抵消
  assert.equal(dims.score, 50);
});

test("五维·雇主评分：5 星=100、3 星=60、均价折算", () => {
  const db = freshDb();
  addTask(db, { id: 1, rating: 5 });
  assert.equal(computeDims(db, 1).rating, 100);
  addTask(db, { id: 2, rating: 3 });
  assert.equal(computeDims(db, 1).rating, Math.round((4 / 5) * 100)); // 均价 4 星
});

test("五维·完成强度：接 2 单结 1 单 + 全准时 → 0.6×50+0.4×100=70", () => {
  const db = freshDb();
  addTask(db, { id: 1, state: "running" });                       // 接了没结
  addTask(db, { id: 2, state: "settled", submittedAt: 1 });       // 结了且准时
  const dims = computeDims(db, 1);
  assert.equal(dims.completion, 70);
  assert.equal(dims.scale, Math.round((100 * Math.log2(2)) / Math.log2(11))); // 1 单结算的对数刻度
});

test("五维·争议率：无争议=100；裁决 2 次败诉 1 次（败诉= ruling 0）→ 50", () => {
  const db = freshDb();
  addTask(db, { id: 1 });
  assert.equal(computeDims(db, 1).dispute, 100);
  const addRuling = (id, ruling) => db.prepare(
    "INSERT INTO task_events (task_id, name, args) VALUES (?, 'TaskRuled', ?)"
  ).run(id, JSON.stringify({ ruling }));
  addRuling(1, 1); // Agent 胜
  addRuling(1, 0); // 雇主胜 = Agent 败诉
  assert.equal(computeDims(db, 1).dispute, 50);
});

test("五维·综合分：范围 [0,100] 且是加权合成（抽查权重 70/15/10/2.5/2.5）", () => {
  const db = freshDb();
  addTask(db, { id: 1, rating: 5, submittedAt: 1 }); // 结算+准时+5星
  db.prepare("INSERT INTO impressions (task_id, agent_id, clicked) VALUES (9, 1, 1)").run();
  const d = computeDims(db, 1);
  assert.equal(
    d.score,
    Math.round(0.7 * d.completion + 0.15 * d.rating + 0.1 * d.resp + 0.025 * d.dispute + 0.025 * d.scale)
  );
  assert.ok(d.score >= 0 && d.score <= 100);
  assert.ok(d.score > 50, "结算+准时+5星+点击 全绿应高于中性 50");
});
