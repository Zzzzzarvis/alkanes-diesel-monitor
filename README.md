# Alkanes协议监控系统

这是一个用于监控Bitcoin主网上Alkanes协议铸造活动的实时监控系统。通过连接BTC全节点，系统能够识别、解析和展示全网所有的Alkanes协议铸造操作。

## 功能特点

- 实时监控Bitcoin区块链上的Alkanes协议交易
- 自动识别OP_RETURN中的Alkanes协议铸造操作
- 提供实时更新的Web界面
- 支持WebSocket实时推送铸造事件
- 提供铸造事件的详细信息查看

## 系统架构

- 后端：Node.js服务器，使用RPC与Bitcoin全节点通信
- 前端：基于Bootstrap的响应式Web界面
- 通信：使用Socket.IO实现服务器与客户端之间的实时通信

## 安装与启动

### 前提条件

- Node.js 14.0+
- 访问权限的Bitcoin全节点

### 安装步骤

1. 克隆项目代码:

```bash
git clone https://github.com/yourusername/alkanes-monitor.git
cd alkanes-monitor
```

2. 安装依赖:

```bash
npm install
```

3. 配置环境变量:

根据示例文件创建或修改`.env`文件，填入BTC节点连接信息:

```
BTC_RPC_URL=http://your-btc-node-ip:8332
BTC_RPC_USER=your-username
BTC_RPC_PASSWORD=your-password
PORT=3000
LOG_LEVEL=info
```

4. 启动服务:

```bash
npm start
```

启动后，在浏览器中访问 `http://localhost:3000` 查看监控界面。

## 配置说明

可以通过修改`src/config/index.js`文件调整系统配置，主要配置项包括：

- BTC节点连接信息：URL、用户名、密码
- 服务器端口
- 日志级别
- Alkanes协议相关配置：OP_RETURN前缀、扫描间隔、铸造标识等

## 使用说明

1. 启动服务后，系统将自动连接到配置的BTC节点
2. 监控界面显示当前区块高度和监控状态
3. 系统会持续扫描新区块，识别其中的Alkanes协议铸造操作
4. 铸造事件会实时显示在界面上，点击事件可查看详细信息
5. 通过界面上的"启动监控"和"停止监控"按钮控制监控状态

## API参考

系统提供以下API接口：

- `GET /api/status` - 获取系统状态
- `GET /api/mint-events` - 获取铸造事件列表

## 定制开发

如需添加更多功能或修改监控逻辑，可以参考以下文件：

- `src/services/alkanesMonitor.js` - Alkanes协议解析和监控逻辑
- `src/services/webService.js` - Web服务和WebSocket实现
- `public/index.html` - 前端界面实现

## 许可证

[MIT License](LICENSE) 