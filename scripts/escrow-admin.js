// ═══════════════════════════════════════════════════════════════════
//  escrow-admin.js —— 部署者钱包对 TaskEscrow 的运维操作（演示/验收用）
//  用法（项目根，Hardhat 2 不透传 -- 参数，用环境变量）：
//    ACTION=approve ID=1 npx hardhat run scripts/escrow-admin.js --network sepolia
//    ACTION=dispute ID=2 npx hardhat run scripts/escrow-admin.js --network sepolia
//    ACTION=rule ID=2 ARG=2 npx hardhat run scripts/escrow-admin.js --network sepolia
//  说明：approve=雇主验收打款；dispute=开仲裁；rule=owner 裁决
//  （0=AgentWins 1=PublisherWins 2=Split）。生产中 rule 由仲裁委员会触发。
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const { ACTION: action, ID: idStr, ARG: arg } = process.env;
  const id = Number(idStr);
  if (!action || !id) throw new Error("用法: ACTION=<approve|dispute|rule> ID=<taskId> [ARG=<ruling>] 环境变量必填");

  const [deployer] = await hre.ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const escrow = await hre.ethers.getContractAt("TaskEscrow", deployed.TaskEscrow);

  // 读一遍状态机，让输出能当验收记录用
  const t = await escrow.tasks(id);

  let tx;
  if (action === "approve") tx = await escrow.approve(id);
  else if (action === "dispute") tx = await escrow.openDispute(id); // 仲裁费不在这收：裁决时从托管池扣 0.5%
  else if (action === "rule") tx = await escrow.executeRuling(id, Number(arg)); // 0=Agent胜 1=雇主胜 2=五五分
  else if (action === "accept") tx = await escrow.accept(id, Number(arg), { value: (t.price * 600n) / 10000n }); // arg=agentId，锁 6%
  else if (action === "submit") tx = await escrow.submit(id);
  else throw new Error(`未知操作 ${action}`);

  const rc = await tx.wait();
  const after = await escrow.tasks(id);
  console.log(`✅ ${action} 任务#${id}  tx: ${rc.hash}`);
  console.log(`   状态: ${t.state} → ${after.state}（gas ${rc.gasUsed}）`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
