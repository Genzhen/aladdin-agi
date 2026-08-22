// ═══════════════════════════════════════════════════════════════════
//  data-agent.js —— 数据报告员（对应链上 Agent#3 DataMiner X）
//  端口 9002。它干的活是真的：用正则从任务描述里【实际抽取】所有数值
//  （带 % / 万 / 亿 / 单位 / 上下文），算 max/min/sum/avg，画 ASCII 柱状图。
//  没数字就如实报告"没检出数据"——宁可空手，不编数字（数据行业的底线）。
//
//  ⚠️ 本报告的数字全是展示层浮点。项目红线"金额一律整数"管的是资金
//  （wei BigInt）；这里是内容生成，不碰钱，允许浮点——但要说明白。
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("./lib");

const PORT = 9002;

/** 抽数值：数字 + 可选单位，同时带走左右各 14 字的上下文（报告里要引用原文） */
function extractNumbers(text) {
  const src = String(text || "");
  const re = /(-?\d[\d,]*(?:\.\d+)?)\s*(%|％|万|亿|美元|元|人|次|台|天|小时|分钟|枚|个)?/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const unit = m[2] || "";
    const from = Math.max(0, m.index - 14);
    found.push({
      value,
      unit,
      isPct: unit === "%" || unit === "％",
      context: src.slice(from, m.index + m[0].length + 14).trim(),
    });
  }
  return found;
}

/** ASCII 柱状图：归一化到最宽 24 格，纯文本里也能看（邮件/终端/链上文本都兼容） */
function barChart(items) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)));
  if (max <= 0) return "（无可绘制的数值）";
  return items
    .map((i) => {
      const w = Math.max(1, Math.round((Math.abs(i.value) / max) * 24));
      return `${String(i.value + i.unit).padStart(10)} │${"█".repeat(w)}${i.value < 0 ? "（负值取绝对长度）" : ""}`;
    })
    .join("\n");
}

const fmt = (n) => Number(n.toFixed(2)).toLocaleString("en-US");

/** 事实层（确定性）：任务描述 → 检出的数值与统计。LLM 只许解读，不许编数 */
function computeStats(description) {
  const nums = extractNumbers(description);
  const pcts = nums.filter((n) => n.isPct);
  const plain = nums.filter((n) => !n.isPct);
  const values = plain.map((n) => n.value);
  const stat = values.length
    ? {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        max: Math.max(...values),
        min: Math.min(...values),
      }
    : null;
  return { nums, pcts, plain, stat };
}

/** 本地渲染（降级路径）：事实层 → ASCII 图表报告，0 成本、离线可跑 */
function renderLocal({ title, description }, facts) {
  const { nums, pcts, plain, stat } = facts;

  const lines = [
    `# 数据速报：${title || "（未命名任务）"}`,
    ``,
    `**结论先行**：${stat
      ? `共检出 ${stat.count} 个数值指标，合计 ${fmt(stat.sum)}，均值 ${fmt(stat.avg)}，最大 ${fmt(stat.max)}，最小 ${fmt(stat.min)}。`
      : `⚠️ 任务描述中未检出任何数值数据——本报告不做推测，建议补充带数字的原始材料后重新派单。`}`,
    ``,
  ];

  if (stat) {
    lines.push(`## 数值分布（Top ${Math.min(8, plain.length)}，按出现顺序）`, ``, "```", barChart(plain.slice(0, 8)), "```", ``);
    lines.push(`## 指标明细（引用原文上下文）`, ``);
    plain.forEach((n, i) => lines.push(`${i + 1}. **${fmt(n.value)}${n.unit}** —— 原文：…${n.context}…`));
    lines.push(``);
  }

  if (pcts.length) {
    lines.push(`## 百分比专项`, ``);
    pcts.forEach((n) => lines.push(`- ${n.value}%（原文：…${n.context}…）`));
    const pAvg = pcts.reduce((a, b) => a + b.value, 0) / pcts.length;
    lines.push(``, `百分比均值 ${fmt(pAvg)}%${pAvg > 50 ? "——普遍高增长口径，注意核对统计分母" : ""}。`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*报告：DataMiner X（执行体 data-agent :${PORT}）· 检出数值 ${nums.length} 个，其中百分比 ${pcts.length} 个· 素材 ${String(description || "").length} 字*`);

  return {
    output: lines.join("\n"),
    meta: { numbersFound: nums.length, percents: pcts.length, stat },
  };
}

/**
 * 大脑（V2 真 LLM）：事实层本地算死（数字不经过 LLM，防幻觉），
 * DeepSeek 只负责把统计结果写成有人味的解读报告；失败降级 renderLocal。
 */
async function brain(payload) {
  const { taskId, title, description } = payload;
  const facts = computeStats(description);
  try {
    const { output, usage } = await llm({
      system:
        "你是 DataMiner X，数据分析师。下面给你一份【本地程序已经算好的事实清单】，" +
        "基于且仅基于这些数字写 markdown 解读报告：结论先行、每处解读注明对应数字、一条风险提示。" +
        "严禁编造清单之外的数字；清单没数字就明说无法分析。",
      user:
        `任务标题：${title || "（未命名任务）"}\n事实清单（JSON）：\n${JSON.stringify(
          { 检出数值: facts.nums.length, 明细: facts.plain.slice(0, 12), 百分比: facts.pcts, 统计: facts.stat },
          null, 1
        )}\n\n原文材料：\n${description}`,
    });
    return {
      output: `${output}\n\n---\n*报告：DataMiner X · 引擎 DeepSeek（本地统计 ${facts.nums.length} 项事实 + LLM 解读）*`,
      meta: { engine: "deepseek-chat", numbersFound: facts.nums.length, usage, taskId },
    };
  } catch (e) {
    console.error(`⚠️ [data-agent] LLM 失败，降级本地引擎：${e.message}`);
    const r = renderLocal(payload, facts);
    return { ...r, meta: { ...r.meta, engine: "local-ascii", fallback: e.message, taskId } };
  }
}

listen(PORT, "data-agent", brain);
