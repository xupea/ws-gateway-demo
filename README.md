# ws-gateway demo

用于本地调试 `ws-gateway` 的 Next.js 客户端，提供一个可视化 WebSocket 调试面板。

这个 demo 已经对齐当前最终架构：

- 只有 `user` 和 `topic`
- 没有默认 `broadcast`
- 客户端必须显式订阅想接收的 topic
- 断线会自动重连，已记录的订阅会自动恢复

## 功能

- 连接到 `ws-gateway` 的 `/ws`
- 自动发送 `connection_init`
- 支持 `accessToken` / `lockdownToken` 两种初始化方式
- 支持 topic 订阅 / 取消订阅
- 支持自动订阅基础 topic
- 支持手动发送原始协议消息
- 支持手动 `ping`
- 断线自动重连
- 重连成功后自动恢复已有订阅
- 每 30 秒自动发送一次心跳 `ping`

## 本地启动

先启动网关服务：

```bash
cd /Users/xupea/Dev/projects/ws-gateway
docker compose up redis -d
npm run dev
```

再启动 demo：

```bash
cd /Users/xupea/Dev/projects/ws-gateway/demo
npm install
npm run dev
```

默认打开：

- Demo: [http://localhost:3001](http://localhost:3001)
- Gateway: `ws://localhost:3000/ws`

## 使用说明

### 1. 建立连接

1. 填写 WebSocket 地址
2. 选择是否 `Logged In`
3. 已登录时填写 `authToken`，游客时填写 `lockdownToken`
4. 点击 `Connect`
5. 等待服务端返回 `connection_ack`

### 2. 订阅 topic

连接成功后可以：

- 手动选择 topic 并点击 `Subscribe`


### 3. 手动协议调试

“Manual protocol message” 输入框可以直接发送原始客户端消息，例如：

```json
{"type":"ping"}
```

```json
{"id":"sub-1","type":"subscribe","payload":"ws.notifications"}
```

## 当前架构对应的消息路径

### user 消息

Java 侧先查 `userId -> nodeId`，再精准发到对应 route channel：

```bash
redis-cli GET ws:user_node:user-1
# 假设返回 node-1
redis-cli PUBLISH ws:route:node-1 '{"type":"user","userId":"user-1","event":"balance_update","data":{"balance":999}}'
```

### topic 消息

Java 侧直接发到 topic channel，所有节点都会收到，但只有本机订阅者会真正收到推送：

```bash
redis-cli PUBLISH ws:push:topic:ws.available-balances '{"type":"topic","topic":"ws.available-balances","data":{"amount":100,"currency":"USD"}}'
```

公共 topic 例子：

```bash
redis-cli PUBLISH ws:push:topic:ws.announcements '{"type":"topic","topic":"ws.announcements","data":{"message":"maintenance in 10 minutes"}}'
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

## 说明

- demo 会阻止对同一个 topic 的重复订阅，避免日志过乱
- 日志面板展示的是原始协议消息，适合排查协议和路由问题
- 这是调试工具，不承担业务态恢复或消息补偿能力

## 构建

```bash
npm run build
```
