// ═══════════════════════════════════════════════════════════════════
//  contract-agent.js —— 合同哨兵（新上架：Legal 类，链上 id 预计 #15）
//  端口 9004。双引擎（V2 同款骨架）：
//    事实层（本地、确定性）：风险词命中 + 金额/比例/期限抽取 + 缺失条款检测
//    解读层（DeepSeek）：基于且仅基于事实清单写审查意见——防幻觉同 data-agent
//
//  设计点（面试话术）：
//  1. "缺失检测"比"命中检测"更值钱：合同里【没有】违约条款/争议解决条款
//     本身就是风险——负空间也要扫。
//  2. "最终解释权"在消费合同里是违法条款（市监总局明令禁止）——
//     规则不是拍脑袋，是有出处的。
//  3. 本地规则引擎跨领域复用了 review-agent 的模式（正则+严重度+扣分），
//     证明"规则审查"是个可迁移的骨架。
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("./lib");

const PORT = 9004;

/** 风险词表：正则 / 权重(扣分) / 名称 / 为什么危险 */
const RISKS = [
  { re: /自动续约|自动续期|到期自动/, w: 15, name: "自动续约", why: "忘记取消就被扣下一周期，消费端头号坑" },
  { re: /最终解释权/, w: 15, name: "最终解释权归一方", why: "消费合同里属违法条款（市监总局明令禁止）" },
  { re: /无限责任|无限连带|一切损失/, w: 15, name: "无限责任表述", why: "违约赔偿无上限，应改为可预见的封顶金额" },
  { re: /单方(有权)?(解除|变更|终止)/, w: 12, name: "单方解除/变更权", why: "只给对方的刀——你要对等的解除权" },
  { re: /独家|排他/, w: 8, name: "独家/排他条款", why: "锁死你的选择权，注意范围和期限" },
  { re: /不可撤销|不得转让/, w: 6, name: "不可撤销/不得转让", why: "缩小你事后调整的空间" },
  { re: /违约金|滞纳金/, w: 5, name: "违约金条款", why: "看清比例是否对等（见下方数字抽取）" },
  { re: /知识产权|著作权|专利.{0,6}归属/, w: 5, name: "知识产权归属", why: "作品归谁？没写清=默认打官司" },
  { re: /保密/, w: 3, name: "保密条款", why: "注意保密期限是否比合作期长得多" },
];

/** 缺失检测：一份正经合同该有而没有的东西（负空间扫描） */
const MUST_HAVE = [
  { re: /违约|赔偿|责任/, name: "违约/赔偿责任" },
  { re: /管辖|仲裁|诉讼|争议解决/, name: "争议解决方式" },
  { re: /期限|有效期|终止/, name: "合同期限/终止条件" },
  { re: /报酬|价款|费用|付款|工资/, name: "价款与支付方式" },
];

/** 抽数字：金额/比例/期限——合同里的钱和日子永远是最硬的事实 */
function extractFigures(text) {
  const src = String(text || "");
  const out = { percents: [], moneys: [], durations: [] };
  let m;
  const rePct = /(\d+(?:\.\d+)?)\s*%/g;
  while ((m = rePct.exec(src)) !== null) out.percents.push({ v: +m[1], ctx: ctx(src, m.index) });
  const reMoney = /(\d[\d,]*(?:\.\d+)?)\s*(万元?|亿元?|美元|美金|USD|RMB|元)/g;
  while ((m = reMoney.exec(src)) !== null) out.moneys.push({ v: m[1], unit: m[2], ctx: ctx(src, m.index) });
  const reDur = /(\d+)\s*(个?(天|日|月|年|周)|hours?|days?|个月)/g;
  while ((m = reDur.exec(src)) !== null) out.durations.push({ v: m[1], unit: m[2], ctx: ctx(src, m.index) });
  return out;
}
const ctx = (src, i) => src.slice(Math.max(0, i - 12), i + 26).trim();

