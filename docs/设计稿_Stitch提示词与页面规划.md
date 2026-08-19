# 设计稿：页面规划与 Stitch 提示词（阿拉丁AGI）

> 第 1 步产出 · 2026-08-16
> 工具：Stitch（stitch.withgoogle.com，Google 的 UI 设计 AI，文字描述 → 生成界面设计稿，可导出 Figma / HTML 代码）
> 用法：一屏一个 prompt，先出 S1 定风格，其余屏保持同一风格；生成结果截图回报导师评审

---

## 1. 页面地图（功能 → 页面的映射）

```
Aladdin AGI
├── S1 Agent 市场首页     ← 作业①（浏览 Agent）
├── S2 Agent 详情页       ← 作业①（介绍/作者/评分⑤/API key 打码）
├── S3 发布任务页         ← 作业②（表单 + MetaMask 质押⑧）
├── S4 任务详情页         ← 作业③（3 个候选 Agent）+ ⑧（资金卡/验收/争议）
├── S5 匹配引擎看板 ★亮点 ← 作业③④（V0/V1/V2 三层匹配可视化，面试用）
├── S6 个人中心           ← 作业①（上架表单）+ ⑦（MYT 资产/空投）
└── S7 仲裁页（可选彩蛋） ← 作业⑥（陪审投票 + 质押 MYT）
```

优先级：**S1–S4 是 MVP 必须**，S5 是面试亮点页，S6 必须，S7 时间富余再做。

---

## 2. 全局设计系统（Design Tokens）

| 项目 | 值 | 说明 |
|---|---|---|
| 背景 | `#0A0F1E` 深蓝黑 | 深色 Web3 科技风 |
| 主色 | `#8B5CF6` 紫 | 按钮、高亮、渐变起点（AI 感）|
| 辅色 | `#22D3EE` 青 | 分数、次级高亮、渐变终点 |
| 成功 | `#34D399` 绿 | 完成、验收通过 |
| 危险 | `#F87171` 红 | 争议、死信、罚没 |
| 卡片 | 玻璃拟态 | 半透明白 4–6% 填充 + 8–10% 白描边 + 大圆角 |
| 字体 | Inter | 数字用等宽变体显示地址/金额 |
| 通用组件 | 按钮(主/次/危险)、badge、星级、stepper、`0x12…ab` 地址缩写组件 | 全站复用 |

**风格种子（每条 prompt 开头都带，保证 7 屏风格一致）：**

```
Dark futuristic Web3 style, deep navy background #0A0F1E, violet-purple primary
#8B5CF6, cyan accents #22D3EE, glassmorphism cards with subtle white borders,
rounded corners, Inter font, generous spacing, desktop web app.
```

---

## 3. 各屏模块清单 + Stitch 提示词

> 提示词用英文（设计 AI 英文理解更好），每屏前面的中文是模块讲解——你要能讲出每个模块为什么存在。

### S1 · Agent 市场首页（落地页 + 商品列表）

**模块**：顶部导航（含连接钱包、MYT 余额）/ Hero 区（一句话价值主张 + 双 CTA：发布任务 / 上架 Agent）/ 数据条（Agent 数、完成单数、质押总额——建立平台信任感）/ 分类筛选 tabs / Agent 卡片网格（每卡：头像名称、分类 badge、tags、一句话介绍、作者 + 缩略地址、星级 + 综合分、单价）。

```
Design a marketplace homepage for "Aladdin AGI", an AI Agent marketplace where
developers list AI agents and users post tasks. Dark futuristic Web3 style,
deep navy background #0A0F1E, violet-purple primary #8B5CF6, cyan accents
#22D3EE, glassmorphism cards with subtle white borders, rounded corners, Inter
font, desktop web app. Top navbar: logo "Aladdin AGI", links "Agents", "Tasks",
"Matching", a "Connect Wallet" button with MetaMask icon, and a small token
balance chip "MYT 1,240". Hero section: headline "Post a task. The right AI
Agent takes it.", subline "Stake funds in a smart contract, get matched with
verified AI agents", two buttons "Post a Task" (primary) and "List My Agent"
(secondary), plus a stats row: "128 Agents · 1,532 Tasks Done · 42 ETH Staked".
Below: category filter tabs (All, Writing, Video, Coding, Translation, Data).
Main content: 3-column grid of agent cards. Each card: agent avatar and name,
category badge with 2-3 small tags, one-line description, author name with
short wallet address "0x12…ab", star rating with numeric score 0.87, and price
"0.05 ETH / run".
```

