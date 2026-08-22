// ═══════════════════════════════════════════════════════════════════
//  novelist-agent.js —— 网文小说家（对应链上"网文小说家"，Writing 类）
//  端口 9010。与 xhs-agent 相反，这是标准 L1/L2 执行体：owner 是部署钱包
//  时平台可代签 accept/submit（auto-dispatch 全自动派遣就靠这条路）。
//
//  交付物结构（约稿的真实形态，不是一坨文字）：
//    一句话梗概 → 人物小传（主角/对手/导师）→ 第一章正文（600~900 字，
//    有场景有对话有结尾钩子）→ 第二章预告。DeepSeek 写，本地模板降级。
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("./lib");

const PORT = 9010;

/** 二字滑窗关键词（与兄弟执行体同思路：本地引擎的"题材提取器"） */
const STOP = new Set(["的", "了", "和", "是", "在", "我", "你", "就", "不", "都", "一个", "这个", "什么", "可以", "我们", "需要", "写一篇", "小说"]);

function keywords(text, topN = 4) {
  const freq = new Map();
  for (const tk of String(text || "").split(/[^\p{L}\p{N}]+/u)) {
    if (!tk) continue;
    if (/^[一-鿿]{2,}$/.test(tk)) {
      for (let i = 0; i + 2 <= tk.length; i++) {
        const g = tk.slice(i, i + 2);
        if (STOP.has(g) || [...g].some((c) => STOP.has(c))) continue;
        freq.set(g, (freq.get(g) || 0) + 1);
      }
    } else if (tk.length > 1) freq.set(tk, (freq.get(tk) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topN).map(([w]) => w);
}

/** 本地引擎（降级路径）：三幕结构 + 人物卡 + 开篇模板——骨架保真，文笔让位 */
function localBrain({ title, description, tags }) {
  const kws = keywords(`${title || ""} ${description} ${tags || ""}`);
  const [k1 = "故事", k2 = k1, k3 = k2] = kws;
  const premise = (String(description).match(/[^。！？\n]+/) || [`${k1}与${k2}的相遇改变了一切`])[0].slice(0, 60);
  const output = [
    `# 《${(title || `${k1}之章`).slice(0, 24)}》创作案`,
    ``,
    `## 一句话梗概`,
    `${premise}——由此卷入 ${k2} 的漩涡，退路在第一幕结尾就被烧掉。`,
    ``,
    `## 人物卡`,
    `- 主角：背着 ${k1} 旧债的普通人（有具体短板，成长空间从第一页就成立）`,
    `- 对手：把 ${k2} 玩成规则的人（赢在信息差，不赢在蛮力）`,
    `- 导师：只给半张地图（剩下半张是第二幕的雷）`,
    ``,
    `## 第一章 ${k1}的裂口`,
    `雨下到第三天，${k3} 的传闻也开始发潮。他数着窗外的水痕，把那个决定又推了一次——推不动了。`,
    `"你知道代价。"对面的人只说了这一句。`,
    `他点头。签字，起身，走进雨里。裂口就此撕开。`,
    ``,
    `## 第二章预告`,
    `${k2}的第一条规则，将在他最自信的时刻反过来咬他。`,
    ``,
    `---`,
    `*本地模板引擎降级产出（DeepSeek 不可用时的保底骨架，meta.engine 可观测）*`,
  ].join("\n");
  return { output, meta: { engine: "local-template", keywords: kws } };
}

/** 大脑：DeepSeek 按约稿结构写小说开篇；失败降级本地三幕模板 */
async function brain({ title, description, tags }) {
  if (!description || String(description).trim().length < 10) {
    throw new Error("description 太短（≥10 字才有素材写小说）——上游要校验好再派单");
  }
  try {
    const { output, usage } = await llm({
      maxTokens: 2200, // 第一章正文 600~900 字 + 结构块，比文案类多给
      system:
        "你是连载多年的网文作者，擅长把一个点子落成能让人追更的开篇。" +
        "按约稿结构输出 markdown：## 一句话梗概（一句话）；## 人物卡（主角/对手/导师各一行，" +
        "写出欲望与短板）；## 第一章 标题（600~900 字正文：具体场景开场、至少三轮对话、" +
        "结尾留钩子不解释）；## 第二章预告（一两行）。语言现代、克制、有画面感，" +
        "不堆形容词，不写'且听下回分解'。只输出正文，不要任何解释。",
      user: `约稿标题：${title || "（未定，你来起）"}\n题材/标签：${tags || "（无）"}\n约稿要求：\n${description}`,
    });
    return { output: `${output}\n\n---\n*网文小说家 · 引擎 DeepSeek（${usage?.completion_tokens ?? "?"} tokens）*`, meta: { engine: "deepseek-chat", usage } };
  } catch (e) {
    console.error(`⚠️ [novelist-agent] LLM 失败，降级本地三幕模板：${e.message}`); // 坑#6：不静默吞
    const r = localBrain({ title, description, tags });
    return { ...r, meta: { ...r.meta, fallback: e.message } };
  }
}

listen(PORT, "novelist-agent", brain);
