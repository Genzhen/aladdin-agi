# engine-go/ —— Go 分发引擎（第 9 步）

消费 Redis 匹配队列的分发器：`BRPOP queue:match` → 调后端跑三层漏斗 →
失败指数退避重试 3 次 → 仍失败进死信队列 `queue:match:dead`。

## 为什么这么设计

| 决策 | 理由 |
|---|---|
| 队列放任务 ID 不放任务数据 | 链/库是真相源，队列只是"待办提醒"；消息丢了可以从库里重放 |
| 零第三方依赖（连 Redis 客户端都手写 RESP） | 和 server/queue.js 两端各写一遍协议，吃透队列本质；生产换 go-redis |
| 指数退避重试（1s→2s→4s） | 下游抖动别用重试风暴打死它 |
| 死信队列 + mark-dead 记账 | 失败任务不消失，可人工排查/重放（`redis-cli rpop queue:match:dead` 拿出来修完再 lpush 回主队列） |
| BRPOP 而不是轮询 LLEN | 阻塞等待，空闲时零 CPU；多实例同时 BRPOP 天然争抢、不重复消费 |

## 全链路（真实跑通于 2026-08-18）

```
钱包 escrow.postTask 质押（Sepolia 真实交易）
  → Relayer 听到 TaskPosted → 合体草稿 → LPUSH queue:match
  → Go 引擎 BRPOP → POST /api/internal/run-match（token 鉴权）
  → 三层漏斗 V0→V1→V2 → candidates/impressions 落库
  → 失败×3 → queue:match:dead + match_runs 记 dead
```

## 运行

```bash
brew services start redis          # Redis（本机 6379；配置里 4 行失效的 loadmodule 已注释）
go run .                           # 引擎前台跑（看日志）
REDIS_ADDR=... API_BASE=... go run .   # 可配置
```

已验证：任务#3 全自动匹配 ✅；伪任务#999 重试 3 次进死信 ✅。

生产替换点：go-redis 连接池、多 goroutine 消费、Kubernetes 部署、
Prometheus 指标、死信告警（SNS/钉钉）。
