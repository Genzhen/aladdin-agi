// ═══════════════════════════════════════════════════════════════════
//  weekly-agent.js —— 周报匠（开放市场演示体 2/5，端口 9012）
//  把流水账要点重组为结构化周报。不在 manifest，上架时填 URL：
//  http://127.0.0.1:9012
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("../lib");

const PORT = 9012;

/** 把 description 切成要点条目（换行/分号/顿号分隔，过滤空行） */
function bullets(text) {
  return String(text || "").split(/[\n；;]+/).map((s) => s.trim().replace(/^[•·\-\d.、]+\s*/, "")).filter((s) => s.length > 3);
}

/** 本地引擎（降级）：忠实保留原文要点，套周报骨架，不编数字 */
function localBrain({ title, description }) {
  const items = bullets(description);
  const half = Math.ceil(items.length / 2) || 1;
  const output = [
    `# 周报${title ? ` · ${title.slice(0, 20)}` : ""}`,
    "",
    "## 本周进展",
    ...(items.slice(0, half).map((s, i) => `${i + 1}. ${s}`)),
    "",
    "## 下周计划",
    ...(items.slice(half).length ? items.slice(half).map((s, i) => `${i + 1}. ${s}`) : ["（原流水账未区分本周/下周，建议补充）"]),
    "",
    "## 风险与求助",
    "- （本地模板引擎降级产出：只做结构化重组，未识别风险项——DeepSeek 恢复后自动补充）",
  ].join("\n");
  return { output, meta: { engine: "local-template", items: items.length } };
}

async function brain({ title, description }) {
  const items = bullets(description);
  if (items.length < 2) {
    throw new Error("流水账要点太少（≥2 条，分号或换行分隔）——没素材组不出周报");
  }
  try {
    const { output, usage } = await llm({
      system:
        "你是资深项目经理，擅长把流水账写成老板一眼看懂的周报。输出 markdown 四段：" +
        "## 本周进展（3~5 条，动词开头，尽量量化，**不得编造数字**，原文没有就不写数）；" +
        "## 数据亮点（1~2 条，原文有数据才写，没有就写'本周无关键数据'）；" +
        "## 风险与求助（识别阻塞项和需要的支持，没有写'无'）；" +
        "## 下周计划（2~4 条，从原文合理延伸）。只输出周报正文。",
      user: `周报标题：${title || "（无）"}\n本周流水账：\n${items.map((s) => `- ${s}`).join("\n")}`,
    });
    return { output: `${output}\n\n---\n*周报匠 · 引擎 DeepSeek（${usage?.completion_tokens ?? "?"} tokens）*`, meta: { engine: "deepseek-chat", usage } };
  } catch (e) {
    console.error(`⚠️ [weekly-agent] LLM 失败，降级本地模板：${e.message}`);
    const r = localBrain({ title, description });
    return { ...r, meta: { ...r.meta, fallback: e.message } };
  }
}

listen(PORT, "weekly-agent", brain);
