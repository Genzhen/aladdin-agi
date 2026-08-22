// ═══════════════════════════════════════════════════════════════════
//  workflow.mjs —— Site Forger 四步流水线（Mastra Workflow）
//
//    plan（架构师，快）→ build（工程师，大输出）→ audit（代码审计，秒回）
//      → fix（返工：有阻塞问题 且 剩余预算 >18s 才真跑，否则带病交付）
//
//  版本坑：@mastra/core 0.10 的运行入口是
//      const run = wf.createRun(); await run.start({ inputData })
//  （0.10 的 d.ts 里 legacy Workflow 用 triggerData、vNext 用 inputData——
//   两套签名混在同一文件，认准 vNext 这套；同 generate() 位置参数那个坑）
// ═══════════════════════════════════════════════════════════════════
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { planAgent, buildAgent, fixAgent, auditSite, timeLeft } from "./agent.mjs";

// 步间传递类型：brief 全程背着（build/fix 都要原文），每步只加自己的产出
const In = z.object({ brief: z.string() });
const Planned = In.extend({ plan: z.string() });
const Built = In.extend({ html: z.string() });
const Audited = Built.extend({
  blocking: z.array(z.string()),
  warnings: z.array(z.string()),
  stats: z.object({ bytes: z.number() }),
});
const Final = z.object({
  html: z.string(),
  blocking: z.array(z.string()),
  warnings: z.array(z.string()),
  stats: z.object({ bytes: z.number() }),
  fixed: z.boolean(),
});

const planStep = createStep({
  id: "plan", inputSchema: In, outputSchema: Planned,
  execute: async ({ inputData }) => {
    const r = await planAgent.generate([{ role: "user", content: inputData.brief }], { maxSteps: 1 });
    const plan = String(r.text || "").trim();
    if (!plan.includes("siteTitle")) throw new Error(`plan 步没产出 JSON 计划：${plan.slice(0, 120)}`);
    return { brief: inputData.brief, plan };
  },
});

const buildStep = createStep({
  id: "build", inputSchema: Planned, outputSchema: Built,
  execute: async ({ inputData }) => {
    const r = await buildAgent.generate(
      [{ role: "user", content: `${inputData.brief}\n\n=== 信息架构计划（按此执行）===\n${inputData.plan}` }],
      { maxSteps: 1 }
    );
    const html = String(r.text || "").trim();
    if (!html.toLowerCase().includes("<html")) throw new Error("build 步产出里没有 <html>");
    return { brief: inputData.brief, html };
  },
});

// 审计步零 LLM：确定性代码，问题清单就是下游返工的工单
const auditStep = createStep({
  id: "audit", inputSchema: Built, outputSchema: Audited,
  execute: async ({ inputData }) => ({ brief: inputData.brief, html: inputData.html, ...auditSite(inputData.html) }),
});

const fixStep = createStep({
  id: "fix", inputSchema: Audited, outputSchema: Final,
  execute: async ({ inputData }) => {
    const { html, blocking, warnings, stats } = inputData;
    if (!blocking.length) return { html, blocking, warnings, stats, fixed: false };
    if (timeLeft() < 18_000) {
      // 预算不足：带病交付 + 把欠账写进报告（失败被诚实暴露，不硬编"成功"）
      return { html, blocking, warnings: [...warnings, `⏱ 剩余预算 ${Math.round(timeLeft() / 1000)}s 不足返工，${blocking.length} 个阻塞问题未修`], stats, fixed: false };
    }
    const r = await fixAgent.generate(
      [{ role: "user", content: `=== 审计问题（必须全部修复）===\n${blocking.join("\n")}\n\n=== 当前网站 ===\n${html}` }],
      { maxSteps: 1 }
    );
    const fixedHtml = String(r.text || "").trim();
    if (!fixedHtml.toLowerCase().includes("<html")) throw new Error("fix 步产出里没有 <html>");
    const re = auditSite(fixedHtml); // 返工也要复审——fix 不是免检通道
    return { html: fixedHtml, ...re, fixed: true };
  },
});

export const siteWorkflow = createWorkflow({
  id: "site-forger",
  inputSchema: In,
  outputSchema: Final,
  steps: [planStep, buildStep, auditStep, fixStep],
})
  .then(planStep)
  .then(buildStep)
  .then(auditStep)
  .then(fixStep)
  .commit();