### S2 · Agent 详情页（商品详情 + 评分 + API Key）

**模块**：面包屑 / 左栏——Agent 头部（头像/badge/tags/星级）、能力介绍长文、样例输出预览、历史成交表格；右栏——**定价卡**（购买按钮 → 购买后展示打码 API Key + 眼睛按钮 + 复制 + "一付费请求 ID 一 key"说明，对应作业①"清晰+打码"）、**评分卡**（五维条形图：完成强度/质量反馈/沟通体验/争议率/历史规模 + 综合大分 0.87，对应作业⑤）、**作者卡**（头像/介绍/钱包地址）。

```
Design an agent detail page for an AI Agent marketplace. Dark futuristic Web3
style, deep navy background #0A0F1E, violet-purple primary #8B5CF6, cyan
accents #22D3EE, glassmorphism cards, rounded corners, Inter font, desktop web
app. Breadcrumb "Agents / Writing / ScriptWriter Pro". Two-column layout. Left
column: agent header (avatar, name "ScriptWriter Pro", category badge, 3 tags,
star rating 4.8), a long description section "What this agent does", a "Sample
output" preview card, and a "Track record" table with columns Task, Price,
Result (Success / Failed badges), Rating. Right sidebar, stacked cards: (1)
pricing card: "0.05 ETH / run", primary button "Purchase & Get API Key", below
it a masked key row "myt-****-****-a3f8" with an eye toggle icon and copy
button, small note "One key per payment request ID"; (2) score card titled
"Agent Score 0.87": five horizontal metric bars labeled Completion, Quality,
Communication, Dispute Rate, Volume; (3) author card: avatar, name, short bio,
wallet address "0x5633…8F50".
```

### S3 · 发布任务页（表单 + 质押）

**模块**：三步 stepper（1 填写 → 2 质押 → 3 匹配，让用户对流程有预期）/ 左栏表单：标题、分类下拉、描述、tags、出价（ETH + USD 换算）、截止时间选择器、专家类型单选（初级/中级/高级，对应作业②"专家类型"）/ 右栏**订单摘要卡**：出价 + 手续费 0.1% + 应质押总额 + 大按钮「连接 MetaMask 并质押」+ 资金安全说明（锁在合约、验收后放款——对应作业②⑧）。

```
Design a "Post a Task" page for an AI Agent marketplace. Dark futuristic Web3
style, deep navy background #0A0F1E, violet-purple primary #8B5CF6, cyan
accents #22D3EE, glassmorphism cards, rounded corners, Inter font, desktop web
app. Page title "Post a Task" with a 3-step progress indicator: "1 Fill
Details → 2 Stake Funds → 3 Match Agents". Two-column layout. Left column, a
form card with: task title input, category dropdown, description textarea,
tags input showing tag chips, price input with ETH suffix and small USD
equivalent "≈ $320", deadline date-time picker, expert level radio group
(Junior / Senior / Expert). Right column, a sticky order summary card: "Price
0.1 ETH", "Platform fee (0.1%) 0.0001 ETH", "Total to stake 0.1001 ETH", a big
primary button "Connect MetaMask & Stake" with a small MetaMask fox icon, and
a security note with lock icon: "Funds are locked in the escrow contract and
released to the agent only after you approve the result."
```

### S4 · 任务详情页（状态机 + 候选 Agent + 资金卡）★核心页

**模块**：状态 badge + **横向 stepper（已发布→匹配中→执行中→待验收→已结算）**——这就是合约状态机的可视化 + 倒计时 / 信息卡（分类/tags/描述/出价/期限/专家类型/发布者地址）/ **候选 Agent 区**：3 张卡片（"从 12 个合格 Agent 中洗牌选出"的说明文案 + 每卡 tag 命中数、V1 余弦相似度条、V2 CTR 分、新 Agent 🎲 冷启动 badge、选择按钮——对应作业③）/ **资金托管卡**：质押金额、Agent 保证金 6%、[确认验收放款] + [发起争议]（对应作业⑧⑥）。

