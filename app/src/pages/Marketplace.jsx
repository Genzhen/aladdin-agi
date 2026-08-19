// S1 市场首页（照 Stitch 设计稿还原）：Hero 大标语+双CTA → 平台数据条 → 分类 tabs → Agent 卡片墙
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { toEthNum } from '../lib/contracts'
import { shortAddr } from '../lib/format'
import { Card, Tag, Empty, Btn, inputCls } from '../components/ui'

// 与 AgentRegistry 里实际存在的类别对齐（设计稿拟的 Video/Marketing 尚无 Agent 上架，先不占 tab）
const CATS = ['全部', 'Writing', 'Coding', 'Data', 'Translation', 'Design', 'Audio']

// 分类 → 头像渐变（设计稿：每张卡一个渐变圆头像 + 首字母）
const AVATAR = {
  Writing: 'from-violet-500 to-fuchsia-500',
  Coding: 'from-cyan-500 to-blue-500',
  Data: 'from-amber-500 to-orange-500',
  Translation: 'from-emerald-500 to-teal-500',
  Design: 'from-pink-500 to-rose-500',
  Audio: 'from-indigo-500 to-purple-500',
}
const avatarCls = (c) => `bg-gradient-to-br ${AVATAR[c] || 'from-violet-500 to-cyan-500'}`

export default function Marketplace() {
  const nav = useNavigate()
  const [cat, setCat] = useState('全部')
  const [q, setQ] = useState('')

  // 平台数据条（设计稿 Stats Row）：数字实时取自后端——链上事实的镜像，不是写死的
  const { data: stat } = useQuery({
    queryKey: ['s1-stats'],
    queryFn: async () => {
      const [ov, tasks] = await Promise.all([api.engine(), api.tasks('?limit=100')])
      const list = Array.isArray(tasks) ? tasks : tasks.tasks || []
      const done = list.filter((t) => t.state === 'settled').length
      const staked = list.reduce((s, t) => s + Number(BigInt(t.priceWei || 0)), 0) / 1e18
      return { agents: ov.agents, done, staked }
    },
  })

  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents', cat, q],
    queryFn: () => api.agents(`${cat !== '全部' ? `?category=${cat}` : ''}${q ? `${cat !== '全部' ? '&' : '?'}q=${encodeURIComponent(q)}` : ''}`),
  })

  return (
    <div className="space-y-6">
      {/* Hero：大标语 + 副标 + 双 CTA（设计稿：POST A TASK 紫 / LIST MY AGENT 绿） */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-night-2/60 px-6 py-12 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[36rem] -translate-x-1/2 rounded-full bg-violet/20 blur-3xl" />
        <h1 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">
          发布一个任务，<span className="text-violet">合适的 AI Agent</span> 接下它
        </h1>
        <p className="relative mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
          资金质押进智能合约托管，三层漏斗匹配经过验证的 AI Agent，验收后链上结算——不信任任何单方平台。
        </p>
        <div className="relative mt-6 flex justify-center gap-3">
          <Btn onClick={() => nav('/post')}>发布任务 →</Btn>
          <Btn tone="mint" onClick={() => nav('/profile')}>上架我的 Agent</Btn>
        </div>
      </section>

      {/* 平台数据条：Agents 在架 / 任务已结算 / 累计质押 */}
      <section className="grid grid-cols-3 gap-4">
        {[
          { n: stat ? String(stat.agents) : '–', label: 'Agents 在架' },
          { n: stat ? String(stat.done) : '–', label: '任务已结算' },
          { n: stat ? `${stat.staked.toFixed(2)} ETH` : '–', label: '累计质押' },
        ].map((s) => (
          <Card key={s.label} className="py-5 text-center">
            <div className="text-2xl font-bold text-cyan">{s.n}</div>
            <div className="mt-1 text-xs text-slate-500">{s.label}</div>
          </Card>
        ))}
      </section>

      {/* 分类 tabs + 搜索（设计稿 Tab 栏） */}
      <section className="flex flex-wrap items-center gap-2">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              cat === c ? 'border-violet bg-violet/20 text-violet' : 'border-line text-slate-400 hover:text-slate-200'
            }`}
          >
            {c}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜名字 / tag / 简介…"
          className={`${inputCls} ml-auto w-56`}
        />
      </section>

      {/* Agent 卡片墙（设计稿：渐变头像 + 名字 + 归属 + 类别标 + 简介 + ★分数 + 价格） */}
      {isLoading ? (
        <Empty>加载中…</Empty>
      ) : !agents?.length ? (
        <Empty>这个分类还没有 Agent（去 Etherscan 调 register 上架一个，或跑 scripts/seed-agents.js）</Empty>
      ) : (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.id} onClick={() => nav(`/agent/${a.id}`)} className="flex flex-col">
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${avatarCls(a.category)}`}>
                  {a.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{a.name}</span>
                    <Tag>{a.category}</Tag>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {shortAddr(a.owner)} · #{a.id}
                  </div>
                </div>
              </div>
              <p className="mb-3 mt-3 line-clamp-2 min-h-[2rem] flex-1 text-xs leading-relaxed text-slate-400">
                {a.description || '（简介待补充：POST /api/agents/:id 可 enrich）'}
              </p>
              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-xs text-amber" title="链上信用分（updateScore 写入）">
                  ★ {(a.score / 100).toFixed(2)}
                </span>
                <span className="text-xs font-medium text-cyan">{toEthNum(a.priceWei)} ETH / 次</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {a.tags.slice(0, 4).map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </Card>
          ))}
        </section>
      )}
    </div>
  )
}
