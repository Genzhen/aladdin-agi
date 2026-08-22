// ═══════════════════════════════════════════════════════════════════
//  agent.mjs —— Title Forge（标题工厂）的 Mastra 实现 · 链上 id 预计 #17
//
//  这是全项目第一个【框架版】执行体，和兄弟目录的手写版做 A/B：
//    手写版（agents/*.js）  = 零依赖 node:http + 自写 llm() 通道
//    框架版（本目录）       = Mastra Agent + Tool + AI SDK 模型路由
//  两者对外契约完全一致（POST /run → {ok, output, meta}）——
//  平台（agent-runner/结算链路）一行不用改，这就是"执行体与框架无关"。
//
//  Mastra 在这里露的看家本领是【工具调用循环】：
//    LLM 生成 6 个候选标题 → 调 seoScore 工具（确定性打分，本地算）
//    → LLM 拿到分数再决策选 top3 → 输出报告
//  分数是代码算的不是模型说的——"事实层隔离"在框架里的等价物。
// ═══════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// mini-dotenv：读 cwd/.env（和手写版 lib.js 同款逻辑，key 不进代码）
try {
  const p = path.join(process.cwd(), ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch (e) {
  console.error("⚠️ [title-agent] .env 读取失败:", e.message); // 坑#6：不静默吞
}

// DeepSeek 走 OpenAI 兼容口（AI SDK 的 provider 抽象）：
// 换供应商只改这两行——这就是框架版"模型路由"的价值
const deepseek = createOpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

// ── seoScore：确定性 SEO 打分工具（LLM 可调用的"函数"）─────────────
// 规则全透明可解释：长度窗 + 数字 + 关键词命中 + 情绪词 + 悬念标点
const POWER_WORDS = ["干货", "秘籍", "秒懂", "避坑", "真相", "居然", "竟然", "免费", "内幕", "涨", "跌", "爆", "拆解", "白送", "别再"];

function scoreOne(title, keywords) {
  const t = String(title).trim();
  const len = [...t].length;
  const reasons = [];
  let score = 0;

  if (len >= 12 && len <= 24) { score += 30; reasons.push(`长度 ${len} 字在黄金区间(12~24)`); }
  else if (len >= 8 && len <= 30) { score += 20; reasons.push(`长度 ${len} 字可接受`); }
  else { score += 8; reasons.push(`长度 ${len} 字${len < 8 ? "太短没信息量" : "太长会被截断"}`); }

  if (/\d/.test(t)) { score += 15; reasons.push("含数字（数字提升点击率）"); }

  const hits = keywords.filter((k) => k && t.toLowerCase().includes(String(k).toLowerCase()));
  if (hits.length) { score += Math.min(25, hits.length * 15); reasons.push(`命中关键词：${hits.join("、")}`); }

  const powers = POWER_WORDS.filter((w) => t.includes(w));
  if (powers.length) { score += Math.min(30, powers.length * 15); reasons.push(`情绪词：${powers.join("、")}`); }

  if (/[？！]/.test(t)) { score += 10; reasons.push("悬念标点（？！）制造好奇缺口"); }

  return { title: t, score: Math.min(100, score), reasons };
}

const seoScore = createTool({
  id: "seo-score",
  description: "给一批候选标题做确定性 SEO 打分（0~100）。规则：长度窗/含数字/关键词命中/情绪词/悬念标点。返回每个标题的分数和理由。",
  inputSchema: z.object({
    titles: z.array(z.string()).min(1).max(10).describe("候选标题列表"),
    keywords: z.array(z.string()).describe("内容的核心关键词（来自任务简报）"),
  }),
  outputSchema: z.object({
    scored: z.array(z.object({
      title: z.string(),
      score: z.number(),
      reasons: z.array(z.string()),
    })),
  }),
  execute: async ({ context }) => ({ scored: context.titles.map((t) => scoreOne(t, context.keywords)) }),
});

// ── Agent 本体：人设 + 模型 + 工具 ──────────────────────────────────
export const titleAgent = new Agent({
  id: "title-forge",
  name: "Title Forge",
  instructions:
    "你是「Title Forge」标题工厂的资深新媒体主编。工作流程（必须遵守）：" +
    "1) 根据用户的内容简报，生成恰好 6 个候选标题，风格覆盖：数字型/悬念型/利益型/反常识型/对比型/直给型；" +
    "2) 调用 seoScore 工具给全部候选打分（工具要 keywords 参数，取简报里的核心词）；" +
    "3) 根据工具返回的分数选出 Top3。" +
    "输出 markdown：① 候选总表（标题/得分/得分理由摘要）② Top3 推荐（标题/为什么它行/适合什么平台）③ 一句话终极推荐。" +
    "分数必须原样引用工具结果，禁止自己编改分数。",
  model: deepseek("deepseek-chat"),
  tools: { seoScore },
});
