// ═══════════════════════════════════════════════════════════════════
//  matching/v1.js —— 三层漏斗第 2 层【V1 精排：手写 TF-IDF + 余弦相似度】
//  课堂作业要求"手写向量检索"：不用任何库，把原理写穿。
//
//  直觉（面试话术）：
//   - TF  词频：一个词在这篇文档出现越多越重要（但会被"的/the"灌水）
//   - IDF 逆文档频率：全库只有 1 篇文档有的词才是"指纹级"的词 → log(N/df) 加权
//   - 余弦相似度：两篇文档各自变成高维向量，算夹角 cos；只看方向不看长度
//   （文档长短不影响相似度，正好适合"任务一句话 vs Agent 长简介"）
//
//  生产替换点：sentence-transformers 语义向量 + FAISS/Milvus ANN 检索。
// ═══════════════════════════════════════════════════════════════════

/** 分词：小写 + 按非字母数字切开（英文够用；中文需换 jieba/字粒度，记为已知限制） */
function tokenize(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

/** Agent 的"文档" = 名字 + 分类 + tags + 简介，全部拼起来算 */
function agentDoc(a) {
  return tokenize(
    [a.name, a.category, (a.tags || []).join(" "), a.description].join(" ")
  );
}

/** 任务侧"查询" = 标题 + 分类 + tags + 描述 */
function taskDoc(task) {
  return tokenize(
    [task.title, task.category, (task.tags || []).join(" "), task.description].join(" ")
  );
}

/** IDF 表：df=出现该词的文档数；+1 平滑防止除零，+1 整体防止负权 */
function buildIdf(docs) {
  const df = new Map();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) || 0) + 1);
  }
  const idf = new Map();
  for (const [term, n] of df) idf.set(term, Math.log((docs.length + 1) / (n + 1)) + 1);
  return idf;
}

/** 向量化：稀疏 Map {term: tf * idf}。查询里遇到语料没有的词用最高 IDF（最稀有）兜底 */
function vectorize(doc, idf) {
  const tf = new Map();
  for (const t of doc) tf.set(t, (tf.get(t) || 0) + 1);
  const maxIdf = Math.max(1, ...idf.values());
  const vec = new Map();
  for (const [term, n] of tf) {
    vec.set(term, (n / doc.length) * (idf.get(term) ?? maxIdf));
  }
  return vec;
}

/** 余弦相似度：dot(a,b) / (|a|*|b|)。稀疏 Map 只需遍历较短的那边 */
function cosine(a, b) {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, v] of small) dot += v * (big.get(term) || 0);
  const norm = (m) => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot / d;
}

/**
 * 精排：candidates 按"与任务的余弦相似度"降序，返回 [{agentId, sim}]
 * 评分 0~1：0.2 以上算相关（经验阈值，写进 S5 展示）
 */
function rank(task, candidates) {
  const docs = candidates.map((a) => ({ id: a.id, doc: agentDoc(a) }));
  const idf = buildIdf(docs.map((d) => d.doc));
  const qv = vectorize(taskDoc(task), idf);

  return docs
    .map(({ id, doc }) => ({ agentId: id, sim: cosine(qv, vectorize(doc, idf)) }))
    .sort((x, y) => y.sim - x.sim);
}

module.exports = { tokenize, buildIdf, vectorize, cosine, rank };
