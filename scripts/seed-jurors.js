// ═══════════════════════════════════════════════════════════════════
//  seed-jurors.js —— 拉 3 名陪审员入池（全新钱包，谁都不是当事方）
//
//  每个陪审员：0.005 ETH 路费 → 空投 150 YD → approve → stake 100 入池
//  私钥落 .jurors-demo.json（gitignore；想在前端亲手投票就把任意一把
//  导入 MetaMask 切 Sepolia——地址上有 YD 有 ETH，即插即用陪审员）
//
//  用法（清代理变量）：
//    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u NODE_USE_ENV_PROXY \
//      npx hardhat run scripts/seed-jurors.js --network sepolia
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");

const JUROR_FILE = ".jurors-demo.json"; // 私钥文件（gitignore）
const GAS_ETH = "0.005";
const STAKE_YD = "100";
const AIRDROP_YD = "150";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const { YidengToken, JuryCourt } = JSON.parse(
    fs.readFileSync("deployed.json", "utf8")
  ).contracts;
  const yd = await hre.ethers.getContractAt("YidengToken", YidengToken);
  const court = await hre.ethers.getContractAt("JuryCourt", JuryCourt);

  // 钱包持久化：重跑复用同一批地址（陪审身份稳定，质押记录都挂在地址上）
  let wallets;
  if (fs.existsSync(JUROR_FILE)) {
    wallets = JSON.parse(fs.readFileSync(JUROR_FILE, "utf8")).map(
      (p) => new hre.ethers.Wallet(p, hre.ethers.provider)
    );
    console.log(`♻️ 复用已有陪审钱包 ×${wallets.length}`);
  } else {
    wallets = Array.from({ length: 3 }, () =>
      hre.ethers.Wallet.createRandom().connect(hre.ethers.provider)
    );
    fs.writeFileSync(JUROR_FILE, JSON.stringify(wallets.map((w) => w.privateKey), null, 2));
    console.log(`🆕 新建 3 个陪审钱包，私钥落 ${JUROR_FILE}`);
  }

  for (const w of wallets) {
    const label = `${w.address.slice(0, 10)}…`;

    // ① 路费（够就跳过）
    if ((await hre.ethers.provider.getBalance(w.address)) < hre.ethers.parseEther(GAS_ETH)) {
      const tx = await deployer.sendTransaction({
        to: w.address,
        value: hre.ethers.parseEther(GAS_ETH),
      });
      await tx.wait();
      console.log(`  ${label} 路费 ${GAS_ETH} ETH`);
    }

    // ② YD（余额不足 100 才空投）
    if ((await yd.balanceOf(w.address)) < hre.ethers.parseEther(STAKE_YD)) {
      const tx = await yd.airdrop([w.address], [hre.ethers.parseEther(AIRDROP_YD)]);
      await tx.wait();
      console.log(`  ${label} 空投 ${AIRDROP_YD} YD`);
    }

    // ③ approve + stake 100（幂等：池内质押达标就跳过）
    const j = await court.jurors(w.address);
    if (j.stake < hre.ethers.parseEther(STAKE_YD)) {
      let tx = await yd.connect(w).approve(JuryCourt, hre.ethers.parseEther(AIRDROP_YD));
      await tx.wait();
      tx = await court.connect(w).stake(hre.ethers.parseEther(STAKE_YD));
      await tx.wait();
      console.log(`  ${label} 质押 ${STAKE_YD} YD → 入池`);
    }
  }

  console.log(
    `\n陪审员池: ${await court.jurorCount()} 人 · 奖池: ${hre.ethers.formatEther(
      await court.rewardPool()
    )} YD`
  );
  console.log(`想在前端亲手投票：把 ${JUROR_FILE} 里任意一把私钥导入 MetaMask（Sepolia 网络）`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
