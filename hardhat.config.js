require("@nomicfoundation/hardhat-toolbox");
// ⚠️ 坑位：Hardhat 2.29 不会自动加载 .env（dotenv 也不是它的依赖），
// 必须显式引入并执行 config()，否则 process.env.PRIVATE_KEY 永远是 undefined
require("dotenv").config();

// 私钥格式统一：去空白、补 0x 前缀（MetaMask 导出可能不带 0x）
const PRIVATE_KEY = (process.env.PRIVATE_KEY || "")
  .trim()
  .replace(/^0x/, "");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      // 坑位复盘（「Web3 大学」踩过）：OpenZeppelin 5.6 的库代码用了
      // cancun 才有的 mcopy 指令，而 solc 默认编译目标是 paris → 编译报错。
      // 显式指定 evmVersion 解决。之后 Etherscan 验证时 EVM version 同样选 cancun。
      evmVersion: "cancun",
    },
  },
  networks: {
    sepolia: {
      // Hardhat 会自动加载根目录 .env（不用 require("dotenv")）
      // RPC 留空走公共节点 publicnode（和记事本 DApp 同款）
      url:
        process.env.SEPOLIA_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: PRIVATE_KEY ? ["0x" + PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    // Etherscan V2 API Key（复用「Web3 大学」那把；留空则 verify 会失败）
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
};
