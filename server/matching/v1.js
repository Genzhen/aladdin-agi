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
//  本文件是 V1 的【本地引擎】（永远可用、可单测）。远程语义引擎在 embed.js：
//  配了 EMBEDDING_* 环境变量时 dispatch 优先用真 embedding，失败自动降级到这里。
//  生产替换点：向量缓存表 + FAISS/Milvus ANN 检索（现每次 dispatch 现算）。
// ═══════════════════════════════════════════════════════════════════

/**
 * 中英混合分词（原版只切 [a-z0-9]+，中文整段被丢——已修）：
 *   英文/数字：连续字符段一词（script、gpt4）
 *   中文：每个字 unigram + 相邻两字 bigram。"写短剧脚本" →
 *     写/短/剧/脚/本（单字提供召回："剧本"与"脚本"共享"本/剧"）
 *     写短/短剧/剧脚/脚本（双字提供精度：词级重合权重更高）
 *   这是搜索引擎对 CJK 短文本的标准做法（jieba 词表太重，教学版手写够用）。
 *   语义级匹配（"短剧脚本"≈"剧本创作"跨表述）由远程 embedding 引擎负责（embed.js）。
 */
function tokenize(text) {
  const s = String(text || "").toLowerCase();
  const out = (s.match(/[a-z0-9]+/g) || []).slice();
  for (const seg of s.match(/[一-鿿]+/g) || []) {
    for (let i = 0; i < seg.length; i++) {
      out.push(seg[i]);
      if (i + 1 < seg.length) out.push(seg[i] + seg[i + 1]);
    }
  }
  return out;
}

/** Agent 的"文档"原文 = 名字 + 分类 + tags + 简介（embedding 与 TF-IDF 共用同一份语料） */
function agentText(a) {
  return [a.name, a.category, (a.tags || []).join(" "), a.description].join(" ");
}

/** 任务侧"查询"原文 = 标题 + 分类 + tags + 描述 */
function taskText(task) {
  return [task.title, task.category, (task.tags || []).join(" "), task.description].join(" ");
}

const agentDoc = (a) => tokenize(agentText(a));
const taskDoc = (task) => tokenize(taskText(task));

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

module.exports = { tokenize, agentText, taskText, buildIdf, vectorize, cosine, rank };
