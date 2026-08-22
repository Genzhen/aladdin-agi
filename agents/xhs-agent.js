// ═══════════════════════════════════════════════════════════════════
//  xhs-agent.js —— 小红书文案师（L3 实验体，对应链上"小红书文案师"）
//  端口 9007。与前面 6 个执行体的本质区别只有一行：
//
//    它的 owner 是【第二钱包】（XHS_PRIVATE_KEY），不是部署钱包。
//
//  于是合约法条自然生效（TaskEscrow.sol:137）：
//    accept  要求 msg.sender == registry.ownerOf(agentId) → 平台代签 accept 必 revert
//    submit  要求 msg.sender == t.agent（= 接单的第二钱包）→ 平台代签 submit 必 revert
//  执行体自持钥：干完活自己签 submit 上链（lib.submitSelf），平台 relayer
//  退回纯路由——这就是"接单权归钱包地址，平台只是撮合 marketplace"。
// ═══════════════════════════════════════════════════════════════════
const { listen, llm, submitSelf } = require("./lib");

const PORT = 9007;

/** 二字滑窗关键词（本地降级引擎用；与 writer-agent 同思路的迷你版） */
const STOP = new Set(["的", "了", "和", "是", "在", "我", "你", "就", "不", "都", "一个", "这个", "什么", "可以", "我们", "需要"]);

function keywords(text, topN = 4) {
  const freq = new Map();
  for (const tk of String(text || "").split(/[^\p{L}\p{N}]+/u)) {
    if (!tk) continue;
    if (/^[一-鿿]{2,}$/.test(tk)) {
      for (let i = 0; i + 2 <= tk.length; i++) {
        const g = tk.slice(i, i + 2);
        if (STOP.has(g) || [...g].some((c) => STOP.has(c))) continue;
        freq.set(g, (freq.get(g) || 0) + 1);
      }
    } else if (tk.length > 1) freq.set(tk, (freq.get(tk) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topN).map(([w]) => w);
}

/** 本地引擎（降级路径）：小红书体模板组装——emoji 标题、hook 开头、要点、话题标签 */
function localBrain({ title, description, tags }) {
  const kws = keywords(`${title || ""} ${description} ${tags || ""}`);
  const [k1 = "生活", k2 = k1, k3 = k2] = kws;
  const output = [
    `🔥 ${title || `${k1}保姆级攻略`}，看完直接抄作业！`,
    ``,
    `姐妹们！今天必须来聊聊 **${k1}** 这个话题👇`,
    ``,
    `## ✨ 为什么是${k1}？`,
    `- 真实体验：${(String(description).match(/[^。！？\n]+/) || [`${k1}真的改变了我的日常`])[0].slice(0, 50)}`,
    `- 没有废话，全是可以直接抄的干货`,
    ``,
    `## 📝 ${k2}怎么做（3 步版）`,
    `1. 先搞清楚自己要什么（${k2}不是跟风，是匹配需求）`,
    `2. 选对工具/场景，成本低到离谱`,
    `3. 坚持 7 天，回头看会感谢自己`,
    ``,
    `## 💡 避坑提示`,
    `- 别贪多：${k1} + ${k2} 组合拳就够了`,
    `- 记录过程，${k3} 的复利藏在坚持里`,
    ``,
    `收藏这篇，下次不知道干嘛就翻出来看🌟`,
    ``,
    `#${k1} #${k2} #干货分享 #${k3}`,
  ].join("\n");
  return { output, meta: { engine: "local-template", keywords: kws } };
}

/** 大脑：DeepSeek 写小红书体；失败降级本地模板。干完活自签 submit（fire-and-forget，不堵 /run 响应） */
async function brain(payload) {
  const { taskId, title, description, tags } = payload;
  if (!description || String(description).trim().length < 10) {
    throw new Error("description 太短（≥10 字才能写文案）——上游要校验好再派单");
  }
  try {
    const { output, usage } = await llm({
      system:
        "你是小红书头部文案博主。根据任务写一篇小红书笔记：一个带 emoji 的抓眼标题、" +
        "姐妹式 hook 开头、2~3 个带 emoji 小标题的干货段落、结尾引导收藏、最后一行 4 个 #话题标签。" +
        "口语化、真诚不端着、句子短。只输出笔记正文，不要任何解释。",
      user: `任务标题：${title || "（无）"}\n标签：${tags || "（无）"}\n任务描述：\n${description}`,
    });
    var result = { output: `${output}\n\n---\n*小红书文案师 · 引擎 DeepSeek（${usage?.completion_tokens ?? "?"} tokens）*`, meta: { engine: "deepseek-chat", usage } };
  } catch (e) {
    console.error(`⚠️ [xhs-agent] LLM 失败，降级本地模板：${e.message}`); // 坑#6：不静默吞
    const r = localBrain(payload);
    result = { ...r, meta: { ...r.meta, fallback: e.message } };
  }

  // ── L3 灵魂三行：交付物交回平台路由，submit 自己签 ──
  // meta.selfSubmitted 告诉 agent-runner"别代签了"；签名失败在这里喊出来，
  // 任务会诚实地卡在 running（绝不谎报交付完成）。
  if (taskId && process.env.XHS_PRIVATE_KEY) {
    result.meta.selfSubmitted = true;
    submitSelf(taskId)
      .then((h) => console.log(`📤 [xhs-agent] 自签 submit 任务#${taskId} → review（tx ${h}）——第二钱包签字，平台零参与`))
      .catch((e) => console.error(`⚠️ [xhs-agent] 自签 submit 失败，任务#${taskId} 将停在 running（人工处置）：${e.shortMessage || e.message}`));
  } else if (taskId) {
    console.error(`⚠️ [xhs-agent] 没有 XHS_PRIVATE_KEY，无法自签——平台代签对第二钱包 Agent 必 revert`);
  }
  return result;
}

listen(PORT, "xhs-agent", brain);
