// ═══════════════════════════════════════════════════════════════════
//  demo-mastra-flow.js —— Mastra 双执行体端到端演示（2026-08-22）
//
//  一条龙（全程无人手，接单后的交付是 Relayer→执行体自动的）：
//    草稿→链上质押→等匹配→指定 Agent 接单→等执行体交付(submit)→验收解锁
//  跑两单：Design→Pixel Alchemist（SVG 成图）；Coding→Site Forger（整站预览）
//
//  用法（清代理变量，坑#11；server/engine-go/两个执行体都要开着）：
//    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u NODE_USE_ENV_PROXY \
//      npx hardhat run scripts/demo-mastra-flow.js --network sepolia
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

const API = process.env.API_BASE || "http://localhost:3001"; // 线上冒烟：API_BASE=https://aladdin.myanext.com

const DEMOS = [
  {
    agentName: "Pixel Alchemist",
    priceEth: "0.06",
    task: {
      title: "Web3 课程招募海报",
      category: "Design",
      tags: "poster,web3,course",
      description: "给『Web3 十二课』做一张招募海报：深色科技风配霓虹青强调色，大标题『十二课，成为链上工程师』，副标题『零基础到合约实战』，底部小字『2026 秋季班 · 报名即送测试网 ETH』",
    },
    file: "/tmp/mastra-demo-poster.svg",
  },
  {
    agentName: "Site Forger",
    priceEth: "0.09",
    task: {
      title: "课程宣传落地页",
      category: "Coding",
      tags: "landing,website,web3",
      description: "给 Web3 十二课做一个宣传落地页：深色科技风，访客是想转行链上开发的新手；要有 hero（大标题+报名按钮）、课程亮点三格、讲师背书、常见问答、页脚报名行动条",
    },
    file: "/tmp/mastra-demo-site.html",
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path, opts) => fetch(`${API}${path}`, opts).then((r) => r.json());

async function waitState(id, want, ms = 100_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await api(`/api/tasks/${id}`);
    if (t.state === want) return t;
    if (["disputed", "cancelled"].includes(t.state)) throw new Error(`任务#${id} 异常态 ${t.state}`);
    await sleep(3000);
  }
  throw new Error(`等任务#${id} → ${want} 超时`);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const escrow = await hre.ethers.getContractAt("TaskEscrow", deployed.TaskEscrow);

  for (const d of DEMOS) {
    const agents = await api("/api/agents");
    const a = agents.find((x) => x.name === d.agentName);
    if (!a) throw new Error(`${d.agentName} 不在架——先跑 seed-agents-round3.js`);
    if (!a.endpoint) throw new Error(`${d.agentName} 执行体还没接线（心跳 30s 内自动接，稍候重跑）`);
    console.log(`\n════ ${d.agentName}（Agent#${a.id} · ${a.endpoint}）════`);

    // ① 草稿进库 ② 链上质押（Relayer 按 publisher+price 合体）
    const price = hre.ethers.parseEther(d.priceEth);
    const fee = (price * 10n) / 10_000n;
    const deposit = (price * 600n) / 10_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3n * 24n * 3600n;
    const draft = await api("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publisher: deployer.address, priceEth: d.priceEth, deadline: Number(deadline), ...d.task }),
    });
    if (!draft.ok && !draft.id) throw new Error(`草稿失败: ${JSON.stringify(draft)}`);
    let tx = await escrow.postTask(price, deadline, { value: price + fee });
    await tx.wait();
    const id = Number(await escrow.nextTaskId()) - 1;
    console.log(`①② 任务#${id} 质押 ${d.priceEth} ETH  tx=${tx.hash}`);

    // ③ 等 engine-go 消费队列跑完匹配
    await sleep(9000);
    const matched = await api(`/api/tasks/${id}`);
    console.log(`③ 匹配候选: ${(matched.candidates || []).map((c) => `#${c.agentId}${c.name}`).join(" / ") || "（空）"}`);

    // ④ 指定 Agent 接单（owner=部署钱包，可签）
    tx = await escrow.accept(id, a.id, { value: deposit });
    await tx.wait();
    console.log(`④ Agent#${a.id} 接单（锁 ${hre.ethers.formatEther(deposit)} ETH）→ 执行体自动开工，等交付…`);

    // ⑤ 等 submit → review（执行体真跑 LLM，35s 上下）
    await waitState(id, "review");
    console.log(`⑤ 交付完成，state=review（样章锁中）`);

    // ⑥ 雇主验收打款 → settled 解锁成品
    tx = await escrow.approve(id);
    await tx.wait();
    const done = await waitState(id, "settled", 30_000);
    fs.writeFileSync(d.file, done.deliverable.output.split("\n---\n")[0]);
    console.log(`⑥ 验收打款 → settled ✅ 成品落 ${d.file}（${done.deliverable.output.length} 字）`);
    console.log(`   前端看效果: http://localhost:5173/task/${id}`);
  }
  console.log("\n🎬 两单全闭环：Design 出图、Coding 出站，解锁即渲染");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
