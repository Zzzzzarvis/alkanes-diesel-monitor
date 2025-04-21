const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const alkanesMonitor = require('./alkanesMonitor');
const dieselMonitor = require('./dieselMonitor');

class WebService {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server);
    this.port = config.server.port;
    this.setupRoutes();
    this.setupSocketIO();
  }

  /**
   * 设置Express路由
   */
  setupRoutes() {
    // 静态文件服务
    this.app.use(express.static(path.join(__dirname, '../../public')));

    // API路由
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: alkanesMonitor.isRunning ? 'running' : 'stopped',
        currentBlockHeight: alkanesMonitor.currentBlockHeight,
        mintEventsCount: alkanesMonitor.mintEvents.length,
        dieselStatus: dieselMonitor.isRunning ? 'running' : 'stopped'
      });
    });

    this.app.get('/api/mint-events', (req, res) => {
      const limit = parseInt(req.query.limit) || 10;
      res.json(alkanesMonitor.getLatestMintEvents(limit));
    });

    // DIESEL专用API
    this.app.get('/api/diesel/status', (req, res) => {
      res.json({
        status: dieselMonitor.isRunning ? 'running' : 'stopped',
        currentBlockHeight: dieselMonitor.currentBlockHeight,
        highestGasRate: dieselMonitor.getHighestGasRate(),
        mempoolHighestGas: dieselMonitor.getMempoolHighestGasRate(),
        pendingTransactionsCount: dieselMonitor.getPendingMintTransactions().length
      });
    });

    this.app.get('/api/diesel/mint-events', (req, res) => {
      const limit = parseInt(req.query.limit) || 10;
      res.json(dieselMonitor.getRecentMintTransactions(limit));
    });

    this.app.get('/api/diesel/mempool', (req, res) => {
      res.json({
        transactions: dieselMonitor.getPendingMintTransactions(),
        highestGas: dieselMonitor.getMempoolHighestGasRate()
      });
    });

    // 主页路由
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });

    // DIESEL监控页面
    this.app.get('/diesel', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/diesel.html'));
    });
  }

  /**
   * 设置Socket.IO
   */
  setupSocketIO() {
    this.io.on('connection', (socket) => {
      logger.info(`新客户端连接: ${socket.id}`);

      // 当新客户端连接时，发送最新数据
      socket.emit('init', {
        status: alkanesMonitor.isRunning ? 'running' : 'stopped',
        currentBlockHeight: alkanesMonitor.currentBlockHeight,
        mintEvents: alkanesMonitor.getLatestMintEvents(50),
        dieselStatus: dieselMonitor.isRunning ? 'running' : 'stopped',
        dieselHighestGas: dieselMonitor.getHighestGasRate(),
        dieselMempoolHighestGas: dieselMonitor.getMempoolHighestGasRate()
      });

      // 监听控制命令
      socket.on('control', (command) => {
        if (command === 'start') {
          alkanesMonitor.start();
        } else if (command === 'stop') {
          alkanesMonitor.stop();
        } else if (command === 'start-diesel') {
          dieselMonitor.start();
        } else if (command === 'stop-diesel') {
          dieselMonitor.stop();
        }
        
        // 发送状态更新
        this.io.emit('status', {
          status: alkanesMonitor.isRunning ? 'running' : 'stopped',
          currentBlockHeight: alkanesMonitor.currentBlockHeight,
          dieselStatus: dieselMonitor.isRunning ? 'running' : 'stopped'
        });
      });

      // 监听断开连接
      socket.on('disconnect', () => {
        logger.info(`客户端断开连接: ${socket.id}`);
      });
    });

    // 监听铸造事件，并通过WebSocket广播
    alkanesMonitor.on('mint', (mintEvent) => {
      this.io.emit('mint', mintEvent);
    });

    // 监听DIESEL特定事件
    dieselMonitor.on('new-mint', (mintEvent) => {
      this.io.emit('diesel-mint', mintEvent);
    });

    dieselMonitor.on('highest-gas-updated', (gasInfo) => {
      this.io.emit('diesel-highest-gas', gasInfo);
    });

    dieselMonitor.on('diesel-won', (transaction) => {
      this.io.emit('diesel-won', transaction);
    });

    dieselMonitor.on('mempool-update', (mempoolInfo) => {
      this.io.emit('diesel-mempool', mempoolInfo);
    });
  }

  /**
   * 启动Web服务
   */
  start() {
    this.server.listen(this.port, () => {
      logger.info(`Web服务已启动，监听端口: ${this.port}`);
    });
  }
}

module.exports = new WebService(); 