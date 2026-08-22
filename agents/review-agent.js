// ═══════════════════════════════════════════════════════════════════
//  review-agent.js —— 代码审查员（对应链上 Agent#2 CodeWeaver）
//  端口 9003。它干的活是真的：逐行跑静态检查规则（空 catch、== 、
//  var、eval、innerHTML、超长行、TODO…），按严重度算审查分。
//  有意思的是：规则集就是本项目 CLAUDE.md 里自己踩过的坑——
//  空 catch（坑#6）、静默吞错…用自己交的学费训练审查员。
//
//  输入约定：代码贴在任务 description 里（或 code 字段）。
//  生产替换点：换成 ESLint/semgrep 规则引擎或 LLM review，契约不变。
// ═══════════════════════════════════════════════════════════════════
const { listen } = require("./lib");

const PORT = 9003;

/** 规则集：正则 + 严重度 + 一句人话建议。sev 权重：high 15 / med 8 / low 3 / info 1 */
const RULES = [
  { re: /catch\s*(\([^)]*\))?\s*{\s*}/, sev: "high", name: "空 catch 静默吞错", advice: "至少 console.error(e)——本项目曾因此藏了半小时 bug（坑#6）" },
  { re: /\beval\s*\(/, sev: "high", name: "使用 eval", advice: "任意代码执行风险，改 JSON.parse / new Function 前先三思" },
  { re: /\.innerHTML\s*=/, sev: "high", name: "直接赋值 innerHTML", advice: "XSS 风险，改 textContent 或做转义" },
  { re: /[^=!<>]==[^=]/, sev: "medium", name: "宽松相等 ==", advice: "隐式类型转换是 JS 经典坑，改 ===" },
  { re: /\bvar\s+[A-Za-z_$]/, sev: "medium", name: "var 声明", advice: "函数级作用域 + 变量提升，改 const/let" },
  { re: /catch\s*\([^)]*\)\s*{\s*\/\*\s*[^*]*\*\/\s*}/, sev: "medium", name: "catch 里只有注释", advice: "注释不算错误处理，log 一下或往上抛" },
  { re: /\bdebugger\b/, sev: "medium", name: "残留 debugger", advice: "上线必炸断点，删掉" },
  { re: /\/\/\s*(TODO|FIXME)/i, sev: "info", name: "TODO/FIXME 未清", advice: "建 issue 跟踪，别留在代码里过年" },
  { re: /console\.log\(/, sev: "low", name: "console.log 残留", advice: "换结构化日志或删掉（error/warn 可留）" },
];

const SEV_WEIGHT = { high: 15, medium: 8, low: 3, info: 1 };
const SEV_ICON = { high: "🔴", medium: "🟠", low: "🟡", info: "🔵" };

/** 逐行扫规则。返回 findings：[{line, sev, name, advice, excerpt}] */
function scan(code) {
  const findings = [];
  const lines = code.split("\n");
  lines.forEach((line, idx) => {
    for (const r of RULES) {
      if (r.re.test(line)) {
        findings.push({
          line: idx + 1,
          sev: r.sev,
          name: r.name,
          advice: r.advice,
          excerpt: line.trim().slice(0, 60) || "(空行匹配)",
        });
      }
    }
  });
  // 超长行单独算（不是正则逐行的事）
  lines.forEach((line, idx) => {
    if (line.length > 120) {
      findings.push({ line: idx + 1, sev: "low", name: `超长行（${line.length} 字符）`, advice: "拆行，可读性优先", excerpt: line.trim().slice(0, 60) + "…" });
    }
  });
  return findings;
}

/** 大脑：代码 → 审查报告（markdown）。审查分 = 100 - Σ权重，下限 0 */
function brain({ taskId, title, description, code }) {
  const src = String(code || description || "");
  if (src.trim().length < 5) {
    throw new Error("没收到代码：请把代码贴进任务描述（或 code 字段）");
  }
  const findings = scan(src);
  const bySev = (sev) => findings.filter((f) => f.sev === sev).length;
  const score = Math.max(0, 100 - findings.reduce((a, f) => a + SEV_WEIGHT[f.sev], 0));
  const lineCount = src.split("\n").length;

  const verdict = score >= 90 ? "整体健康，小毛病见明细" : score >= 70 ? "有几处真问题，修完再合" : "高危：先处理 🔴 再谈别的";

  const out = [
    `# 代码审查报告：${title || "（未命名）"}`,
    ``,
    `**审查分 ${score}/100 —— ${verdict}**`,
    ``,
    `共 ${lineCount} 行 · ${findings.length} 处发现（🔴 ${bySev("high")} · 🟠 ${bySev("medium")} · 🟡 ${bySev("low")} · 🔵 ${bySev("info")}）`,
    ``,
    findings.length ? `| 行 | 级别 | 问题 | 片段 | 建议 |` : `**未命中任何规则——但这只说明没踩已知的坑，不等于逻辑正确。**`,
    ...(findings.length ? [`|---:|---|---|---|---|`] : []),
    ...findings.map((f) => `| ${f.line} | ${SEV_ICON[f.sev]} ${f.sev} | ${f.name} | \`${f.excerpt}\` | ${f.advice} |`),
    ``,
    `---`,
    `*审查：CodeWeaver（执行体 review-agent :${PORT}）· 规则 ${RULES.length + 1} 条（含超长行）· 静态扫描，不执行代码*`,
  ].join("\n");

  return { output: out, meta: { score, lineCount, findings: findings.length, bySev: { high: bySev("high"), medium: bySev("medium"), low: bySev("low"), info: bySev("info") } } };
}

listen(PORT, "review-agent", brain);
