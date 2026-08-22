// ═══════════════════════════════════════════════════════════════════
//  matching/index.js —— 三层漏斗编排器（V0 召回 → V1 精排 → V2 重排）
//
//  漏斗形状（S5 页面的数据源，对应课堂话术 1,024 → 156 → 12 → 展示 3）：
//    V0 tag/category 粗召回（便宜，宁多勿漏，洗牌保公平）
//    V1 精排（embedding 远程引擎优先，降级本地 TF-IDF 余弦；砍掉不相关的）
//    V2 逻辑回归 CTR 重排（预估点击率，取 Top3 给雇主看）
//
//  副作用：candidates 写回 tasks 表、曝光写 impressions 表、
//          漏斗过程写 match_runs 表（死信也记一条，S5 可见）。
// ═══════════════════════════════════════════════════════════════════
const v0 = require("./v0");
const v1 = require("./v1");
const v2 = require("./v2");
const embed = require("./embed");

const now = () => new Date().toISOString();
const asTask = (row) => ({
  ...row,
  tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
});

/** 权重持久化：model_weights 表 key='v2'。空表 → predict 输出 0.5 中性先验 */
function loadWeights(db) {
  const r = db.prepare("SELECT weights FROM model_weights WHERE key = 'v2'").get();
  return r ? JSON.parse(r.weights) : [];
}
function saveWeights(db, weights) {
  db.prepare(`
    INSERT INTO model_weights (key, weights, updated_at) VALUES ('v2', ?, ?)
    ON CONFLICT(key) DO UPDATE SET weights = excluded.weights, updated_at = excluded.updated_at
  `).run(JSON.stringify(weights), now());
}

/** 每个 Agent 的历史曝光数（freshness 特征 + 在线学习的样本统计） */
function impressionCounts(db) {
  const rows = db.prepare("SELECT agent_id, COUNT(*) AS c FROM impressions GROUP BY agent_id").all();
  return new Map(rows.map((r) => [r.agent_id, r.c]));
}

/** 给前端/报告用的"推荐理由"（可解释性是加分项：说得清为什么推它） */
function reasons(f, task, coldStart) {
  const r = [];
  if (f.x[1] > 0) r.push(`tag 命中 ${(f.x[1] * 100) | 0}%`);
  if (f.sim >= 0.05) r.push(`文本相似 ${f.sim.toFixed(2)}`);
  if (f.x[5] === 1) r.push("分类对口");
  if (f.x[6] === 1) r.push("新 Agent 探索位");
  if (coldStart) r.push("冷启动全量召回");
  r.push(`pCTR ${(f.pctr * 100).toFixed(1)}%`);
  return r;
}

/**
 * 单次分发：跑完整漏斗并落库。candidates 为空 → 记死信返回 dead（第 9 步队列还有第二层死信）。
 * async：V1 优先走远程 embedding（一次 API 调用批量向量化），未配置/失败降级本地 TF-IDF——
 * 引擎与降级原因写进 report.layers.v1.engine，S5 可观测。
 */
