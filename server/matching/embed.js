// ═══════════════════════════════════════════════════════════════════
//  matching/embed.js —— V1 远程引擎：OpenAI 兼容 /embeddings 客户端（可选）
//
//  语义向量 vs 本地 TF-IDF 词袋：embedding 能跨表述（"短剧脚本"≈"剧本创作"，
//  共享"创作意图"这个语义方向），词袋只认字面重合。成本是外部依赖：
//  任何 OpenAI 兼容端点都行（硅基流动 BAAI/bge-m3 免费 / OpenAI text-embedding-3-small）。
//  DeepSeek 官方 API 没有 /embeddings 端点（已实测 404）。
//
//  配置（项目根 .env，三样齐才启用）：
//    EMBEDDING_BASE_URL = https://api.siliconflow.cn/v1
//    EMBEDDING_API_KEY  = sk-xxx
//    EMBEDDING_MODEL    = BAAI/bge-m3
//
//  可靠性设计（向真实产品看齐）：
//    - 8s 超时：匹配在任务下发热路径上，宁可降级不可卡死
//    - 熔断：失败后 5 分钟内不再尝试（否则每次 dispatch 都白等一个超时）
//    - 永远由调用方降级本地 TF-IDF——外部 API 挂了匹配照跑，只是精度降级
// ═══════════════════════════════════════════════════════════════════

const BREAKER_MS = 5 * 60 * 1000; // 熔断窗口
let breakerUntil = 0;             // 0=从未熔断；期间 available() 直接说"没有"

/** 三样配置齐 + 未处熔断期 → 才真的可用 */
function available() {
  if (Date.now() < breakerUntil) return false;
  return Boolean(
    process.env.EMBEDDING_BASE_URL &&
    process.env.EMBEDDING_API_KEY &&
    process.env.EMBEDDING_MODEL
  );
}

/** 批量向量化：POST {base}/embeddings，input 是字符串数组（一次调用拿全部向量） */
async function embedTexts(texts) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${process.env.EMBEDDING_BASE_URL.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.EMBEDDING_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: process.env.EMBEDDING_MODEL, input: texts }),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    // OpenAI 兼容格式 {data:[{index, embedding:number[]}…]}，按 index 归位
    const vecs = data.data.map(() => null);
    for (const d of data.data) vecs[d.index] = d.embedding;
    if (vecs.some((v) => !v)) throw new Error("响应缺向量");
    return vecs;
  } catch (e) {
    breakerUntil = Date.now() + BREAKER_MS; // 跳闸：5 分钟内降级本地
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 稠密向量余弦：dot/(|a||b|)。TF-IDF 是稀疏 Map 版（v1.cosine），这里是数组版 */
function denseCosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

module.exports = { available, embedTexts, denseCosine };
