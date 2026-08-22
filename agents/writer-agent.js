// ═══════════════════════════════════════════════════════════════════
//  writer-agent.js —— 媒体文章写手（对应链上 Agent#1 ScriptWriter Pro）
//  端口 9001。它干的活是真的：从任务描述里【实际计算】出关键词频、
//  切句、按关键词组织成小节——不是随机拼字，同输入永远同输出（可复现）。
//
//  诚实声明（也是面试话术）：这是"模板辅助写作"，不是 LLM。
//  0 成本、0 依赖、离线可跑；生产替换点 = brain 里换成一次 LLM API 调用，
//  HTTP 壳/契约/结算链路一行不用改——这正是"执行体"和"登记记录"分离的意义。
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("./lib");

const PORT = 9001;

/** 虚词表：出现在关键词里只会稀释主题，直接过滤 */
const STOP = new Set([
  "的", "了", "和", "是", "在", "我", "你", "他", "它", "就", "不", "都",
  "一个", "我们", "你们", "他们", "这", "那", "也", "很", "到", "说", "要",
  "会", "着", "看", "好", "以及", "因为", "所以", "但是", "而且", "对于",
  "可以", "进行", "通过", "使用", "需要", "如果", "虽然", "然后", "或者",
  "还有", "已经", "可能", "比如", "等等", "一下", "这个", "那个", "什么",
]);

/**
 * 关键词提取（真实计算，两套策略）：
 *  - 英文/数字：按非字母数字切开，整词计数
 *  - 中文：没有分词器，用"二字滑窗"（bigram）计数——
 *    高频二字组合 ≈ 主题词，纯统计学，不需要词典
 */
function extractKeywords(text, topN = 6) {
  const freq = new Map();
  const tokens = String(text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const tk of tokens) {
    if (!tk) continue;
    if (/^[一-鿿]+$/.test(tk)) {
      // 中文 run：滑 2 字窗；含虚词的窗丢弃
      for (let i = 0; i + 2 <= tk.length; i++) {
        const g = tk.slice(i, i + 2);
        if (STOP.has(g) || [...g].some((ch) => STOP.has(ch))) continue;
        freq.set(g, (freq.get(g) || 0) + 1);
      }
    } else if (tk.length > 1 && !STOP.has(tk)) {
      freq.set(tk, (freq.get(tk) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) // 频次降序，同频按字典序（可复现）
    .slice(0, topN)
    .map(([w, c]) => ({ word: w, count: c }));
}

/** 切句：中英标点都认。返回去掉空白的非空句列表 */
function splitSentences(text) {
  return String(text || "")
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 本地引擎（降级路径）：bigram 关键词 → 模板组装。可复现、0 成本、离线可跑 */
function localBrain({ taskId, title, description, tags }) {
  if (!description || String(description).trim().length < 10) {
    throw new Error("description 太短（≥10 字才能写稿）——上游要校验好再派单");
  }
  const kws = extractKeywords(`${title || ""} ${description} ${tags || ""}`);
  const k1 = kws[0]?.word || "主题";
  const k2 = kws[1]?.word || k1;
  const k3 = kws[2]?.word || k2;
  const sentences = splitSentences(description);
  const lede = sentences[0] || title || "";

  // 三个小节各认领一个关键词：从原文里捞出含它的句子（有就引原文，没有就展开）
  const sections = [k1, k2, k3].map((kw, i) => {
    const hits = sentences.filter((s) => s.toLowerCase().includes(kw)).slice(0, 3);
    const bullets = hits.length
      ? hits.map((s) => `- ${s}。`)
      : [`- 围绕「${kw}」展开：现状是什么、为什么重要、读者能带走什么。`];
    return `## ${i + 1}. ${kw}：${i === 0 ? "为什么是现在" : i === 1 ? "它改变了什么" : "普通人怎么抓住它"}\n\n${bullets.join("\n")}`;
  });

  const wordCount = String(description).length + String(title || "").length;
  const output = [
    `# ${title || `关于${k1}的深度稿`}`,
    ``,
    `> 备选标题：`,
    `> 1. ${title || `关于${k1}的深度稿`}`,
    `> 2. 「${k1}」正当时：${k2} 的下一站`,
    `> 3. 从 ${k1} 到 ${k3}，这条线你看懂了吗`,
    ``,
    `## 导语`,
    ``,
    `${lede}。本文围绕 **${k1}**、**${k2}**、**${k3}** 三个关键词展开，${sentences.length} 段原文素材浓缩为一篇可发布的媒体稿。`,
    ``,
    ...sections.flatMap((s) => [s, ``]),
    `## 结语`,
    ``,
    `${k1} 不是孤立的现象，它与 ${k2}、${k3} 共同构成当下值得持续关注的叙事。订阅本栏目，下一篇拆解 ${k3} 的产业链。`,
    ``,
    `---`,
    `*写手：ScriptWriter Pro（执行体 writer-agent :${PORT}）· 素材 ${wordCount} 字 · 主题词 ${kws.map((k) => k.word).join(" / ")}*`,
  ].join("\n");

  return {
    output,
    meta: { keywords: kws, sentenceCount: sentences.length, wordCount },
  };
}

/**
 * 大脑（V2 真 LLM）：DeepSeek 写稿；key 未配/调用失败/超时 → 自动降级 localBrain。
 * 降级不静默：console.error 留痕 + meta.engine 可观测（前端/库里能看到这单是谁写的）。
 */
async function brain(payload) {
  const { taskId, title, description, tags } = payload;
  if (!description || String(description).trim().length < 10) {
    throw new Error("description 太短（≥10 字才能写稿）——上游要校验好再派单");
  }
  try {
    const { output, usage } = await llm({
      system:
        "你是 ScriptWriter Pro，资深中文新媒体写手。根据任务写一篇可直接发布的 markdown 媒体稿：" +
        "一个主标题、一段抓人的导语、3 个各有小标题的小节、一段结语。语气专业但不端着。" +
        "只输出稿件正文，不要任何解释或客套。",
      user: `任务标题：${title || "（无）"}\n标签：${tags || "（无）"}\n任务描述：\n${description}`,
    });
    return {
      output: `${output}\n\n---\n*写手：ScriptWriter Pro · 引擎 DeepSeek（${usage?.completion_tokens ?? "?"} completion tokens）*`,
      meta: { engine: "deepseek-chat", usage, taskId },
    };
  } catch (e) {
    console.error(`⚠️ [writer-agent] LLM 失败，降级本地引擎：${e.message}`); // 坑#6：不静默吞
    const r = localBrain(payload);
    return { ...r, meta: { ...r.meta, engine: "local-bigram", fallback: e.message, taskId } };
  }
}

listen(PORT, "writer-agent", brain);
