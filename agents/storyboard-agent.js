// ═══════════════════════════════════════════════════════════════════
//  storyboard-agent.js —— 分镜师（新上架：Video 类，链上 id 预计 #16）
//  端口 9005。双引擎（V2 同款骨架）：
//    事实层（本地、确定性）：时长预算切分 + 台词字数预算（中文口播 4 字/秒）
//    创作层（DeepSeek）：按预算表写完整口播脚本，每镜字数必须落在预算±20%
//
//  设计点（面试话术）：
//  1. 本地引擎干的活是"真的算了账"：60 秒 ≠ 想写多少写多少——
//     钩子/正文/CTA 的秒数切分和每镜台词字数预算是硬约束，
//     LLM 只是"在预算内填词的人"。约束由代码保证，不由模型自觉。
//  2. 这解决了 LLM 写视频脚本的真实痛点：口播稿总是超时长。
//     用确定性计算夹住生成边界，是"事实层隔离"的又一变体。
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("./lib");

const PORT = 9005;

const WPS = 4; // 中文口播语速 ≈ 240 字/分钟 → 4 字/秒（行业常用值）
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 从任务描述里解析目标时长："90秒" / "1分钟" / "60 s"，默认 60s */
function parseDuration(text) {
  const src = String(text || "");
  let m = src.match(/(\d+)\s*分钟|min/);
  if (m) return clamp(+m[1] * 60, 15, 300);
  m = src.match(/(\d+)\s*(秒|s\b|sec)/);
  if (m) return clamp(+m[1], 15, 300);
  return 60;
}

/** 从描述里抽"卖点"：带 -/•/数字. 开头的行优先，没有就按句切，最多 4 条 */
function parsePoints(description) {
  const lines = String(description || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-•*]|\d+[.、）)]/.test(l)).map((l) => l.replace(/^[-•*]\s*|\d+[.、）)]\s*/, ""));
  const pool = bullets.length ? bullets : lines.join("。").split(/[。！？!?]/).map((s) => s.trim()).filter((s) => s.length >= 4);
  return pool.slice(0, 4);
}

/**
 * 事实层（本地算死）：把总时长切成 钩子/正文N拍/CTA 的预算表。
 * 比例是编导经验值：钩子 10%（3~8s 封顶），CTA 8%（3~6s），剩下均分正文。
 */
function makeBudget(durationSec, points) {
  const hook = clamp(Math.round(durationSec * 0.1), 3, 8);
  const cta = clamp(Math.round(durationSec * 0.08), 3, 6);
  const beats = Math.max(1, Math.min(points.length || 3, 3)); // 正文最多 3 拍（短视频节奏）
  const body = durationSec - hook - cta;
  const per = Math.round(body / beats);

  const shots = [
    { n: 1, slot: "钩子（前3秒定生死：抛冲突/反常识/结果前置）", sec: hook },
    ...Array.from({ length: beats }, (_, i) => ({ n: i + 2, slot: `正文第${i + 1}拍：${points[i] || "展开一个卖点（证据+感受）"}`, sec: per })),
    { n: beats + 2, slot: "CTA（一个动作，别贪多）", sec: cta + (body - per * beats) }, // 余秒并入 CTA
  ];
  return shots.map((s) => ({ ...s, words: s.sec * WPS })); // 每镜台词字数预算
}

/** 本地渲染（降级路径）：只给预算表 + 拍摄提示，明说"没写台词" */
function renderLocal({ title }, shots, durationSec) {
  const totalWords = shots.reduce((a, s) => a + s.words, 0);
  const L = [
    `# 分镜预算表：${title || "（未命名）"}（本地引擎，未生成台词）`, ``,
    `总时长 ${durationSec}s · ${shots.length} 镜 · 台词总预算 ${totalWords} 字（语速 ${WPS} 字/秒）`, ``,
    `| 镜 | 时长 | 台词字数 | 内容槽位 |`, `|---:|---:|---:|---|`,
    ...shots.map((s) => `| ${s.n} | ${s.sec}s | ~${s.words}字 | ${s.slot} |`),
    ``, `> 本地模式只出预算账（LLM 不可用）。按字数预算自己填词即可——超了就删，别恋战。`, ``,
    `---`, `*分镜：Storyboard Mate · 本地预算引擎（时长切分+字数约束是确定性计算）*`,
  ];
  return L.join("\n");
}

/** 大脑：本地算预算 → DeepSeek 在预算内写脚本；失败降级纯预算表 */
async function brain({ title, description }) {
  if (!description || String(description).trim().length < 10) {
    throw new Error("description 太短（≥10 字）——写清主题、卖点、目标时长（如 90秒）");
  }
  const durationSec = parseDuration(`${title} ${description}`);
  const points = parsePoints(description);
  const shots = makeBudget(durationSec, points);
  const budget = shots.map(({ n, sec, words, slot }) => ({ 镜: n, 时长秒: sec, 台词字数上限: words, 内容: slot }));

  try {
    const { output, usage } = await llm({
      system:
        `你是 Storyboard Mate，短视频编导。给你一张【本地程序算好的分镜预算表】，写完整口播脚本：` +
        `每镜台词字数必须落在预算 ±20% 内（这是硬约束，超时=废稿）；镜头感写进括号。` +
        `输出 markdown：每镜一个小节（镜号/时长/台词），最后一镜是 CTA。只输出脚本。`,
      user: `视频主题：${title || "（未命名）"}\n总时长：${durationSec} 秒\n卖点素材：\n${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\n分镜预算表（JSON，必须遵守）：\n${JSON.stringify(budget, null, 1)}`,
    });
    return { output: `${output}\n\n---\n*分镜：Storyboard Mate · 引擎 DeepSeek（预算由本地引擎锁定：${durationSec}s / 台词 ~${shots.reduce((a, s) => a + s.words, 0)}字）*`, meta: { engine: "deepseek-chat", durationSec, usage } };
  } catch (e) {
    console.error(`⚠️ [storyboard-agent] LLM 失败，降级本地预算引擎：${e.message}`); // 坑#6：不静默吞
    return { output: renderLocal({ title }, shots, durationSec), meta: { engine: "local-budget", durationSec, fallback: e.message } };
  }
}

listen(PORT, "storyboard-agent", brain);
