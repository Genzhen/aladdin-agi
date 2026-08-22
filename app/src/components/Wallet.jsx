// 钱包连接组件：injected（MetaMask）。连接后展示地址 + MYT 余额 + 水龙头
import { useAccount, useConnect, useDisconnect, useReadContract, useWriteContract } from 'wagmi'
import { useState } from 'react'
import { ABI, ADDR } from '../lib/contracts'
import { config } from '../wagmi'
import { shortAddr } from '../lib/format'
import { Btn } from './ui'

export function useTx() {
  const { writeContractAsync } = useWriteContract()
  const { address } = useAccount()
  const [pending, setPending] = useState(null) // { hash, doing }
  const [lastError, setLastError] = useState('')

  /** 发交易 → 等确认；返回是否成功（组件层再刷新数据） */
  async function send(contract, functionName, args = {}, label = functionName) {
    setLastError('')
    setPending({ hash: null, doing: label })
    try {
      if (!address) throw new Error('请先连接钱包')

      const targetChainId = config.chains[0].id
      const { getPublicClient } = await import('wagmi/actions')
      const publicClient = getPublicClient(config, { chainId: targetChainId })
      const meta = getContractMeta(contract)
      const txRequest = {
        address: meta.address,
        abi: meta.abi,
        functionName,
        ...args,
        account: address,
      }

      // 先预检 revert，再显式估 gas。simulateContract 的 request 不保证含 gas。
      await publicClient.simulateContract(txRequest)
      const estimatedGas = await publicClient.estimateContractGas(txRequest)
      const gas = (estimatedGas * 13n) / 10n // 30% 余量：estimate 与实际打包之间的状态漂移

      const hash = await writeContractAsync({
        address: meta.address,
        abi: meta.abi,
        functionName,
        ...args,
        gas,
        chainId: targetChainId,
      })
      setPending({ hash, doing: label })
      const rc = await waitForTx(hash, targetChainId)
      setPending(null)
      return { ok: rc.status === 'success', hash }
    } catch (e) {
      setPending(null)
      console.error(`[tx:${label}]`, e)
      setLastError(formatTxError(e))
      return { ok: false }
    }
  }
  return { send, pending, lastError }
}

function getContractMeta(contract) {
  const aliases = {
    token: 'MyToken',
    registry: 'AgentRegistry',
    escrow: 'TaskEscrow',
  }
  const addressKey = aliases[contract] || contract
  const abiKey = contract.toLowerCase()
  const meta = {
    address: ADDR[addressKey],
    abi: ABI[abiKey] || ABI[contract] || ABI[addressKey],
  }
  if (!meta.address || !meta.abi) throw new Error(`未知合约: ${contract}`)
  return meta
}

// 极简回执轮询（wagmi v2 推荐用 useWaitForTransactionReceipt 钩子；
// 命令式场景直接拿 publicClient 等，教学版保持一眼能看懂）
async function waitForTx(hash, chainId) {
  const { getPublicClient } = await import('wagmi/actions')
  const client = getPublicClient(config, { chainId })
  return client.waitForTransactionReceipt({ hash })
}

function formatTxError(error) {
  const parts = []
  const seen = new Set()
  let cur = error
  for (let i = 0; cur && i < 8; i += 1) {
    const code = cur.code ?? cur.cause?.code
    const data = cur.data ?? cur.cause?.data
    for (const key of ['shortMessage', 'details', 'message']) {
      const raw = cur[key]
      if (!raw || seen.has(raw)) continue
      seen.add(raw)
      parts.push(String(raw).replace(/\n+/g, ' ').trim())
    }
    if (code && !seen.has(`code:${code}`)) {
      seen.add(`code:${code}`)
      parts.push(`RPC code ${code}`)
    }
    if (data && typeof data === 'string' && !seen.has(`data:${data}`)) {
      seen.add(`data:${data}`)
      parts.push(`data ${data}`)
    }
    cur = cur.cause
  }

  const message = parts.find((p) => /Escrow:|revert|user rejected|Transaction creation failed|RPC code/i.test(p)) || parts[0] || '交易失败'
  return message.length > 260 ? `${message.slice(0, 260)}...` : message
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