```
Design a task detail page for an AI Agent marketplace. Dark futuristic Web3
style, deep navy background #0A0F1E, violet-purple primary #8B5CF6, cyan
accents #22D3EE, glassmorphism cards, rounded corners, Inter font, desktop web
app. Top: task title "Write a 3-episode short drama script" with a purple
status badge "Matching" and a horizontal stepper: Posted → Matching → Running
→ Review → Settled (current step highlighted), plus a countdown chip
"2d 14h left". Info card: category badge + tags, task description, and a grid
of meta items: Price "0.1 ETH", Deadline, Expert level "Expert", Publisher
"0x12…ab". Highlight section "Matched Candidates — shuffled from 12 eligible
agents": a row of 3 candidate agent cards, each with avatar + name, tag match
count "5/6 tags", a cyan similarity bar labeled "cos 0.87", a CTR score, one
card carrying a dice icon badge "New agent · cold start", and a "Choose to
Run" button. Bottom: an escrow card showing "Staked 0.1 ETH" and "Agent
deposit (6%) 0.006 ETH", with buttons "Approve & Release Funds" (primary) and
"Open Dispute" (red outline).
```

### S5 · 匹配引擎看板 ★面试亮点页

**模块**：任务选择器 + Run Match 按钮 / **三列流水线**：V0·Tag 硬筛（Agent 列表 + tag 命中，不合格的置灰标红"死信"）→ V1·向量检索（按余弦相似度排序 + 分数条）→ V2·CTR 排序（最终排名 + CTR 分 + 新 Agent 冷启动标识 + Top3 高亮）/ 列间箭头表示数据流。**这页就是把作业③④的三层算法画成图，面试时投影讲算法就靠它。**

```
Design an analytics-style "Matching Engine" dashboard for an AI Agent
marketplace, visualizing how a task is matched to AI agents in 3 stages. Dark
futuristic Web3 style, deep navy background #0A0F1E, violet-purple primary
#8B5CF6, cyan accents #22D3EE, glassmorphism cards, rounded corners, Inter
font, desktop web app. Top bar: task selector dropdown "Task: Short drama
script" and a primary button "Run Match". Below, three columns connected by
arrows, forming a pipeline: Column 1 header "V0 · Tag Filter" with a list of
agents each showing tag match chips, and greyed-out rows tagged with a red
"dead letter" label. Column 2 header "V1 · Vector Search" with a ranked agent
list, each row showing a cyan cosine similarity progress bar (0.92, 0.87,
0.81...). Column 3 header "V2 · CTR Rank" with the final ranked list showing
CTR scores, one row with a dice icon badge "new agent · cold start", and the
top 3 rows highlighted with violet borders. Each agent row: small avatar,
name, score.
```

### S6 · 个人中心（我的 Agent / 任务 / 资产）

**模块**：头部卡（头像 + 钱包地址 + 复制 + MYT 余额卡 + 领空投按钮 + 保证金总览，对应作业⑦）/ Tab「我的 Agent」：上架的 Agent 卡片（状态：在售/审核中）+ "上架新 Agent"按钮（表单：名称/分类/tags/定价/介绍/钱包地址——对应作业①上架表单）/ Tab「我发布的任务」：表格（任务/价格/状态 badge：已质押/匹配中/执行中/待验收/已完成/争议中/任务详情页同款状态机）/ Tab「我接的单」/ Tab「资产」：空投记录 + 保证金收支流水。

```
Design a user profile page for an AI Agent marketplace. Dark futuristic Web3
style, deep navy background #0A0F1E, violet-purple primary #8B5CF6, cyan
accents #22D3EE, glassmorphism cards, rounded corners, Inter font, desktop web
app. Header card: avatar, wallet address "0x5633…8F50" with a copy icon, an
"MYT 1,240" balance chip with a "Claim Airdrop" button, and a small "Total
deposits 0.32 ETH" summary. Tab bar: "My Agents", "Posted Tasks", "Taken
Jobs", "Assets". My Agents tab: a grid of the user's listed agent cards with
status badges (Active / Under Review) and a dashed "List a New Agent" card.
Posted Tasks tab: a table with columns Task, Price, Status (colored badges:
Staked, Matching, Running, Review, Done, Dispute), Deadline. Assets tab: a
table of airdrop and deposit/withdraw records with type, amount, date.
```

### S7 · 仲裁页（可选彩蛋）

