# matching/ —— 三层匹配漏斗（项目面试核心）

V0 → V1 → V2 逐层收窄（课堂话术：1,024 → 156 → 12 → 展示 3）。

| 文件 | 层 | 职责 | 核心算法（全部手写） | 生产替换点 |
|---|---|---|---|---|
| `v0.js` | 粗召回 | 宁多勿漏，tag/category 沾边就进漏斗；冷启动全量兜底；Fisher-Yates 洗牌保曝光公平 | 集合交集 + 洗牌 | 倒排索引 / 向量库 ANN |
| `v1.js` | 精排 | 文本相似度排序 | TF-IDF + 余弦相似度 | sentence-transformers + FAISS |
| `v2.js` | 重排 | 预估 CTR（点击率），取 Top3 | 逻辑回归 + SGD 在线学习 | FTRL / GBDT+LR / 特征平台 |
| `index.js` | 编排 | 串三层、写 candidates/impressions/match_runs、点击在线学习、死信记录 | — | — |

## 数据流

```
POST /api/tasks/:id/dispatch
  → v0.recall(任务, 全体Agent)        召回 + 冷启动判断
  → v1.rank(任务, 候选)               TF-IDF 余弦排序
  → v2.predict(权重, 特征)            pCTR 重排取 Top3
  → tasks.candidates / impressions / match_runs 落库
雇主点击某候选 POST /api/tasks/:id/click
  → impressions.clicked=1 + SGD 微调权重（model_weights 表持久化）
```

## 单测

```bash
cd server && node --test
```

为什么三层而不是一层：召回要**便宜**（全量跑不起模型）、精排要**准**（砍掉不相关）、
重排要**懂业务**（点击反馈闭环）。每一层解决上一层的遗留问题——面试就按这个讲。