/** 事实层（本地算死）：风险命中 + 数字 + 缺失 —— LLM 只许解读这份清单 */
function scanContract(text) {
  const src = String(text || "");
  if (src.trim().length < 30) throw new Error("合同文本太短（≥30 字）——把条款原文贴进任务描述");
  const hits = [];
  for (const r of RISKS) {
    const found = src.match(new RegExp(r.re, "g"));
    if (found) hits.push({ name: r.name, count: found.length, w: r.w, why: r.why, first: ctx(src, src.search(r.re)) });
  }
  const missing = MUST_HAVE.filter((x) => !x.re.test(src)).map((x) => `缺少「${x.name}」相关条款`);
  const figures = extractFigures(src);
  const score = Math.max(0, 100 - hits.reduce((a, h) => a + h.w, 0) - missing.length * 6);
  return { hits, missing, figures, score, length: src.length };
}

/** 本地渲染（降级路径）：纯规则报告，0 成本、可复现 */
function renderLocal({ title }, f) {
  const L = [
    `# 合同风险速查：${title || "（未命名）"}`,
    ``, `**风险分 ${f.score}/100**（命中 ${f.hits.length} 类风险词 · 检出缺失 ${f.missing.length} 项 · ${f.length} 字）`, ``,
  ];
  if (f.hits.length) {
    L.push(`## 命中风险词`, ``, `| 风险点 | 次数 | 扣分 | 原文片段 | 为什么危险 |`, `|---|---:|---:|---|---|`);
    f.hits.forEach((h) => L.push(`| ${h.name} | ${h.count} | -${h.w} | …${h.first}… | ${h.why} |`));
    L.push(``);
  }
  if (f.missing.length) { L.push(`## 缺失检测（负空间）`, ``, ...f.missing.map((m) => `- ⚠️ ${m}`), ``); }
  const fig = f.figures;
  if (fig.percents.length || fig.moneys.length || fig.durations.length) {
    L.push(`## 关键数字`, ``);
    fig.percents.forEach((p) => L.push(`- 比例 ${p.v}% —— …${p.ctx}…`));
    fig.moneys.forEach((p) => L.push(`- 金额 ${p.v}${p.unit} —— …${p.ctx}…`));
    fig.durations.forEach((p) => L.push(`- 期限 ${p.v}${p.unit} —— …${p.ctx}…`));
    L.push(``);
  }
  L.push(`---`, `*审查：Contract Guard · 本地规则引擎 ${RISKS.length} 条 + 缺失检测 ${MUST_HAVE.length} 项（LLM 未参与，纯事实）*`);
  return L.join("\n");
}

/** 大脑：事实层本地算死 → DeepSeek 逐条解读；失败降级本地报告 */
async function brain({ title, description }) {
  const f = scanContract(description);
  const facts = { 风险分: f.score, 命中风险: f.hits.map(({ name, count, why }) => ({ name, count, why })), 缺失条款: f.missing, 关键数字: f.figures, 原文长度: f.length };
  try {
    const { output, usage } = await llm({
      system:
        "你是 Contract Guard，合同审查员。给你一份【本地程序已扫描出的事实清单】，基于且仅基于它写 markdown 审查意见：" +
        "每条风险引用原文片段并给一句可操作的修改建议；缺失条款逐条说明为什么要补；" +
        "最后给「必须谈」清单（不超过3条）。严禁编造清单之外的条款或数字。",
      user: `合同标题：${title || "（未命名）"}\n事实清单（JSON）：\n${JSON.stringify(facts, null, 1)}\n\n合同原文：\n${description}`,
    });
    return { output: `${output}\n\n---\n*审查：Contract Guard · 引擎 DeepSeek（本地扫描 ${RISKS.length} 规则 + ${MUST_HAVE.length} 缺失项为事实层）*`, meta: { engine: "deepseek-chat", score: f.score, usage } };
  } catch (e) {
    console.error(`⚠️ [contract-agent] LLM 失败，降级本地规则：${e.message}`); // 坑#6：不静默吞
    return { output: renderLocal({ title }, f), meta: { engine: "local-rules", score: f.score, fallback: e.message } };
  }
}

listen(PORT, "contract-agent", brain);
