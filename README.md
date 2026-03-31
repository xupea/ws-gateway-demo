# ws-gateway demo

用于本地调试 `ws-gateway` 的 Next.js 客户端，提供一个可视化 WebSocket 调试面板。

## 功能

- 连接到 `ws-gateway` 的 `/ws`
- 自动发送 `connection_init`
- 支持手动发送 JSON 消息
- 支持订阅 / 取消订阅 topic
- 支持手动 `ping`
- 断线自动重连
- 重连成功后自动恢复已有订阅
- 每 30 秒自动发送一次心跳 `ping`

## 本地启动

先启动网关服务：

```bash
cd /Users/xupea/Dev/ws-gateway
npm run dev
```

再启动 demo：

```bash
cd /Users/xupea/Dev/ws-gateway/demo
npm install
npm run dev
```

默认打开：

- Demo: [http://localhost:3001](http://localhost:3001)
- Gateway: `ws://localhost:3000/ws`

## 使用说明

页面打开后可以直接：

1. 填写 WebSocket 地址，并根据是否登录选择 `authToken` 或 `lockdownToken`
2. 点击 `Connect`
3. 等待服务端返回 `connection_ack`
4. 选择 topic 并点击 `Subscribe`
5. 通过 Redis 发布消息，观察面板日志

## 连接行为

当前 demo 默认模拟生产环境中的基础连接策略：

- 建连成功后自动发送 `connection_init`
- 勾选 `Logged In` 时发送 `payload.accessToken`
- 未勾选 `Logged In` 时发送 `payload.lockdownToken`
- 收到 `connection_ack` 后，连接进入可用状态
- 每 30 秒自动发送一次 `ping`
- 如果连接断开，会自动重连
- 重连成功后会自动恢复之前已创建的订阅

这更接近 Cloudflare + ALB 场景下的真实客户端行为。

## 调试入口消息

可以在本地用 `redis-cli` 向网关入口 channel 发布消息：

```bash
redis-cli PUBLISH ws:push '{"type":"broadcast","event":"announcement","data":{"text":"hello"}}'
```

用户消息示例：

```bash
redis-cli PUBLISH ws:push '{"type":"user","userId":"your-user-id","event":"balance_update","data":{"balance":999}}'
```

topic 消息示例：

```bash
redis-cli PUBLISH ws:push '{"type":"topic","topic":"ws.available-balances","data":{"amount":100,"currency":"USD"}}'
```

## 支持的 topic

- `ws.available-balances`
- `ws.vault-balances`
- `ws.highroller-house-bets`
- `ws.announcements`
- `ws.race-status`
- `ws.feature-flag`
- `ws.notifications`
- `ws.house-bets`
- `ws.deposit-bonus-transaction`

## 构建

```bash
npm run build
```
