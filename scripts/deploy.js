// ═══════════════════════════════════════════════════════════════════
//  部署脚本（第 4 步版）：三合约按依赖顺序部署 + 自动写 deployed.json
//  用法：
//    npx hardhat run scripts/deploy.js                    ← 本地内存网络（先走一遍流程）
//    npx hardhat run scripts/deploy.js --network sepolia  ← 正式部署 Sepolia
//  依赖顺序：MyToken 独立 → AgentRegistry 独立 → TaskEscrow 需要 Registry 地址
// ═══════════════════════════════════════════════════════════════════
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  console.log(`网络: ${network} (chainId ${chainId})`);
  console.log(`部署者: ${deployer.address}`);

  // ── 1. MyToken（平台代币，独立无依赖）──
  const MyToken = await hre.ethers.getContractFactory("MyToken");
  const token = await MyToken.deploy();
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("✅ MyToken:      ", tokenAddr);

  // ── 2. AgentRegistry（上架登记簿，独立无依赖）──
  const Registry = await hre.ethers.getContractFactory("AgentRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("✅ AgentRegistry:", registryAddr);

  // ── 3. TaskEscrow（状态机+托管，构造函数要 Registry 地址）──
  const Escrow = await hre.ethers.getContractFactory("TaskEscrow");
  const escrow = await Escrow.deploy(registryAddr);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("✅ TaskEscrow:   ", escrowAddr);

  // ── 4. 地址表落盘（后端/前端都从这个文件读合约地址）──
  const deployed = {
    network,
    chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      MyToken: tokenAddr,
      AgentRegistry: registryAddr,
      TaskEscrow: escrowAddr,
    },
  };
  fs.writeFileSync(
    path.join(__dirname, "..", "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );
  console.log("\n📦 deployed.json 已写入项目根目录");

  // 直接把验证命令打出来，复制即用（Escrow 带构造参数 registryAddr）
  console.log("\n下一步开源验证（Etherscan），依次执行：");
  console.log(`  npx hardhat verify --network ${network} ${tokenAddr}`);
  console.log(`  npx hardhat verify --network ${network} ${registryAddr}`);
  console.log(`  npx hardhat verify --network ${network} ${escrowAddr} ${registryAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
