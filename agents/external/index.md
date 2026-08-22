# external/ —— 开放市场演示执行体（外部商家扮演区）

## 这是什么

5 个扮演**外部商家**的 Agent 执行体（端口 9011~9015），刻意**不写进
`agents/manifest.js`：不自动接线、不进心跳表、平台不代签——演示
"商家只在页面上架 + 填自己的服务 URL"的开放市场形态。

演示口径：商家服务恰好部署在同一台演示机上（所以 URL 是
`http://127.0.0.1:90xx`）；生产环境里这就是商家自己的公网 URL，
平台探针（`GET /health`）从服务端发起，原理完全一致。

## 文件清单

| 文件 | 端口 | Agent 名（上架时填，一字不差） | 类别 |
|---|---|---|---|
| acrostic-agent.js | 9011 | 藏头诗人 | Writing |
| weekly-agent.js | 9012 | 周报匠 | Writing |
| translate-agent.js | 9013 | 双语商务译师 | Translation |
| sql-agent.js | 9014 | SQL 军师 | Data |
| naming-agent.js | 9015 | 起名大师 | Marketing |

用户操作手册见上级目录 **`agents/外部Agent演示清单.md`**。

## 设计要点（为什么这么拆）

- **复用 `../lib.js`**：`listen()`（HTTP 契约 + 心跳自报到）+ `llm()`（DeepSeek）。
  `announceLoop` 发现自己不在 manifest 会 warn 一次然后跳过——这正是外部商家该有的行为。
- **每个执行体都有本地降级 brain**：DeepSeek 挂了返回骨架结果（不编数据，
  诚实标注"降级产出"），演示不断电。
- **start-external.js 用硬编码 FLEET 数组**而非 manifest——这批"本来就不在清单里"，
  拉起方式与自营舰队（start-all.js 读 manifest）刻意形成对照。
- **cwd 必须是项目根**：`lib.js` 的 mini-dotenv 读根 `.env` 拿 `DEEPSEEK_API_KEY`。
  pm2 启动命令见下。

## 部署/运维（AWS 演示机）

```bash
# 上传（本地，项目根）
rsync -avz -e "ssh -p 443" --exclude '.env' agents/external/ \
  ec2-user@44.195.92.47:aladdin-agi/agents/external/

# 起进程（服务器，cwd=项目根，红线：不产生任何收费资源）
cd ~/aladdin-agi && pm2 start agents/external/start-external.js --name aladdin-external && pm2 save

# 验活
curl http://127.0.0.1:901{1..5}/health   # 服务器上五连
```

## 生产替换点

- URL `http://127.0.0.1:90xx` → 商家公网 HTTPS 域名（演示后换口径即可，代码零改）
- 平台探针 probeEndpoint 是裸 fetch——生产要加 SSRF 白名单/内网网段拒绝（代码里有注释标记）
- 商家鉴权：现在是"契约即门槛"（GET /health + POST /run）；生产加 API key 或 mTLS
