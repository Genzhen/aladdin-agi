// ═══════════════════════════════════════════════════════════════════
//  agent.mjs —— Site Forger（网站锻造师）的角色 Agent 们 · 端口 9009
//
//  与 image-agent 的单 Agent 不同：这里一个"工坊"拆三个角色 Agent
//  （架构师/工程师/返工），由 workflow.mjs 的四步流水线编排——
//  Mastra 的看家本领之二：【Workflow】让"工序"成为一等公民。
//
//  时间预算：平台 agent-runner 硬顶 60s，本文件导出 setDeadline/
//  timeLeft，server.mjs 起跑前上发条，fixStep 凭剩余预算决定返不返工。
// ═══════════════════════════════════════════════════════════════════
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";

const deepseek = createOpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

let deadline = Infinity;
export const setDeadline = (ms) => { deadline = Date.now() + ms; };
export const timeLeft = () => deadline - Date.now();

// ── 角色 1：信息架构师（小输出、快返回，给 build 立图纸）──────────
export const planAgent = new Agent({
  id: "site-planner",
  name: "Site Planner",
  instructions:
    "你是网站信息架构师。读任务简报，输出**一个紧凑 JSON 对象**（不要 markdown 围栏、不要解释文字），字段：" +
    '{"siteTitle":"站名","tagline":"一句话定位","style":"风格关键词 3~5 个","palette":["#hex" ×4~5],' +
    '"sections":[{"heading":"板块标题","purpose":"这个板块干什么","copyHint":"文案要点"}]（4~6 个）,"audience":"目标访客"}' +
    "风格要贴简报的行业与情绪；sections 覆盖 hero/核心服务或内容/信任背书/行动召唤等常规板块。",
  model: deepseek("deepseek-chat"),
});

// ── 角色 2：前端工程师（唯一的大输出步：整站单文件 HTML）──────────
const BUILD_RULES =
  "交付【单文件】HTML5 网站，硬性规则：" +
  "1) 第一行 <!DOCTYPE html>，最后一行 </html>，中间零解释；" +
  "2) 全部 CSS 写进 <style>：系统字体栈（不许 Google Fonts）、CSS 变量放调色板、" +
  "flex/grid 布局、至少一处 @media 响应式、有 :hover 过渡；" +
  "3) 零外部依赖：不引任何 http(s) 资源（CDN/图片/图标一律不要），图标用 emoji 或内联 SVG，" +
  "图片位用 CSS 渐变/几何装饰替代；" +
  "4) 结构：含 <nav> 导航、hero、按计划逐板块、<footer>；中文文案要真实贴合简报，不许 lorem ipsum；" +
  "5) 可加一小段原生 JS 增强（滚动显现/tab 切换/计数动画），但站点不开 JS 也必须完整可读；" +
  "6) 总量 6KB~40KB。";

export const buildAgent = new Agent({
  id: "site-builder",
  name: "Site Builder",
  instructions: `你是资深前端工程师。${BUILD_RULES}按用户消息里的「信息架构计划」执行：板块、配色、文案基调都以计划为准。`,
  model: deepseek("deepseek-chat"),
});

// ── 角色 3：返工工程师（只在审计有阻塞问题时被调用）───────────────
export const fixAgent = new Agent({
  id: "site-fixer",
  name: "Site Fixer",
  instructions: `你是返工工程师。用户消息给「审计问题清单」和「当前网站」，修复全部问题后输出修正版。${BUILD_RULES}`,
  model: deepseek("deepseek-chat"),
});

// ── 审计（确定性，代码查——不是 LLM 自评）─────────────────────────
export function auditSite(html) {
  const s = String(html).trim();
  const lower = s.toLowerCase();
  const blocking = [];
  const warnings = [];
  const bytes = Buffer.byteLength(s, "utf8");

  if (!lower.startsWith("<!doctype html")) blocking.push("第一行不是 <!DOCTYPE html>");
  const title = s.match(/<title>([^<]*)<\/title>/i);
  if (!title || !title[1].trim()) blocking.push("缺 <title> 或标题为空");
  if (!/name\s*=\s*["']viewport["']/.test(lower)) blocking.push("缺 viewport meta（手机上没法看）");
  if (!lower.includes("<style")) blocking.push("缺内联 <style>（样式必须单文件自带）");
  if (!lower.includes("</html>")) blocking.push("没有 </html> 收尾");
  // 零外部依赖：src=/href= 指到 http(s) 的都算（正文文案里的链接除外——只查资源引用）
  if (/(src|href)\s*=\s*["']https?:\/\//i.test(s)) blocking.push("引用了外部资源（必须零外部依赖）");
  if (bytes < 1500) blocking.push(`只有 ${bytes}B，内容太单薄`);
  if (bytes > 48 * 1024) blocking.push(`${bytes}B 超 48KB 上限`);

  if (!lower.includes("<nav")) warnings.push("缺 <nav> 导航（非阻塞）");
  if (!lower.includes("<footer")) warnings.push("缺 <footer>（非阻塞）");
  if (!lower.includes("@media")) warnings.push("没有响应式断点（非阻塞）");
  return { blocking, warnings, stats: { bytes } };
}
