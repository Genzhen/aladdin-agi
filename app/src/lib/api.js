// 后端 API 封装：开发期经 vite 代理同源（/api → :3001），部署时同域直连
async function req(path, opts = {}) {
  const r = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}

export const api = {
  agents: (params = '') => req(`/agents${params}`),
  agent: (id) => req(`/agents/${id}`),
  enrichAgent: (id, body) => req(`/agents/${id}`, { method: 'POST', body }),
  tasks: (params = '') => req(`/tasks${params}`),
  task: (id) => req(`/tasks/${id}`),
  saveDraft: (body) => req('/tasks', { method: 'POST', body }),
  dispatch: (id) => req(`/tasks/${id}/dispatch`, { method: 'POST', body: {} }),
  click: (id, agentId) => req(`/tasks/${id}/click`, { method: 'POST', body: { agentId } }),
  rateTask: (id, rating) => req(`/tasks/${id}/rate`, { method: 'POST', body: { rating } }),
  engine: () => req('/engine/overview'),
  airdropPending: () => req('/airdrop/pending'),
  airdropSent: (txHash, addresses) =>
    req('/airdrop/mark-sent', { method: 'POST', body: { txHash, addresses } }),
}
