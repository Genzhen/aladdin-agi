// ═══════════════════════════════════════════════════════════════════
//  deploy-jury.js —— 第 11 步：部署陪审法庭（YD + JuryCourt + 所有权移交）
//
//  顺序：YidengToken → JuryCourt(yd, escrow, 金库=部署者, 600s 投票窗)
//        → escrow.transferOwnership(court) ★裁决权移交（escrow 注释第 183
//        行预留的升级路径："接口不变，换触发方"）
//        → 法庭奖池注资 5000 YD（多数方每案 10 YD 的储备）
//
//  用法（清代理变量，坑#11）：
//    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u NODE_USE_ENV_PROXY \
//      npx hardhat run scripts/deploy-jury.js --network sepolia
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

const VOTE_PERIOD = 600; // 投票窗口 10 分钟（3 票齐可提前宣判，演示不干等）
const POOL_FUND = "5000"; // 奖池注资 YD

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployed = JSON.parse(fs.readFileSync("deployed.json", "utf8"));
  const escrowAddr = deployed.contracts.TaskEscrow;
  if (!escrowAddr) throw new Error("deployed.json 里没有 TaskEscrow——先跑 deploy.js");

  // ── 1. YD 陪审资格币 ──
  const YD = await hre.ethers.getContractFactory("YidengToken");
  const yd = await YD.deploy();
  await yd.waitForDeployment();
  const ydAddr = await yd.getAddress();
  console.log("✅ YidengToken: ", ydAddr);

  // ── 2. 法庭（金库=部署者，收 0.1% 手续费）──
  const Court = await hre.ethers.getContractFactory("JuryCourt");
  const court = await Court.deploy(ydAddr, escrowAddr, deployer.address, VOTE_PERIOD);
  await court.waitForDeployment();
  const courtAddr = await court.getAddress();
  console.log("✅ JuryCourt:  ", courtAddr);

  // ── 3. ★裁决权移交：平台连裁决权一起交出去 ──
  const escrow = await hre.ethers.getContractAt("TaskEscrow", escrowAddr);
  let tx = await escrow.transferOwnership(courtAddr);
  await tx.wait();
  console.log(`✅ escrow.owner → 法庭（此后 executeRuling 只有法庭能调，`);
  console.log(`   平台前端的三键裁决会 revert——这正是去中心化的意思）`);

  // ── 4. 奖池注资 ──
  tx = await yd.transfer(courtAddr, hre.ethers.parseEther(POOL_FUND));
  await tx.wait();
  console.log(`✅ 奖池注资 ${POOL_FUND} YD（slash 的罚金也会回流这里）`);

  // ── 5. 地址表落盘（后端/前端都从 deployed.json 读）──
  deployed.contracts.YidengToken = ydAddr;
  deployed.contracts.JuryCourt = courtAddr;
  deployed.juryDeployedAt = new Date().toISOString();
  fs.writeFileSync("deployed.json", JSON.stringify(deployed, null, 2));
  console.log("📦 deployed.json 已更新（+YidengToken +JuryCourt）");

  console.log("\n开源验证（复制即用）：");
  console.log(`  npx hardhat verify --network sepolia ${ydAddr}`);
  console.log(`  npx hardhat verify --network sepolia ${courtAddr} ${ydAddr} ${escrowAddr} ${deployer.address} ${VOTE_PERIOD}`);
  console.log("\n下一步：seed-jurors.js 拉 3 名陪审员入池");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
