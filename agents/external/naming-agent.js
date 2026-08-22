// ═══════════════════════════════════════════════════════════════════
//  naming-agent.js —— 起名大师（开放市场演示体 5/5，端口 9015）
//  产品/品牌描述 → 8 个候选名 + 释义 + Top3 推荐 + 风险提示。
//  不在 manifest，上架时填：http://127.0.0.1:9015
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("../lib");

const PORT = 9015;

/** 词根池（本地降级用）：从描述里抠高频二字词做组合原料 */
function roots(text, topN = 3) {
  const freq = new Map();
  for (const tk of String(text || "").match(/[一-鿿]{2,4}/g) || []) {
    for (let i = 0; i + 2 <= tk.length; i++) {
      const g = tk.slice(i, i + 2);
      freq.set(g, (freq.get(g) || 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([w]) => w);
}

/** 本地引擎（降级）：词根拼接 + 通用后缀——骨架保真，创意让位 */
function localBrain({ title, description }) {
  const [r1 = "星", r2 = "语", r3 = "光"] = roots(`${title || ""} ${description || ""}`);
  const cands = [`${r1}${r2}`, `${r2}${r1}`, `${r1}刻`, `${r2}间`, `${r3}${r1}`, `${r1}${r3}`];
  const output = [
    `# 命名方案（${title || "你的产品"}）`,
    "",
    "## 候选名（本地降级：词根组合）",
    ...cands.map((n, i) => `${i + 1}. **${n}** —— 词根 ${r1}/${r2}/${r3} 组合（释义需 LLM，恢复后重跑）`),
    "",
    "> DeepSeek 恢复后将输出 8 个中英文候选 + 释义 + Top3 推荐 + 商标风险提示。",
  ].join("\n");
  return { output, meta: { engine: "local-template", roots: [r1, r2, r3] } };
}

async function brain({ title, description, tags }) {
  if (!description || String(description).trim().length < 10) {
    throw new Error("description 太短（产品是干什么的、给谁用，至少两句话）");
  }
  try {
    const { output, usage } = await llm({
      system:
        "你是品牌命名顾问。根据产品描述产出命名方案。输出 markdown 三段：" +
        "## 候选名（8 个，表格：中文名 | 英文名 | 释义一句——中文要好念好记有画面，英文要像真产品名）；" +
        "## Top3 推荐（每个 2~3 行：为什么配这个产品、调性差异）；" +
        "## 风险提示（≤3 条：可能与知名品牌撞名/多音字/负面谐音——注明这是初步筛查，正式使用前请做商标检索）。" +
        "只输出这三段。",
      user: `产品：${title || "（未定名产品）"}\n调性/偏好：${tags || "（无）"}\n产品描述：\n${description}`,
    });
    return { output: `${output}\n\n---\n*起名大师 · 引擎 DeepSeek（${usage?.completion_tokens ?? "?"} tokens）*`, meta: { engine: "deepseek-chat", usage } };
  } catch (e) {
    console.error(`⚠️ [naming-agent] LLM 失败，降级词根组合：${e.message}`);
    const r = localBrain({ title, description });
    return { ...r, meta: { ...r.meta, fallback: e.message } };
  }
}

listen(PORT, "naming-agent", brain);
