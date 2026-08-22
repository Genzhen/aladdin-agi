// ═══════════════════════════════════════════════════════════════════
//  agent.mjs —— Pixel Alchemist（像素炼金师）的 Mastra 实现 · 端口 9008
//
//  引擎口径：DeepSeek 没有生图端点（同 embeddings 404 的教训）——
//  但 SVG 是文本，LLM 直接"写图"。图即文本，这条路线零额外依赖、
//  交付物可进 task_results 文本管道、前端 dataURI 一行渲染。
//  生产替换点：配 IMAGE_API_*（OpenAI 兼容 /images/generations）
//  换真生图模型，本文件的 Agent 降级为"出构图方案+校验"角色。
//
//  Mastra 在这里露的看家本领是【多工具 harness 循环】：
//    LLM 定调色板 → checkPalette（WCAG 对比度，代码算）
//    LLM 写 SVG   → validateSvg（结构/安全/配平，代码查）
//    不合格？工具把问题清单打回去，LLM 修到过关为止。
//  分数和判定全是代码算的——事实层隔离在框架版里的等价物。
// ═══════════════════════════════════════════════════════════════════
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const deepseek = createOpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

// ── 工具 1：checkPalette —— WCAG 对比度（确定性，代码算）──────────
function hexToRgb(hex) {
  const h = String(hex).replace("#", "").trim();
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function luminance(rgb) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}
const toHex = (rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

// 修复建议：fg 逐步向黑/白推，直到达标（代码给方案，LLM 执行）
function suggestFix(fg, bg, min) {
  for (const target of [[0, 0, 0], [255, 255, 255]]) {
    for (let i = 1; i <= 8; i++) {
      const mixed = fg.map((c, j) => Math.round(c + ((target[j] - c) * i) / 8));
      if (contrast(mixed, bg) >= min) return toHex(mixed);
    }
  }
  return null;
}

const checkPalette = createTool({
  id: "check-palette",
  description: "对设计的调色板做 WCAG 对比度检查。正文文字要求 ≥4.5:1，大标题/图形 ≥3:1。返回每对颜色的比值、是否达标和达标建议色。",
  inputSchema: z.object({
    pairs: z.array(z.object({
      fg: z.string().describe("前景色 hex，如 #1a1a2e"),
      bg: z.string().describe("背景色 hex"),
      usage: z.enum(["text", "large", "graphic"]).describe("text=正文/large=大标题/graphic=图形装饰"),
      label: z.string().describe("这对颜色用在哪，如 主标题/正文/按钮"),
    })).min(1).max(8),
  }),
  outputSchema: z.object({
    checked: z.array(z.object({
      label: z.string(), fg: z.string(), bg: z.string(),
      ratio: z.number(), minRequired: z.number(), pass: z.boolean(),
      suggest: z.string().nullable(),
    })),
    allPass: z.boolean(),
  }),
  execute: async ({ context }) => {
    const checked = context.pairs.map((p) => {
      const min = p.usage === "text" ? 4.5 : 3;
      const ratio = contrast(hexToRgb(p.fg), hexToRgb(p.bg));
      const pass = ratio >= min;
      return { label: p.label, fg: p.fg, bg: p.bg, ratio, minRequired: min, pass,
        suggest: pass ? null : suggestFix(hexToRgb(p.fg), hexToRgb(p.bg), min) };
    });
    return { checked, allPass: checked.every((c) => c.pass) };
  },
});

// ── 工具 2：validateSvg —— 结构/安全/配平（确定性，代码查）─────────
function validateSvgSource(svg) {
  const issues = [];
  const s = String(svg).trim();
  const bytes = Buffer.byteLength(s, "utf8");
  if (!s.startsWith("<svg")) issues.push("必须以 <svg 开头（不要 <?xml/DOCTYPE/解释性文字）");
  if (!s.endsWith("</svg>")) issues.push("必须以 </svg> 结尾");
  if (!/viewBox\s*=\s*["'][^"']+["']/.test(s)) issues.push("缺 viewBox（前端渲染会失去比例）");
  for (const bad of ["<script", "foreignobject", "javascript:", "onerror", "onclick", "onload"]) {
    if (s.toLowerCase().includes(bad)) issues.push(`含禁止元素/属性：${bad}（安全红线）`);
  }
  if (/(href|xlink:href)\s*=\s*["']https?:/.test(s)) issues.push("引用了外部资源（交付物必须零外部依赖）");
  if (bytes < 400) issues.push(`只有 ${bytes} 字节，内容太单薄（海报要有层次）`);
  if (bytes > 24 * 1024) issues.push(`${bytes} 字节超 24KB 上限`);
  // 标签配平：剥注释后出入栈（自闭合不入栈）
  const noComments = s.replace(/<!--[\s\S]*?-->/g, "");
  const tags = noComments.match(/<\/?[a-zA-Z][-a-zA-Z0-9]*[^>]*>/g) || [];
  const stack = [];
  for (const raw of tags) {
    const name = raw.match(/^<\/?([a-zA-Z][-a-zA-Z0-9]*)/)[1];
    if (raw.startsWith("</")) {
      const top = stack.pop();
      if (top !== name) { issues.push(`标签不配平：</${name}> 的开标签是 ${top ? `<${top}>` : "没有"}`); break; }
    } else if (!raw.endsWith("/>")) stack.push(name);
  }
  if (stack.length) issues.push(`标签不配平：${stack.map((t) => `<${t}>`).join("")} 没闭合`);
  const elements = (s.match(/<[a-zA-Z]/g) || []).length - 1;
  if (elements < 3) issues.push(`只有 ${elements} 个图元，至少 3 个（背景/主体/文字分层）`);
  return { valid: issues.length === 0, issues, stats: { bytes, elements } };
}

const validateSvg = createTool({
  id: "validate-svg",
  description: "校验 SVG 源码：结构（<svg>包住/viewBox）、安全（禁 script/事件属性/外链）、标签配平、尺寸窗 400B~24KB、图元数。返回问题清单和统计——必须修到 valid 才算交付。",
  inputSchema: z.object({ svg: z.string().min(10).describe("完整 SVG 源码") }),
  outputSchema: z.object({
    valid: z.boolean(), issues: z.array(z.string()),
    stats: z.object({ bytes: z.number(), elements: z.number() }),
  }),
  execute: async ({ context }) => validateSvgSource(context.svg),
});

// ── Agent 本体：人设 + 模型 + 双工具 ────────────────────────────────
export const imageAgent = new Agent({
  id: "pixel-alchemist",
  name: "Pixel Alchemist",
  instructions:
    "你是「Pixel Alchemist」像素炼金师——扁平几何风格的 SVG 视觉设计师。工作流程（必须严格遵守）：" +
    "1) 从简报提炼设计意图（主题/情绪/受众），先定 3~5 色调色板（背景/主色/强调色/文字色）；" +
    "2) 调用 checkPalette 验证每对颜色的对比度（正文 ≥4.5:1、大标题/图形 ≥3:1），不达标按建议色改；" +
    "3) 写完整 SVG：viewBox=\"0 0 900 1200\"（3:4 海报）或按简报明显更适合 1200x630 横幅时用它；" +
    "   必须有：渐变或分层的背景、3 个以上几何图元、<text> 文字层级（大标题/副标题/小字），中文文案直接写；" +
    "   禁止：script、事件属性、外部链接、位图引用（这是教学平台的安全红线）；" +
    "4) 调用 validateSvg 校验，issues 非空必须修到 valid（可多轮）；" +
    "5) 最终输出格式：第一行就是 <svg，完整源码，然后空一行 --- 空一行，再写 3~5 行设计说明（配色理由/构图/字体层级）。" +
    "判定和比值必须原样引用工具结果，禁止编改。",
  model: deepseek("deepseek-chat"),
  tools: { checkPalette, validateSvg },
});

export { validateSvgSource }; // server.mjs 出口前再终审一次（不信 LLM 的自觉）
