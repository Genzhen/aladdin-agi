// wagmi 配置：Sepolia + 浏览器钱包（MetaMask 注入的 injected provider）
import { createConfig, http } from 'wagmi'
import { mainnet, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [sepolia, mainnet],
  connectors: [injected()],
  // 浏览器端 RPC 走公共节点（系统代理下畅通）；生产换成自己的 Alchemy key
  transports: {
    [sepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
    [mainnet.id]: http(),
  },
})
