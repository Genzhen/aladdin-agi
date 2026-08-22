// ═══════════════════════════════════════════════════════════════════
//  db.js —— SQLite 初始化（本地等价替代生产 PostgreSQL，讲清替换点）
//  设计原则（PRD §3）：链上存关键事实，这里存长文本 + 高频读缓存。
//  better-sqlite3 是同步 API，写法简单；生产换 Postgres 时改异步即可。
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db = null;

/** 建全部表 + 手写迁移。独立导出：单测用内存库跑同一份 schema */
function initSchema(db) {

  // ── agents：Agent 档案（主记录来自链上 AgentRegistered 事件，长文本由 enrich 接口补）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id            INTEGER PRIMARY KEY,     -- 链上自增 id（真相源在链上）
      owner         TEXT NOT NULL,           -- 工程师地址（统一小写存）
      name          TEXT,
      category      TEXT,
      tags          TEXT,                    -- 逗号分隔，V0/V1 匹配的原料
      price_wei     TEXT,                    -- 金额用 TEXT 存（wei 超过 JS 安全整数）
      score         INTEGER DEFAULT 0,       -- 链上综合分 0~100（0.87 → 87）
      description   TEXT DEFAULT '',         -- 长介绍（链下）
      status        TEXT DEFAULT 'active',
      registered_at TEXT
    );
  `);

  // ── tasks：任务（资金/状态真相在链上，这里做冗余索引 + 搜索字段）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY,       -- 链上 taskId
      publisher   TEXT NOT NULL,
      agent_addr  TEXT,
      agent_id    INTEGER,
      price_wei   TEXT,
      fee_wei     TEXT,
      deposit_wei TEXT DEFAULT '0',
      deadline    INTEGER,
      state       TEXT,                      -- matching/running/review/settled/disputed/cancelled
      title       TEXT DEFAULT '',
      category    TEXT DEFAULT '',
      tags        TEXT DEFAULT '',
      description TEXT DEFAULT '',
      candidates  TEXT DEFAULT '[]',         -- 匹配结果 JSON（第 6 步 V0 写入）
      rating      INTEGER,                   -- 雇主验收星级 1~5（NULL=未评；仲裁单无星）
      created_at  TEXT
    );
  `);

  // ── task_drafts：雇主在前端填的任务草稿（先落库，链上质押后由 Relayer 合体）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_drafts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      publisher   TEXT NOT NULL,
      price_wei   TEXT NOT NULL,             -- 和链上事件对账的钥匙
      deadline    INTEGER,
      title       TEXT, category TEXT, tags TEXT, description TEXT,
      created_at  TEXT
    );
  `);

  // ── task_events：链上事件流水（审计 + 前端时间线）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER,
      name        TEXT,                      -- TaskPosted / AgentAccepted / ...
      block       INTEGER,
      args        TEXT,                      -- JSON 字符串
      created_at  TEXT
    );
  `);

  // ── match_runs：每次三层漏斗的完整报告（S5 漏斗图数据源；死信也记这里）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER,
      status      TEXT,                      -- done / dead
      detail      TEXT,                      -- JSON：v0/v1/v2 各层数量 + final
      created_at  TEXT
    );
  `);

  // ── impressions：曝光/点击流水（V2 在线学习的教材；一条 = 一次真实展示）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS impressions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER,
      agent_id    INTEGER,
      position    INTEGER,                   -- 展示位（1=首位，CTR 通常随位置衰减）
      clicked     INTEGER DEFAULT 0,         -- 0=只展示没点 1=点击（训练标签 y）
      created_at  TEXT,
      UNIQUE(task_id, agent_id)
    );
  `);

  // ── model_weights：V2 逻辑回归权重（在线学习后落库，重启不丢）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_weights (
      key         TEXT PRIMARY KEY,          -- 目前只有 'v2'
      weights     TEXT,                      -- JSON 数组，顺序同 FEATURES
      updated_at  TEXT
    );
  `);

  // ── task_results：Agent 执行体的交付物（接单后真实产出，链下本体）──
  // 链上 submit 只推动状态机，成果本体在这张表——"链存事实、链下存内容"的又一例
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_results (
      task_id     INTEGER PRIMARY KEY,        -- 一个任务一份交付物（重跑覆盖）
      agent_id    INTEGER,
      endpoint    TEXT,                       -- 哪个执行体干的（审计用）
      ok          INTEGER DEFAULT 0,          -- 1=成功（已触发上链 submit）
      output      TEXT DEFAULT '',            -- markdown 成果本体
      error       TEXT DEFAULT '',            -- 失败原因（ok=0 时工程师可手动补救）
      created_at  TEXT
    );
  `);

  // agents.endpoint：执行体地址（链下"店面装修"，不上链）。空串=纯挂牌无执行体
  try { db.exec("ALTER TABLE agents ADD COLUMN endpoint TEXT DEFAULT ''"); } catch { }

  // agents.auto_accept：自动接单开关（链下 enrich 可改）。开着=平台在"匹配完成
  // 45s 无人手动接"时替它代签 accept——对应真实市场的"司机听单"模式
  try { db.exec("ALTER TABLE agents ADD COLUMN auto_accept INTEGER DEFAULT 0"); } catch { }

  // ── airdrop_eligible：空投待发名单（第 11 步：上架10/发单5/完单20 MYT）──
  db.exec(`
    CREATE TABLE IF NOT EXISTS airdrop_eligible (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      addr        TEXT NOT NULL,             -- 收款地址（小写）
      amount_wei  TEXT NOT NULL,
      reason      TEXT,                      -- agent_listed / task_published / task_done
      ref_id      INTEGER,                   -- 对应 agent/task id（防重复发）
      sent_at     TEXT,                      -- 链上发放时间（销账标记）
      tx_hash     TEXT,
      UNIQUE(addr, reason, ref_id)
    );
  `);

  // SQLite 没有 ADD COLUMN IF NOT EXISTS——报错=已加过，吞掉即可（手写迁移）
  try { db.exec("ALTER TABLE airdrop_eligible ADD COLUMN sent_at TEXT"); } catch { }
  try { db.exec("ALTER TABLE airdrop_eligible ADD COLUMN tx_hash TEXT"); } catch { }
  // tasks.rating：雇主星级（新列，老库补加；建表语句里已有，新库走不到这行）
  try { db.exec("ALTER TABLE tasks ADD COLUMN rating INTEGER"); } catch { }
}

function getDb() {
  if (db) return db;

  db = new Database(path.join(DATA_DIR, "aladdin.db"));
  db.pragma("journal_mode = WAL"); // WAL 模式：读写不互斥，并发更顺
  initSchema(db);
  return db;
}

module.exports = { getDb, initSchema };