**模块**：左栏——进行中的争议案件列表卡（任务名/争议金额/已有票数/截止时间）/ 右栏——选中案件详情：任务描述、Agent 交付物预览、雇主申诉、证据附件、**投票面板**（裁给雇主 / 裁给 Agent / 弃权）+ 陪审规则说明（"陪审需质押 100 MYT；诚实投票得奖励，作恶被罚没"——slash 博弈，对应作业⑥）。

```
Design an arbitration page for an AI Agent marketplace. Dark futuristic Web3
style, deep navy background #0A0F1E, violet-purple primary #8B5CF6, cyan
accents #22D3EE, glassmorphism cards, rounded corners, Inter font, desktop web
app. Left column: a list of open dispute case cards, each with task title,
disputed amount "0.1 ETH", vote progress "4/7 votes", and a countdown chip.
Right column: the selected case detail — task description card, agent
deliverable preview, employer complaint card, evidence attachments, and a
voting panel with three buttons "Rule for Employer" (primary), "Rule for
Agent" (cyan outline), "Abstain" (ghost), plus a note: "Jurors stake 100 MYT.
Honest votes earn rewards; dishonest votes are slashed."
```

---

## 4. Stitch 操作流程

1. 打开 stitch.withgoogle.com，新建项目（Standard 模式即可）
2. **先贴 S1 的 prompt** 生成 → 这屏定全站风格基调
3. 不满意用聊天继续改（如 "make the cards more compact"、"more cyan accents"），满意为止
4. 依次生成 S2–S7（每条 prompt 已含风格种子，保持一致；也可用它的 theme 锁定）
5. 每屏 **截图回报导师**，评审通过即设计稿定稿
6. Stitch 可导出 HTML/Tailwind 代码或 Figma——**只当布局参考**，正式前端我们用 React + Vite + TW 自己实现（课堂红线：代码必须过我们自己的手和规范）

---

## 5. 评审通过后的下一步

- 导师基于定稿设计写 `docs/PRD.md`（页面清单、字段表、状态机、接口约定）
- 进第 2 步：MyToken（MYT）合约

---

## 6. 设计稿还原记录（2026-08-19，补做）

用户在 Stitch 建了项目 **"Aladdin AGI Marketplace"**（projects/2166390937381839520）生成七屏设计图。
导师通过 Stitch MCP（user scope 配置，需 Clash 代理）读取全部七屏的截图与生成的 HTML，
逐屏比对照相还原，差距清单与处理如下：

| 屏 | 设计稿要求 | 还原处理 |
|---|---|---|
| S1 市场 | Hero 大标语+双CTA、平台数据条（Agents/Tasks Done/ETH Staked）、渐变头像卡片+★分 | ✅ 全部补齐；数据条**实时取数**（/api/engine/overview + /api/tasks 聚合），不是写死的 |
| S2 详情 | 面包屑、Track Record 四列表、右侧价格卡+数据三卡 | ✅ 补齐；数据三卡（Score/Completion/Quality）由真实历史算出 |
| S3 发布 | 三步 stepper、右侧 Order Summary（价+0.1%费+合计） | ✅ 补齐；质押按钮移入摘要卡（sticky） |
| S4 任务 | 状态徽章+倒计时、信息条（截止/托管明细/tags）、候选副标题 | ✅ 补齐（状态 stepper/候选/时间线原本就有） |
| S5 引擎 | 漏斗每层进出数、任务切换、Final 显示 sim+pCTR | ✅ 补齐；历史行可点选切换可视化哪次 run |
| S6 我的 | 头部钱包卡（地址/MYT/托管）、Juror 战绩卡 | ✅ 补齐；没有真实数据的指标诚实标"待经济模型"，不编数 |
| S7 仲裁 | 案件头、争议概述、资金明细、证据、三选一 | ✅ 补齐；设计的"投票百分比"我们没有多陪审员——换成**按合约费率真算的资金明细**；证据=链上事件时间线（MVP 无文件上传） |

**还原原则**（面试可讲）：布局/配色/信息架构照设计稿 1:1；文案本地化为中文；
一切数字要么真实取数、要么明确标"待"——**绝不为了像设计稿而编造数据**。
（对照中顺手修掉：删 Vite 模板残留 App.jsx/App.css/assets；S3 分类下拉补齐 Translation/Audio。）

设计图与 Stitch 生成的 HTML 备份：`/tmp/stitch-designs/`（重启会丢，源在 Stitch 项目里随时可再拉）。
