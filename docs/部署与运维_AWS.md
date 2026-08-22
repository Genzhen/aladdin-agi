# 部署与运维手册（AWS 免费额度 · 2026-08-19 上线）

> 公网入口：**https://aladdin.myanext.com**（Cloudflare 隧道 → EC2 :3001）
> 代码仓库：https://github.com/Genzhen/aladdin-agi
> 本文回答三件事：**线上是怎么搭的 / 以后怎么更新 / 坏了怎么查**。

## 一、架构（一台机器，两个项目，四条常驻进程）

```
浏览器 ──HTTPS──> Cloudflare 隧道 aladdin（41a144eb…）
                        │ outbound 443（无需开入站端口）
                        ▼
  EC2 gzuni-permanent（t3.micro，免费额度机型，与 Web3 大学项目合住）
  ├─ pm2: aladdin-server   Node 22 · Express :3001（API + Relayer + 静态托管 app/dist）
  ├─ pm2: aladdin-engine   Go 二进制（本地交叉编译 linux/amd64，服务器无 Go 工具链）
  ├─ pm2: aladdin-tunnel   cloudflared（独立隧道，与 gzuni 隧道互不干扰）
  ├─ pm2: gzuni            （大学项目，别动）
  └─ systemd: valkey       redis 的开源继任者，RESP 兼容，队列用
```

- 同源部署：前端 `fetch('/api/…')` 不跨域；SPA 深链由 server 兜底回 index.html
- 链是真相源：线上库（SQLite）只是索引——**实例全挂也不丢数据**，服务起来即补账
- 安全组 gzuni-sg 只开 22（3001 曾短暂开过，隧道通了即关）

## 二、怎么更新线上（改代码后的标准流程）

```bash
# 本地
git add -A && git commit -m "…" && git push
cd app && npm run build                      # 前端重新构建
cd ../engine-go && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o engine-go-linux .

# 推上去（注意：artifacts/ 别排除！server 运行时要读 ABI——坑#10）
# server/data 别同步：线上库有自己的链下状态（星级/评分/曝光），本地覆盖=丢数据；
#   以前没炸只是 rsync 按 mtime 跳过（本地恰好更旧）——运气不是机制
# .env 不同步：两边各自维护（内容目前一致，但别让本地覆盖成为隐式依赖）
rsync -az --exclude '.git' --exclude 'node_modules' --exclude 'cache' \
  --exclude 'server/data' --exclude '.env' \
  -e "ssh -i ~/.ssh/gzuni-key.pem" \
  ~/Desktop/Advance/doc/web3/task/aladdin-agi/ ec2-user@44.195.92.47:aladdin-agi/

# 服务器（SSH 上去）
ssh -i ~/.ssh/gzuni-key.pem ec2-user@44.195.92.47
pm2 restart aladdin-server aladdin-engine && pm2 logs aladdin-server --lines 20
```

改了 server 依赖时，rsync 后先 `cd ~/aladdin-agi/server && npm install --omit=dev` 再 restart。

## 三、坏了怎么查（排障顺序：由外向内）

```bash
curl -s https://aladdin.myanext.com/api/health     # ① 域名通不通？链连没连？
ssh … 'pm2 list'                                    # ② 四进程是否 online、有无重启循环
ssh … 'pm2 logs aladdin-server --lines 50 --nostream'
ssh … 'valkey-cli ping'                             # ③ 队列（应回 PONG）
ssh … 'curl -s localhost:3001/api/health'           # ④ 绕开隧道直测本机
```

- 域名不通但本机通 → 隧道挂了：`pm2 restart aladdin-tunnel`，再不行查 Cloudflare 后台
- server 重启循环 → 十有八九是缺文件/依赖（首上线就是 artifacts ENOENT，见下）
- 实例重启后 IP 会变：**不影响域名**（隧道自动重连），只影响 SSH 用旧 IP

## 四、上线日记（2026-08-19，教学素材）

| 时间线 | 事件 | 教训 |
|---|---|---|
| ① | GitHub push 走 HTTPS 报 HTTP2 framing（墙） | 本机 ssh 配置里 GitHub 走 443 通道，换 SSH remote 即通 |
| ② | rsync 照抄 .gitignore 排除了 `artifacts/`，server 线上 5 秒崩 10 连重启（ENOENT AgentRegistry.json） | **打包按"运行时要加载什么"想，不是按"git 不收什么"**（CLAUDE.md 坑#10） |
| ③ | PM2 的 cwd 在 server/，dotenv 找不到根目录 .env | `.env` 复制一份进 server/（或从仓库根启动） |
| ④ | redis 在 Amazon Linux 2023 没有，装的是 valkey | RESP 协议兼容，手写客户端零改动——**认协议不认实现** |
| ⑤ | 先开 3001 裸 IP 验证，隧道通了再关 | 两步走：先证明服务对，再证明入口对，问题好定位 |

## 五、免费额度账本（红线：只用送的，不开付费）

| 项目 | 状态 | 说明 |
|---|---|---|
| EC2 t3.micro | ✅ 免费 | 与大学项目共用一台；免费额度 750h/月 > 全月 744h |
| EBS 磁盘 | ✅ 免费 | 8G 用了 2.4G，30G 免费额度内 |
| Elastic IP | ✅ 未用 | 要收费——所以接受"重启 IP 会变" |
| NAT / RDS / CloudFront | ✅ 未用 | 全是收费项，一律不碰 |
| Cloudflare 隧道 + DNS | ✅ 免费 | Cloudflare 免费档，与 AWS 无关 |
| 公网 IPv4 | ⚠️ 唯一在烧赠送额度的项 | 实例本来就带公网 IP（gzuni 时代就有），非本项目新增；约 $3.6/月等值，从注册赠送额度扣 |

**关停一切的方法**（不想跑的时候）：AWS 控制台停止实例 = EC2/EBS 都停扣（EBS 仍有少量存储费）；
彻底清场 = 终止实例 + 删隧道（`cloudflared tunnel delete aladdin`）+ 删 GitHub 仓库可选。
