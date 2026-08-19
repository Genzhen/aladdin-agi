// S3 发布任务（照 Stitch 设计稿还原：三步 stepper + 右侧 Order Summary）。
// 双写对账的全流程演示：
// ① 表单 → POST /api/tasks 存草稿拿 priceWei（长文本落库）
// ② 钱包调 escrow.postTask 质押 price+fee（链上是真相源）
// ③ Relayer 听到 TaskPosted → 按（publisher+priceWei）把草稿合体 → 详情页可查
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { ethToWei, feeOf } from '../lib/contracts'
import { Card, Field, Btn, inputCls } from '../components/ui'
import { useTx } from '../components/Wallet'

export default function PostTask() {
  const { address, isConnected } = useAccount()
  const qc = useQueryClient()
  const { send, pending, lastError } = useTx()

  const [form, setForm] = useState({
    title: '', category: 'Writing', tags: 'script,drama',
    description: '', priceEth: '0.1', days: 3,
  })
  const [taskId, setTaskId] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const priceWei = form.priceEth && !isNaN(form.priceEth) ? ethToWei(form.priceEth) : 0n
  const feeWei = feeOf(priceWei)
  const stake = priceWei + feeWei

  async function submit(e) {
    e.preventDefault()
    // ① 草稿落库（同一价格是链上对账的钥匙）
    const draft = await api.saveDraft({
      publisher: address, priceEth: form.priceEth,
      deadline: Math.floor(Date.now() / 1000) + form.days * 86400,
      title: form.title, category: form.category,
      tags: form.tags, description: form.description,
    })
    // ② 钱包质押（value 必须精确 == price + fee，合约 fail fast）
    const r = await send('escrow', 'postTask', {
      args: [priceWei, BigInt(Math.floor(Date.now() / 1000) + form.days * 86400)],
      value: stake,
    }, 'postTask 质押')
    if (r.ok) {
      // ③ 等 Relayer 合体草稿（轮询几次，新 id 就是列表里多出来的那条）
      for (let i = 0; i < 10; i++) {
        await new Promise((res) => setTimeout(res, 3000))
        const list = await api.tasks()
        const found = list.find((t) => t.title === form.title)
        if (found) { setTaskId(found.id); qc.invalidateQueries({ queryKey: ['tasks'] }); return }
      }
      setTaskId(-1) // 链上成功但库还没合体（Relayer 可能没起）
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* 三步 stepper（设计稿：Fill Details → Stake Funds → Match Agents） */}
      <section className="space-y-2">
        <h1 className="text-xl font-bold">发布任务</h1>
        <div className="flex items-center gap-2 text-xs">
          {['① 填写详情', '② 钱包质押', '③ 匹配 Agent'].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-600">—</span>}
              <span className={`rounded-full border px-3 py-1 ${
                i === 0 ? 'border-violet bg-violet/20 text-violet' : 'border-line text-slate-500'
              }`}>{s}</span>
            </div>
          ))}
        </div>
      </section>

      {!isConnected && <Card className="text-sm text-amber">⚠️ 先连接钱包（右上角）——质押要花你钱包里的 SepoliaETH</Card>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 左：任务表单 */}
        <Card className="lg:col-span-2">
          <form onSubmit={submit} className="space-y-4">
            <Field label="任务标题 *">
              <input className={inputCls} value={form.title} onChange={set('title')} placeholder="例：写一个 60 秒短视频带货剧本" required />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="分类">
                <select className={inputCls} value={form.category} onChange={set('category')}>
                  {['Writing', 'Coding', 'Data', 'Translation', 'Design', 'Audio'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="tags（逗号分隔，V0/V1 匹配的原料）">
                <input className={inputCls} value={form.tags} onChange={set('tags')} placeholder="script,drama" />
              </Field>
            </div>
            <Field label="详细描述">
              <textarea className={`${inputCls} h-24`} value={form.description} onChange={set('description')} placeholder="交付物、验收标准、风格要求…" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="预算（ETH）*">
                <input className={inputCls} value={form.priceEth} onChange={set('priceEth')} required />
              </Field>
              <Field label="交付期限（天）">
                <input className={inputCls} type="number" min="1" value={form.days} onChange={set('days')} />
              </Field>
            </div>
            {lastError && <div className="rounded-lg bg-rose/10 p-2 text-xs text-rose">❌ {lastError}</div>}
          </form>
        </Card>

        {/* 右：Order Summary（设计稿：Price / Platform fee / Total to stake + 质押按钮） */}
        <Card className="space-y-3 self-start lg:sticky lg:top-20">
          <h2 className="font-semibold">订单摘要</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>预算</span><span>{(Number(priceWei) / 1e18).toFixed(4)} ETH</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>平台手续费（0.1%）</span><span>{(Number(feeWei) / 1e18).toFixed(6)} ETH</span>
            </div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <span>合计质押</span><span className="text-cyan">{(Number(stake) / 1e18).toFixed(5)} ETH</span>
            </div>
          </div>
          <Btn className="w-full" disabled={!isConnected || !!pending || !form.title || !form.priceEth} onClick={submit}>
            🔒 {pending ? `⏳ ${pending.doing}…` : '连接 MetaMask 并质押'}
          </Btn>
          <p className="text-[11px] leading-relaxed text-slate-500">
            质押进 TaskEscrow 合约托管，验收通过才打给 Agent；不是打给平台。链上 value 必须精确等于合计数。
          </p>
        </Card>
      </div>

      {taskId === -1 && (
        <Card className="text-sm text-amber">交易已上链，但后端 30 秒内没合体到草稿——确认 server 窗口的 Relayer 在跑，然后去「我的」页找任务。</Card>
      )}
      {taskId > 0 && (
        <Card className="space-y-2 border-mint/40">
          <div className="font-semibold text-mint">✅ 任务 #{taskId} 发布成功！</div>
          <p className="text-xs text-slate-400">草稿已合体、匹配队列已通知（Go 引擎消费），点下面看三层漏斗的推荐结果：</p>
          <Link to={`/task/${taskId}`}><Btn tone="mint">查看任务 →</Btn></Link>
        </Card>
      )}
    </div>
  )
}
