// ═══════════════════════════════════════════════════════════════════
//  post-demo-task.js —— 部署者钱包发布任务（双写对账演示的链上那半边）
//  先 POST /api/tasks 存草稿拿 priceWei，再用同样价格链上质押——
//  Relayer 听到 TaskPosted 后按（publisher+priceWei）把草稿合体。
//  用法：PRICE_ETH=0.08 npx hardhat run scripts/post-demo-task.js --network sepolia
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const escrow = await hre.ethers.getContractAt("TaskEscrow", deployed.TaskEscrow);

  const price = hre.ethers.parseEther(process.env.PRICE_ETH || "0.08");
  const fee = (price * 10n) / 10_000n; // 0.1% 平台费，和合约 FEE 常量一致
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3n * 24n * 3600n; // 全 BigInt，别混 Number

  const tx = await escrow.postTask(price, deadline, { value: price + fee });
  const rc = await tx.wait();
  const id = await escrow.nextTaskId();
  console.log(`✅ 任务#${Number(id) - 1} 已质押 ${hre.ethers.formatEther(price + fee)} ETH`);
  console.log(`   tx: ${rc.hash}`);
  console.log("   → 草稿应被 Relayer 自动合体（看 server 日志 TaskPosted 行）");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
