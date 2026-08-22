// 临时诊断：扫描链上任务状态（转所有权前确认没有卡在 Disputed 的案子）
const hre = require("hardhat");
const fs = require("fs");
async function main() {
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8")).contracts;
  const escrow = await hre.ethers.getContractAt("TaskEscrow", deployed.TaskEscrow);
  const n = Number(await escrow.nextTaskId());
  const states = ["Matching","Running","Review","Settled","Disputed","Cancelled"];
  const list = [];
  for (let i = 1; i < n; i++) {
    const t = await escrow.tasks(i);
    list.push(`#${i} ${states[Number(t.state)]}`);
    if (t.state === 4n) console.log(`⚠️ 任务#${i} 卡在 Disputed（publisher=${t.publisher} agentId=${t.agentId}）`);
  }
  console.log(list.join(" · "));
  console.log("escrow owner =", await escrow.owner());
}
main().catch(e => { console.error(e); process.exitCode = 1; });
