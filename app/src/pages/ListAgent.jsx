// 上架 Agent(工程师侧)。与 PostTask(项目里最复杂的写页)对照着读,少三样:
// ① 无 payable 质押——register 不带 value,只烧 gas
// ② 无草稿落库/双写对账——链上 register 一次,Relayer 听 AgentRegistered
//    自动入库并记 +10 MYT(agent_listed),前端零配合
// ③ 剩下要做的只是:发交易 → 轮询 /api/agents 等新名字出现
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { ethToWei } from '../lib/contracts'
import { Card, Field, Btn, inputCls } from '../components/ui'
import { useTx } from '../components/Wallet'

export default function ListAgent() {
  const { isConnected } = useAccount()
  const qc = useQueryClient()
  const { send, pending, lastError } = useTx()

  const [form, setForm] = useState({ name: '', category: 'Coding', tags: '', priceEth: '0.01' })
  const [agentId, setAgentId] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const priceWei = form.priceEth && !isNaN(form.priceEth) ? ethToWei(form.priceEth) : 0n

  async function submit(e) {
    e.preventDefault()
    // 链上登记(元数据 4 件套:名字/分类/标签/单次定价。Agent 本体不在链上)
    const r = await send('registry', 'register', {
      args: [form.name, form.category, form.tags, priceWei],
    }, '上架 Agent')
    if (!r.ok) return
    // 等 Relayer 把链上事件同步进库(按名字找——链上没有按名查的接口,库才是索引)
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 3000))
      const list = await api.agents()
      const found = list.find((a) => a.name === form.name)
      if (found) { setAgentId(found.id); qc.invalidateQueries({ queryKey: ['agents'] }); return }
    }
    setAgentId(-1) // 链上成功但库里还没出现(Relayer 延迟)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section>
        <h1 className="text-xl font-bold">上架我的 Agent</h1>
        <p className="mt-1 text-xs text-slate-500">
          链上登记的是元数据(名字/分类/标签/定价),不是上传代码——Agent 本体部署在你自己的服务里,接单权归钱包地址。
        </p>
      </section>

      {!isConnected && <Card className="text-sm text-amber">⚠️ 先连接钱包(右上角)——register 是一笔链上交易,要花 SepoliaETH gas</Card>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 左:登记表单 */}
        <Card className="lg:col-span-2">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Agent 名称 *">
              <input className={inputCls} value={form.name} onChange={set('name')} placeholder="例:Solidity Sentinel" required />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="分类">
                <select className={inputCls} value={form.category} onChange={set('category')}>
                  {['Writing', 'Coding', 'Data', 'Translation', 'Design', 'Audio'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="tags(逗号分隔,V0/V1 匹配的原料)">
                <input className={inputCls} value={form.tags} onChange={set('tags')} placeholder="solidity,audit,erc20" />
              </Field>
            </div>
            <Field label="单次调用定价(ETH)*" hint="合约要求 pricePerRun > 0,0 会被 revert">
              <input className={inputCls} value={form.priceEth} onChange={set('priceEth')} required />
            </Field>
            {lastError && <div className="rounded-lg bg-rose/10 p-2 text-xs text-rose">❌ {lastError}</div>}
          </form>
        </Card>

        {/* 右:摘要 + 上架按钮 */}
        <Card className="space-y-3 self-start lg:sticky lg:top-20">
          <h2 className="font-semibold">上架摘要</h2>
          <div className="flex justify-between text-sm text-slate-400">
            <span>单次定价</span><span className="text-cyan">{(Number(priceWei) / 1e18).toFixed(4)} ETH</span>
          </div>
          <div className="flex justify-between text-sm text-slate-400">
            <span>上架费</span><span>0(只付 gas)</span>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-sm text-slate-400">
            <span>上架奖励</span><span className="text-mint">+10 MYT(Relayer 自动记账)</span>
          </div>
          <Btn className="w-full" tone="mint" disabled={!isConnected || !!pending || !form.name || !(Number(form.priceEth) > 0)} onClick={submit}>
            🔒 {pending ? `⏳ ${pending.doing}…` : '连接 MetaMask 并上架'}
          </Btn>
          <p className="text-[11px] leading-relaxed text-slate-500">
            交易确认后 Relayer 自动同步(约十几秒),市场页与「我的」页随之出现;新 Agent 评分 0 = 冷启动,V2 匹配给中性先验。
          </p>
        </Card>
      </div>

      {agentId === -1 && (
        <Card className="text-sm text-amber">交易已上链,但库里 30 秒内没出现——稍等 Relayer 同步,或去「我的」页确认。</Card>
      )}
      {agentId > 0 && (
        <Card className="space-y-2 border-mint/40">
          <div className="font-semibold text-mint">✅ Agent #{agentId} 上架成功!</div>
          <p className="text-xs text-slate-400">市场页已可见,+10 MYT 已记账。去详情页看看它的冷启动状态:</p>
          <Link to={`/agent/${agentId}`}><Btn tone="mint">查看 Agent →</Btn></Link>
        </Card>
      )}
    </div>
  )
}
