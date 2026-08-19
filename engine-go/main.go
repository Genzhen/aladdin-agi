// ═══════════════════════════════════════════════════════════════════
//  main.go —— 阿拉丁AGI 分发引擎（Go 版，课堂作业第 9 步）
//
//  职责：消费 Redis 匹配队列 → 调后端跑三层漏斗 → 失败重试 3 次
//        → 仍失败进死信队列（queue:match:dead）并标记任务。
//  特点：零第三方依赖——连 Redis 客户端都手写 RESP 协议（和 server/queue.js
//        同一套协议两端各写一遍，吃透"队列到底是什么"）。
//
//  为什么用 Go 写引擎：分发是 CPU/并发密集型（高并发取任务、跑匹配、
//  限流打 API），goroutine + 静态编译单二进制是生产标配组合。
//  （教学版单 goroutine 消费；扩容 = 起多实例 + BRPOP 天然争抢不重复消费）
//
//  运行：REDIS_ADDR=127.0.0.1:6379 API_BASE=http://localhost:3001 go run .
// ═══════════════════════════════════════════════════════════════════
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

var (
	redisAddr = envOr("REDIS_ADDR", "127.0.0.1:6379")
	apiBase   = envOr("API_BASE", "http://localhost:3001")
	token     = envOr("INTERNAL_TOKEN", "dev-token")
	queue     = envOr("QUEUE", "queue:match")
	deadQueue = "queue:match:dead"
	maxRetry  = 3
)

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// ─────────────────────────────────────────────────────────────
//  手写 RESP 客户端（生产替换点：go-redis v9）
// ─────────────────────────────────────────────────────────────

type redisConn struct {
	c net.Conn
	r *bufio.Reader
}

func dialRedis() (*redisConn, error) {
	c, err := net.DialTimeout("tcp", redisAddr, 3*time.Second)
	if err != nil {
		return nil, err
	}
	return &redisConn{c: c, r: bufio.NewReader(c)}, nil
}

// encodeCommand：["BRPOP","key","5"] → *3\r\n$5\r\nBRPOP\r\n... （RESP 数组）
func encodeCommand(args []string) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "*%d\r\n", len(args))
	for _, a := range args {
		fmt.Fprintf(&b, "$%d\r\n%s\r\n", len(a), a)
	}
	return b.Bytes()
}

func (rc *redisConn) do(args ...string) (interface{}, error) {
	if _, err := rc.c.Write(encodeCommand(args)); err != nil {
		return nil, err
	}
	return readReply(rc.r)
}

func readLine(r *bufio.Reader) (string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return "", err
	}
	return line[:len(line)-2], nil // 削掉 \r\n
}

// readReply：递归解析 5 种回复类型 +OK / -ERR / :123 / $bulk / *array
func readReply(r *bufio.Reader) (interface{}, error) {
	line, err := readLine(r)
	if err != nil {
		return nil, err
	}
	switch line[0] {
	case '+':
		return line[1:], nil
	case '-':
		return nil, fmt.Errorf("redis error: %s", line[1:])
	case ':':
		n, _ := strconv.ParseInt(line[1:], 10, 64)
		return n, nil
	case '$':
		n, _ := strconv.Atoi(line[1:])
		if n == -1 {
			return nil, nil // 空值
		}
		buf := make([]byte, n+2) // 数据 + \r\n
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, err
		}
		return string(buf[:n]), nil
	case '*':
		n, _ := strconv.Atoi(line[1:])
		if n <= 0 {
			return nil, nil // 空数组 / 超时（BRPOP 到点返回 *-1）
		}
		arr := make([]interface{}, n)
		for i := 0; i < n; i++ {
			if arr[i], err = readReply(r); err != nil {
				return nil, err
			}
		}
		return arr, nil
	}
	return nil, fmt.Errorf("未知 RESP 类型: %q", line)
}

// ─────────────────────────────────────────────────────────────
//  业务：消费 → 匹配 → 重试 → 死信
// ─────────────────────────────────────────────────────────────

type job struct {
	TaskID int64   `json:"taskId"`
	TS     float64 `json:"ts"`
}

var client = &http.Client{Timeout: 15 * time.Second}

// callRunMatch：POST /api/internal/run-match；2xx 才算成功
func callRunMatch(taskID int64) error {
	body, _ := json.Marshal(map[string]int64{"taskId": taskID})
	req, _ := http.NewRequest("POST", apiBase+"/api/internal/run-match", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-token", token)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, b)
	}
	return nil
}

// markDead：重试耗尽 → 死信入列 + 通知后端记账
func markDead(rc *redisConn, j job, lastErr error) {
	if _, err := rc.do("LPUSH", deadQueue, mustJSON(j)); err != nil {
		fmt.Printf("💀 死信入列失败: %v\n", err)
	}
	body, _ := json.Marshal(map[string]interface{}{"taskId": j.TaskID, "reason": lastErr.Error()})
	req, _ := http.NewRequest("POST", apiBase+"/api/internal/mark-dead", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-token", token)
	if resp, err := client.Do(req); err == nil {
		resp.Body.Close()
	}
	fmt.Printf("💀 任务#%d 重试 %d 次仍失败 → 死信队列\n     最后错误: %v\n", j.TaskID, maxRetry, lastErr)
}

func mustJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// process：带退避重试（1s → 2s → 4s 的指数退避，打日志可观察）
func process(rc *redisConn, j job) {
	for attempt := 1; attempt <= maxRetry; attempt++ {
		if err := callRunMatch(j.TaskID); err == nil {
			fmt.Printf("✅ 任务#%d 匹配完成（第 %d 次尝试）\n", j.TaskID, attempt)
			return
		} else {
			fmt.Printf("⚠️ 任务#%d 第 %d 次失败: %v\n", j.TaskID, attempt, err)
			if attempt == maxRetry {
				markDead(rc, j, err)
				return
			}
			time.Sleep(time.Duration(1<<(attempt-1)) * time.Second)
		}
	}
}

func main() {
	fmt.Printf("🚀 阿拉丁分发引擎 | redis=%s api=%s queue=%s\n", redisAddr, apiBase, queue)

	rc, err := dialRedis()
	if err != nil {
		fmt.Printf("❌ 连不上 Redis: %v（先 brew services start redis）\n", err)
		os.Exit(1)
	}
	if _, err := rc.do("PING"); err != nil {
		fmt.Printf("❌ Redis PING 失败: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("👂 Redis PONG，开始消费队列（Ctrl+C 退出）")

	for {
		reply, err := rc.do("BRPOP", queue, "5")
		if err != nil { // 网络抖动 → 重连再试（队列里的任务不丢）
			fmt.Printf("🔁 连接断开: %v，3 秒后重连\n", err)
			rc.c.Close()
			time.Sleep(3 * time.Second)
			if rc, err = dialRedis(); err != nil {
				fmt.Printf("❌ 重连失败: %v\n", err)
				time.Sleep(3 * time.Second)
			}
			continue
		}
		arr, ok := reply.([]interface{})
		if !ok || len(arr) < 2 { // 超时（*-1）→ 安静地继续等
			continue
		}
		var j job
		if err := json.Unmarshal([]byte(arr[1].(string)), &j); err != nil {
			fmt.Printf("⚠️ 非法任务体，跳过: %v\n", err)
			continue
		}
		fmt.Printf("📦 取到任务#%d，开始分发\n", j.TaskID)
		process(rc, j)
	}
}