async function dispatch(db, taskId) {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!row) throw new Error("task not found");
  const task = asTask(row);
  const agents = db
    .prepare("SELECT * FROM agents WHERE status != 'delisted'")
    .all()
    .map(asTask); // DB 行的 tags 是逗号分隔字符串 → 统一转数组再进漏斗

  const report = { taskId, at: now(), layers: {}, final: [] };

  // ── V0 粗召回 ──
  const { candidates, recallCount, coldStart } = v0.recall(task, agents);
  report.layers.v0 = { in: agents.length, out: candidates.length, recallCount, coldStart };
  if (candidates.length === 0) {
    report.dead = true;
    report.deadReason = "no_active_agents";
    db.prepare("INSERT INTO match_runs (task_id, status, detail, created_at) VALUES (?,?,?,?)")
      .run(taskId, "dead", JSON.stringify(report), now());
    return report;
  }

  // ── V1 精排：远程 embedding 优先，未配置/超时/报错 → 自动降级本地 TF-IDF ──
  let sims = null;
  report.layers.v1 = { in: candidates.length };
  if (embed.available()) {
    try {
      const vecs = await embed.embedTexts([v1.taskText(task), ...candidates.map(v1.agentText)]);
      const [qv, ...avs] = vecs;
      sims = candidates
        .map((a, i) => ({ agentId: a.id, sim: embed.denseCosine(qv, avs[i]) }))
        .sort((x, y) => y.sim - x.sim);
      report.layers.v1.engine = `embedding:${process.env.EMBEDDING_MODEL}`;
    } catch (e) {
      report.layers.v1.engine = "tfidf";
      report.layers.v1.fallback = `embedding 不可用已降级（${e.message}），熔断 5 分钟`;
    }
  } else {
    report.layers.v1.engine = "tfidf";
  }
  if (!sims) sims = v1.rank(task, candidates);
  const simById = new Map(sims.map((s) => [s.agentId, s.sim]));
  report.layers.v1.out = sims.length;
  report.layers.v1.top = sims[0];

  // ── V2 CTR 重排 ──
  const weights = loadWeights(db);
  const imps = impressionCounts(db);
  const scored = candidates
    .map((a) => {
      const x = v2.featurize(task, a, { // a 已在入口 map(asTask) 转过，别再转
        sim: simById.get(a.id) ?? 0,
        agentImpressions: imps.get(a.id) ?? 0,
      });
      return { a, x, sim: simById.get(a.id) ?? 0, pctr: v2.predict(weights, x) };
    })
    .sort((p, q) => q.pctr - p.pctr);

  const top = scored.slice(0, Math.min(3, scored.length));
  report.layers.v2 = { in: scored.length, out: top.length, weightsTrained: weights.length > 0 };

  // ── 落库：结果 + 曝光 + 漏斗报告 ──
  report.final = top.map((f, i) => ({
    agentId: f.a.id, name: f.a.name, priceWei: f.a.price_wei,
    sim: +f.sim.toFixed(4), pctr: +f.pctr.toFixed(4), position: i + 1,
    reasons: reasons(f, task, coldStart),
  }));

  db.prepare("UPDATE tasks SET candidates = ? WHERE id = ?").run(JSON.stringify(report.final), taskId);
  const insImp = db.prepare(
    "INSERT INTO impressions (task_id, agent_id, position, clicked, created_at) VALUES (?,?,?,0,?)"
  );
  top.forEach((f, i) => insImp.run(taskId, f.a.id, i + 1, now()));
  db.prepare("INSERT INTO match_runs (task_id, status, detail, created_at) VALUES (?,?,?,?)")
    .run(taskId, "done", JSON.stringify(report), now());

  return report;
}

/** 在线学习：某候选被点击 → 记 click + 用这条真实样本微调权重（SGD 一小步） */
function recordClick(db, taskId, agentId) {
  const imp = db.prepare(
    "SELECT * FROM impressions WHERE task_id = ? AND agent_id = ?"
  ).get(taskId, agentId);
  if (!imp || imp.clicked) return { ok: false, error: "曝光记录不存在或已点击" };

  const trow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  const arow = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
  const task = asTask(trow), agent = asTask(arow);

  const candidate = JSON.parse(trow.candidates || "[]").find((c) => c.agentId === agentId);
  const x = v2.featurize(task, agent, { sim: candidate?.sim ?? 0, agentImpressions: 1 });
  const weights = loadWeights(db);
  const before = v2.predict(weights, x);

  const newWeights = v2.train([{ x, y: 1 }], { initWeights: weights, lr: 0.05, epochs: 3 });
  saveWeights(db, newWeights);

  db.prepare("UPDATE impressions SET clicked = 1 WHERE task_id = ? AND agent_id = ?")
    .run(taskId, agentId);

  return { ok: true, agentId, pctrBefore: +before.toFixed(4), pctrAfter: +v2.predict(newWeights, x).toFixed(4) };
}

module.exports = { dispatch, recordClick };
