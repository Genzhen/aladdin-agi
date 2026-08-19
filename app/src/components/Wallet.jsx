// 钱包连接组件：injected（MetaMask）。连接后展示地址 + MYT 余额 + 水龙头
import { useAccount, useConnect, useDisconnect, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useState } from 'react'
import { ABI, ADDR } from '../lib/contracts'
import { shortAddr } from '../lib/format'
import { Btn } from './ui'

export function useTx() {
  const { writeContractAsync } = useWriteContract()
  const [pending, setPending] = useState(null) // { hash, doing }
  const [lastError, setLastError] = useState('')

  /** 发交易 → 等确认；返回是否成功（组件层再刷新数据） */
  async function send(contract, functionName, args = {}, label = functionName) {
    setLastError('')
    setPending({ hash: null, doing: label })
    try {
      const hash = await writeContractAsync({
        address: ADDR[contract],
        abi: ABI[contract.toLowerCase()] || ABI[contract],
        functionName,
        ...args,
      })
      setPending({ hash, doing: label })
      const rc = await waitForTx(hash)
      setPending(null)
      return { ok: rc.status === 'success', hash }
    } catch (e) {
      setPending(null)
      setLastError(e.shortMessage || e.message.slice(0, 120))
      return { ok: false }
    }
  }
  return { send, pending, lastError }
}

// 极简回执轮询（wagmi v2 推荐用 useWaitForTransactionReceipt 钩子；
// 命令式场景直接拿 publicClient 等，教学版保持一眼能看懂）
async function waitForTx(hash) {
  const { getPublicClient } = await import('wagmi/actions')
  const client = getPublicClient()
  return client.waitForTransactionReceipt({ hash })
}

export function WalletChip() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const { send, pending } = useTx()

  const { data: myt, refetch } = useReadContract({
    address: ADDR.MyToken,
    abi: ABI.token,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  if (!isConnected) {
    const injected0 = connectors[0]
    return (
      <Btn size="sm" onClick={() => injected0 && connect({ connector: injected0 })}>
        🦊 连接钱包
      </Btn>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-lg border border-line bg-night-2 px-2.5 py-1 text-xs text-slate-300">
        {Number(myt || 0n) / 1e18 | 0} MYT
      </span>
      <Btn
        size="sm"
        tone="cyan"
        disabled={!!pending}
        onClick={async () => {
          const r = await send('token', 'faucet', {}, 'faucet 领 20 MYT')
          if (r.ok) refetch()
        }}
      >
        {pending?.doing === 'faucet 领 20 MYT' ? '⏳' : '💧 水龙头'}
      </Btn>
      <button onClick={() => disconnect()} className="rounded-lg bg-night-3 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200" title="断开">
        {shortAddr(address)}
      </button>
    </div>
  )
}
