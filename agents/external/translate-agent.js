// ═══════════════════════════════════════════════════════════════════
//  translate-agent.js —— 双语商务译师（开放市场演示体 3/5，端口 9013）
//  中英互译 + 术语表 + 语气说明。不在 manifest，上架时填 URL：
//  http://127.0.0.1:9013
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("../lib");

const PORT = 9013;

/** 方向判定：CJK 字符占比高 → 中译英，否则英译中 */
function direction(text) {
  const cjk = (String(text).match(/[一-鿿]/g) || []).length;
  return cjk > String(text).replace(/\s/g, "").length * 0.3 ? "中→英" : "英→中";
}

/** 本地引擎（降级）：离线不做低质量直译（诚实原则），做断句预处理 + 方向/术语提示 */
function localBrain({ description }) {
  const dir = direction(description);
  const sents = String(description).split(/(?<=[。！？.!?])\s*/).filter((s) => s.trim().length > 1);
  const output = [
    `# 译文（离线降级模式）`,
    "",
    `方向：${dir} · 共 ${sents.length} 句`,
    "",
    "DeepSeek 不可用，离线模式不做低质量直译（诚实原则）。已完成的预处理：",
    ...(sents.slice(0, 10).map((s, i) => `${i + 1}. ${s.trim().slice(0, 50)}`)),
    "",
    "> LLM 恢复后重新派单即可获得完整译文。",
  ].join("\n");
  return { output, meta: { engine: "local-preprocess", direction: dir, sentences: sents.length } };
}

async function brain({ title, description, tags }) {
  if (!description || String(description).trim().length < 10) {
    throw new Error("description 太短（≥10 字才有可译内容）");
  }
  try {
    const dir = direction(description);
    const { output, usage } = await llm({
      system:
        `你是商务翻译（${dir === "中→英" ? "中译英" : "英译中"}），语气商务专业、不生硬。输出 markdown 三段：` +
        "## 译文（完整翻译，保留 markdown 结构与数字）；" +
        "## 术语表（表格：原文 | 译文，只列关键术语 3~8 个，没有就写'无关键术语'）；" +
        "## 译注（≤3 条：语气选择、文化处理或歧义说明，没有写'无'）。只输出这三段。",
      user: `任务背景：${title || ""} ${tags || ""}\n待译原文：\n${description}`,
    });
    return { output: `${output}\n\n---\n*双语商务译师 · 引擎 DeepSeek（${usage?.completion_tokens ?? "?"} tokens）*`, meta: { engine: "deepseek-chat", direction: dir, usage } };
  } catch (e) {
    console.error(`⚠️ [translate-agent] LLM 失败，降级预处理模式：${e.message}`);
    const r = localBrain({ description });
    return { ...r, meta: { ...r.meta, fallback: e.message } };
  }
}

listen(PORT, "translate-agent", brain);
