// ═══════════════════════════════════════════════════════════════════
//  sql-agent.js —— SQL 军师（开放市场演示体 4/5，端口 9014）
//  自然语言需求 → SQL + 逐段解释 + 索引建议。不在 manifest，上架填：
//  http://127.0.0.1:9014
// ═══════════════════════════════════════════════════════════════════
const { listen, llm } = require("../lib");

const PORT = 9014;

/** 需求关键词速览（本地降级与 prompt 共用） */
const AGGS = [["平均|均值", "AVG"], ["总数|数量|多少", "COUNT"], ["总和|合计", "SUM"], ["最高|最大", "MAX"], ["最低|最小", "MIN"], ["排名|前几|top", "ORDER BY + LIMIT"], ["每天|按日|趋势", "GROUP BY 日期"]];

/** 本地引擎（降级）：关键词 → 聚合函数映射表（诚实声明是骨架，不拼完整 SQL 瞎猜表名） */
function localBrain({ title, description }) {
  const text = `${title || ""} ${description || ""}`;
  const hits = AGGS.filter(([re]) => new RegExp(re).test(text)).map(([, fn]) => fn);
  const output = [
    "## SQL 骨架（离线降级模式）",
    "",
    "DeepSeek 不可用，离线只做关键词→聚合函数映射，不拼完整 SQL（表结构理解需要 LLM，瞎猜表名是污染）：",
    "",
    hits.length ? [...new Set(hits)].map((fn) => `- 检测到聚合需求 → \`${fn}\``).join("\n") : "- 未检测到明确聚合需求（可能是 JOIN/子查询类）",
    "",
    "> LLM 恢复后重新派单，将输出完整 SQL + 逐段解释 + 索引建议。",
  ].join("\n");
  return { output, meta: { engine: "local-keyword-map", detected: [...new Set(hits)] } };
}

async function brain({ title, description, tags }) {
  if (!description || String(description).trim().length < 10) {
    throw new Error("description 太短（把表结构和需求都写进来，军师才有的放矢）");
  }
  try {
    const { output, usage } = await llm({
      system:
        "你是资深数据工程师。根据给出的表结构/字段和业务需求写一条可执行的 SQL。输出 markdown 三段：" +
        "## SQL（```sql 代码块，MySQL 方言；只读查询，禁止写操作）；" +
        "## 逐段解释（对每个子句/JOIN/窗口函数各一行，为什么这么写）；" +
        "## 优化建议（索引/改写建议 1~3 条，说明预期收益；表结构没给全就先列'缺什么信息'）。" +
        "表结构不全时按合理假设写，并在解释里标注【假设】。只输出这三段。",
      user: `任务：${title || ""}\n场景/标签：${tags || ""}\n表结构与需求：\n${description}`,
    });
    return { output: `${output}\n\n---\n*SQL 军师 · 引擎 DeepSeek（${usage?.completion_tokens ?? "?"} tokens）*`, meta: { engine: "deepseek-chat", usage } };
  } catch (e) {
    console.error(`⚠️ [sql-agent] LLM 失败，降级关键词映射：${e.message}`);
    const r = localBrain({ title, description });
    return { ...r, meta: { ...r.meta, fallback: e.message } };
  }
}

listen(PORT, "sql-agent", brain);
