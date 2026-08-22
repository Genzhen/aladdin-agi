// ═══════════════════════════════════════════════════════════════════
//  acrostic-agent.js —— 藏头诗人（开放市场演示体 1/5，端口 9011）
//  刻意不在 manifest：不自动接线、不进心跳表——演示"外部商家填 URL 上架"。
//  上架方式：/list 登记元数据后，服务地址填 http://127.0.0.1:9011
//  （演示口径：商家服务恰好部署在同一台演示机；生产是商家自己的公网 URL）
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("../lib");

const PORT = 9011;

/** 从任务文本里抠藏头词：优先"藏头：xxx"，否则取标题前 2~4 个汉字 */
function headWord(title, description) {
  const m = String(description || "").match(/藏头[词]?[：:]\s*([^\s，。,.\n]{2,8})/) ||
    String(title || "").match(/藏头[词]?[：:]\s*([^\s，。,.\n]{2,8})/);
  if (m) return m[1];
  const cjk = String(title || "").match(/[一-鿿]{2,4}/);
  return cjk ? cjk[0] : "心想事成";
}

/** 本地引擎（降级）：每句首字拼词 + 模板句——骨架保真 */
function localBrain({ title, description }) {
  const word = headWord(title, description);
  const theme = (String(description).match(/[^。！？\n]{6,30}/) || ["把这份心意写进诗里"])[0];
  const lines = [...word].map((ch, i) => `${ch}${["风送此意到君前", "月照心事入诗篇", "花开时节又逢君", "云卷云舒皆自然", "星河万里不孤单"][i % 5]}`);
  const output = [`《${word}》`, "", ...lines, "", `> 藏头词：${word} · 主题：${theme.slice(0, 20)}`, "> （本地模板引擎降级产出——DeepSeek 恢复后为定制诗句）"].join("\n");
  return { output, meta: { engine: "local-template", headWord: word } };
}

async function brain({ title, description, tags }) {
  if (!description || String(description).trim().length < 5) {
    throw new Error("description 太短（至少给个主题或一句话要求）");
  }
  try {
    const word = headWord(title, description);
    const { output, usage } = await llm({
      system:
        "你是格律功底扎实的中文诗人。写一首藏头诗：每句首字按序连起来恰好是给定的藏头词。" +
        "五言或七言自选（全诗统一），句数=藏头词字数（2~8 句），可押韵。输出 markdown：" +
        "《诗题》→ 诗正文（每句一行）→ 一行赏析（≤40 字，讲清双关或意境）。只输出正文。",
      user: `藏头词：${word}\n主题/场合：${tags || ""} ${description}\n标题：${title || "（自拟）"}`,
    });
    return { output: `${output}\n\n---\n*藏头诗人 · 引擎 DeepSeek（${usage?.completion_tokens ?? "?"} tokens）*`, meta: { engine: "deepseek-chat", headWord: word } };
  } catch (e) {
    console.error(`⚠️ [acrostic-agent] LLM 失败，降级本地模板：${e.message}`);
    const r = localBrain({ title, description });
    return { ...r, meta: { ...r.meta, fallback: e.message } };
  }
}

listen(PORT, "acrostic-agent", brain);
