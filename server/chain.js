// ═══════════════════════════════════════════════════════════════════
//  chain.js —— 后端连链的"接线板"
//  地址从 deployed.json 读（部署脚本的产物 = 地址单一来源），
//  ABI 从 ../artifacts 读（Hardhat 编译产物，和部署的字节码同源）。
//  只读连接（不配私钥）：Relayer 只监听事件，不替任何人发交易。
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, ".."); // 项目根（Hardhat 项目）

const deployed = JSON.parse(
  fs.readFileSync(path.join(ROOT, "deployed.json"), "utf8")
);

/** 从 Hardhat 编译产物里取 ABI（.json 的 abi 字段） */
function loadAbi(solFile) {
  const art = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "artifacts", "contracts", solFile),
      "utf8"
    )
  );
  return art.abi;
}

const RPC =
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const provider = new ethers.JsonRpcProvider(RPC);

// 三个合约的只读实例（调 view 函数 / 监听事件都够用）
const registry = new ethers.Contract(
  deployed.contracts.AgentRegistry,
  loadAbi("AgentRegistry.sol/AgentRegistry.json"),
  provider
);
const escrow = new ethers.Contract(
  deployed.contracts.TaskEscrow,
  loadAbi("TaskEscrow.sol/TaskEscrow.json"),
  provider
);
const token = new ethers.Contract(
  deployed.contracts.MyToken,
  loadAbi("MyToken.sol/MyToken.json"),
  provider
);

module.exports = { provider, registry, escrow, token, deployed };
