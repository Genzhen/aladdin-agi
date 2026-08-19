// ═══════════════════════════════════════════════════════════════════
//  queue.js —— 手写 RESP 协议的 Redis 生产者（零依赖，教学版 BullMQ）
//
//  为什么要手写：Redis 的通信协议 RESP 只有一页纸（文本 + \r\n），
//  自己写一遍 encode/decode，比引一个 ioredis 更明白"队列到底是什么"。
//
//  协议速览（RESP2 数组请求）：
//    客户端发命令 = 数组，每个参数都是"长度前缀字符串"：
//      *2\r\n$5\r\nLPUSH\r\n$4\r\nname\r\n
//    服务端回 5 种类型：+简单串  -错误  :整数  $长度+数据  *数组
//
//  队列语义：LPUSH 进 list 头 + BRPOP 从 list 尾阻塞取 = 天然 FIFO。
//  生产替换点：BullMQ（带 ack/延迟/优先级）、SQS（托管）。
// ═══════════════════════════════════════════════════════════════════
const net = require("net");

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

/** 编码一条命令：["LPUSH", key, val] → RESP 数组字节串 */
function encode(args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const s = String(a);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return out;
}

/**
 * 解析器（流式）：TCP 是字节流，一次 data 事件可能是半条回复、也可能一条半。
 * 所以要"先窥视、够了再消费"——没到齐绝不动缓冲区，等下一个 chunk 拼上再解析。
 * 这是手写协议客户端的核心细节（引 ioredis 就感觉不到这一层了）。
 */
class RespReader {
  constructor() { this.buf = Buffer.alloc(0); }
  push(chunk) { this.buf = Buffer.concat([this.buf, chunk]); }

  /** 尝试解析一个完整返回值；不完整返回 null（缓冲区原样保留） */
  read() {
    const i = this.buf.indexOf("\r\n");
    if (i === -1) return null;                      // 连类型行都没到齐
    const type = this.buf[0];                       // 行首字节 = 类型
    const payload = this.buf.slice(1, i).toString();
    const lineLen = i + 2;                          // 行 + \r\n 的总长

    if (type === 0x2b || type === 0x2d) {           // +OK / -ERR
      this.buf = this.buf.slice(lineLen);
      return payload;
    }
    if (type === 0x3a) {                            // :123 整数
      this.buf = this.buf.slice(lineLen);
      return Number(payload);
    }
    if (type === 0x24) {                            // $len\r\ndata\r\n
      const len = Number(payload);
      if (len === -1) { this.buf = this.buf.slice(lineLen); return null; } // 空值
      if (this.buf.length < lineLen + len + 2) return null;                // 数据没到齐
      const data = this.buf.slice(lineLen, lineLen + len).toString();
      this.buf = this.buf.slice(lineLen + len + 2);
      return data;
    }
    throw new Error(`RESP 类型未实现: ${this.buf.slice(0, i).toString()}`);
  }
}

/** 发一条命令并等回复（单连接串行复用；教学版不做连接池） */
function command(...args) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(REDIS_PORT, REDIS_HOST);
    const reader = new RespReader();
    let done = false;
    const finish = (fn) => { if (!done) { done = true; fn(); sock.destroy(); } };

    sock.on("connect", () => sock.write(encode(args)));
    sock.on("data", (chunk) => {
      reader.push(chunk);
      try {
        const r = reader.read();
        if (r !== null && r !== undefined) finish(() => resolve(r));
      } catch (e) { finish(() => reject(e)); }
    });
    sock.on("error", (e) => finish(() => reject(e)));
    sock.setTimeout(3000, () => finish(() => reject(new Error("redis 超时"))));
  });
}

// ── 业务封装 ──
const QUEUE = "queue:match";
const DEAD = "queue:match:dead";

const ping = () => command("PING");
/** 入队一个匹配任务；返回 list 长度 */
const enqueue = (taskId) => command("LPUSH", QUEUE, JSON.stringify({ taskId, ts: Date.now() }));
const queueDepth = () => command("LLEN", QUEUE);

module.exports = { ping, enqueue, queueDepth, QUEUE, DEAD };
