const logger = require('./utils/logger');
const alkanesMonitor = require('./services/alkanesMonitor');
const WebService = require('./services/webService');
const bitcoinRPC = require('./services/bitcoinRPC');
const DieselMonitor = require('./services/dieselMonitor');
const socketIo = require('socket.io');
const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  logger.error(`未捕获的异常: ${error.message}`);
  logger.error(error.stack);
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`未处理的Promise拒绝: ${reason}`);
});

// 创建logs目录
const fs = require('fs');

if (!fs.existsSync(path.join(__dirname, '../logs'))) {
  fs.mkdirSync(path.join(__dirname, '../logs'));
}

// 初始化全局服务
let dieselMonitor;
let webService;

// 启动应用
(async function main() {
  try {
    logger.info('启动Alkanes监控系统');
    
    // 初始化express应用
    const app = express();
    app.use(cors());
    app.use(express.static(path.join(__dirname, '../public')));
    
    // 设置基本路由
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
    app.get('/diesel', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/diesel.html'));
    });
    
    // 创建HTTP服务器
    const server = http.createServer(app);
    
    // 初始化Socket.IO
    const io = socketIo(server);
    
    // 初始化DieselMonitor
    dieselMonitor = new DieselMonitor(bitcoinRPC, io, config.alkanes.diesel);
    
    // 初始化并启动WebService
    webService = new WebService(dieselMonitor, app, io);
    webService.start();
    
    // 启动DieselMonitor
    await dieselMonitor.start();
    
    // 启动Alkanes监控
    await alkanesMonitor.start();
    
    // 启动HTTP服务器
    server.listen(config.server.port, () => {
      logger.info(`Alkanes监控系统已成功启动，监听端口 ${config.server.port}`);
    });
  } catch (error) {
    logger.error(`启动失败: ${error.message}`);
    process.exit(1);
  }
})(); 