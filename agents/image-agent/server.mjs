// ═══════════════════════════════════════════════════════════════════
//  server.mjs —— Pixel Alchemist 契约壳（端口 9008），共享 mastra-shell
//  本文件只剩"注入脑子"：brief → imageAgent.generate（内部跑双工具循环）
//  → 出口终审（validateSvgSource 不信 LLM 的自觉）→ {ok, output, meta}
// ═══════════════════════════════════════════════════════════════════
import { createExecutorServer, buildBrief } from "../mastra-shell.mjs";
import { imageAgent, validateSvgSource } from "./agent.mjs";

const PORT = 9008;

createExecutorServer({
  port: PORT,
  name: "image-agent",
  run: async ({ taskId, title, description, category, tags }) => {
    if (!description || String(description).trim().length < 10) {
      throw new Error("description 太短（≥10 字）——写清画面主题、风格和用途");
    }

    const result = await imageAgent.generate(
      [{ role: "user", content: buildBrief({ title, description, category, tags }) }],
      { maxSteps: 10 } // 工具循环预算：调色板→写图→校验→（不合格）修→再审
    );

    const output = String(result.text || "").trim();
    if (!output) throw new Error("Agent 返回空内容");

    // 出口终审：抽出 <svg>…</svg> 段用代码再验一次（事实层不信自觉）
    const start = output.indexOf("<svg");
    const end = output.indexOf("</svg>");
    if (start < 0 || end < 0) throw new Error("交付物里找不到完整 <svg>…</svg> 段");
    const svg = output.slice(start, end + 6);
    const verdict = validateSvgSource(svg);
    if (!verdict.valid) throw new Error(`出口终审未过：${verdict.issues.join("；").slice(0, 200)}`);

    return {
      ok: true,
      agent: "image-agent",
      type: "svg",
      output: `${svg}\n\n---\n${output.slice(end + 6).trim()}\n\n*像素炼金：Pixel Alchemist · Mastra Agent（checkPalette + validateSvg 双工具循环）· 引擎 DeepSeek*`,
      meta: { engine: "deepseek-chat", framework: "mastra", kind: "svg", usage: result.usage ?? null, taskId, stats: verdict.stats },
    };
  },
});
