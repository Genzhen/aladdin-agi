// ═══════════════════════════════════════════════════════════════════
//  demo-flow.js —— 链上种子 + 状态机全流程演示（第 5 步验收用）
//  用法（在项目根，走你的部署钱包）：
//    npx hardhat run scripts/demo-flow.js --network sepolia
//  做四件事（幂等：已有数据就跳过）：
//    1. 上架 3 个示例 Agent（S1 设计稿同款）
//    2. 发布一个任务（质押 0.1001 ETH）
//    3. Agent#1 接单（锁 0.006 保证金）
//    4. 交付 → Review（验收 approve 留给你在 Etherscan 点）
//  ⚠️ 演示自演自接（部署者一人分饰雇主+工程师）；生产中是两个钱包
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

// 三个演示 Agent（名称/分类/tags/单价，对应 S1 卡片）
const DEMO_AGENTS = [
  ["ScriptWriter Pro", "Writing", "script,drama,gpt", "0.05"],
  ["CodeWeaver", "Coding", "solidity,audit,defi", "0.12"],
  ["DataMiner X", "Data", "analysis,pandas,report", "0.08"],
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("执行者:", deployer.address);

  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const registry = await hre.ethers.getContractAt("AgentRegistry", deployed.AgentRegistry);
  const escrow = await hre.ethers.getContractAt("TaskEscrow", deployed.TaskEscrow);

  // ── 1. 种 Agent（缺几个补几个）──
  const existing = Number(await registry.totalAgents());
  for (let i = existing; i < DEMO_AGENTS.length; i++) {
    const [name, category, tags, priceEth] = DEMO_AGENTS[i];
    const tx = await registry.register(
      name, category, tags, hre.ethers.parseEther(priceEth)
    );
    await tx.wait(); // 等上链再走下一步（教学版节奏；生产可并行）
    console.log(`✅ 上架 Agent#${i + 1}: ${name}`);
  }

  // ── 2~4. 走一遍状态机（只在第一个任务时跑，保证可重复执行）──
  if (Number(await escrow.nextTaskId()) === 1) {
    const price = hre.ethers.parseEther("0.1");
    const fee = (price * 10n) / 10_000n;      // 0.1% 手续费
    const deposit = (price * 600n) / 10_000n; // 6% 保证金
    // ⚠️ BigInt + Number 混算会 TypeError——表达式右边也要全 BigInt（本项目第 3 次踩的同族坑）
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3n * 24n * 3600n;

    let tx = await escrow.postTask(price, deadline, { value: price + fee });
    await tx.wait();
    console.log("✅ 任务#1 已发布质押 0.1001 ETH（Matching）");

    tx = await escrow.accept(1, 1, { value: deposit });
    await tx.wait();
    console.log("✅ Agent#1 接单，锁 6% 保证金（Running）");

    tx = await escrow.submit(1);
    await tx.wait();
    console.log("✅ 交付完成（Review）");
    console.log("\n👉 最后一步留给你：打开 Etherscan 的 TaskEscrow → Write Contract");
    console.log("   连上钱包调 approve(1) —— 雇主=部署者，看 Relayer 同步 Settled");
  } else {
    console.log("任务已存在，跳过状态机流程（脚本幂等）");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
