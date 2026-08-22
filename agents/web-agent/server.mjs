// ═══════════════════════════════════════════════════════════════════
//  server.mjs —— Site Forger 契约壳（端口 9009），共享 mastra-shell
//  本文件只剩：brief → 上发条（56s 预算）→ 跑 Workflow → 出口终审
//  → 拼「网站 + 构建报告」双段交付物（前端 iframe 预览取 --- 前那段）
// ═══════════════════════════════════════════════════════════════════
import { createExecutorServer, buildBrief } from "../mastra-shell.mjs";
import { siteWorkflow } from "./workflow.mjs";
import { setDeadline, auditSite } from "./agent.mjs";

const PORT = 9009;

createExecutorServer({
  port: PORT,
  name: "web-agent",
  run: async ({ taskId, title, description, category, tags }) => {
    if (!description || String(description).trim().length < 15) {
      throw new Error("description 太短（≥15 字）——写清网站用途、目标访客、页面内容和风格");
    }

    setDeadline(56_000); // agent-runner 60s 硬顶，留 4s 给落库/网络
    const run = siteWorkflow.createRun();
    const res = await run.start({ inputData: { brief: buildBrief({ title, description, category, tags }) } });
    if (res.status !== "success" || !res.result?.html) {
      throw new Error(`Workflow ${res.status}: ${String(res.error?.message || res.error || "无产出").slice(0, 200)}`);
    }
    const { html, blocking, warnings, stats, fixed } = res.result;

    // 出口终审：代码再说一次话（不信 LLM、也不信流程的自觉）
    const verdict = auditSite(html);
    if (verdict.blocking.length) throw new Error(`出口终审未过：${verdict.blocking.join("；").slice(0, 200)}`);

    const report = [
      "**构建报告 · Mastra Workflow 四步**：plan 架构 → build 整站 → audit 代码审计 → fix 条件返工",
      `- 交付：单文件 HTML ${verdict.stats.bytes}B · 零外部依赖 · ${fixed ? "✅ 审计触发过返工并复审通过" : "✅ 一次通过（无阻塞问题）"}`,
      warnings.length ? `- 非阻塞提示：${warnings.join("；")}` : "- 非阻塞提示：无",
      "*网站锻造：Site Forger · Mastra Workflow（plan→build→audit→fix）· 引擎 DeepSeek*",
    ].join("\n");

    return {
      ok: true,
      agent: "web-agent",
      type: "html",
      output: `${html}\n\n---\n${report}`,
      meta: { engine: "deepseek-chat", framework: "mastra-workflow", kind: "html", taskId, stats: verdict.stats, fixed, warnings: warnings.length, blocking: blocking.length },
    };
  },
});
