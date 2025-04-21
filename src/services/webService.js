const express = require('express');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const alkanesMonitor = require('./alkanesMonitor');

class WebService {
  constructor(dieselMonitor, app, io) {
    this.app = app || express();
    this.io = io;
    this.port = config.server.port;
    this.dieselMonitor = dieselMonitor; // 接收作为参数传入的实例
    this.alkanesMonitor = alkanesMonitor;
    
    // 添加中间件，用于解析JSON请求体
    this.app.use(express.json());
    
    this.setupRoutes();
    // 只有当dieselMonitor实例存在且io存在时才设置SocketIO
    if (this.dieselMonitor && this.io) {
      this.setupSocketIO();
    }
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
        dieselStatus: this.dieselMonitor && this.dieselMonitor.isRunning ? 'running' : 'stopped'
      });
    });

    this.app.get('/api/mint-events', (req, res) => {
      const limit = parseInt(req.query.limit) || 10;
      res.json(alkanesMonitor.getLatestMintEvents(limit));
    });

    // 确保dieselMonitor存在才提供相关API
    if (this.dieselMonitor) {
      // DIESEL专用API
      this.app.get('/api/diesel/status', (req, res) => {
        const blockHeight = this.dieselMonitor.lastScannedHeight || 0;
        const running = this.dieselMonitor.isRunning;
        
        const recentTxs = this.dieselMonitor.getRecentMintTransactions(10);
        const formattedRecentTxs = recentTxs.map(tx => ({
          ...tx,
          feeRate: typeof tx.feeRate === 'number' ? tx.feeRate.toFixed(2) : '0.00'
        }));
        
        const pendingTxs = this.dieselMonitor.getPendingMintTransactions();
        const formattedPendingTxs = pendingTxs.map(tx => ({
          ...tx,
          feeRate: typeof tx.feeRate === 'number' ? tx.feeRate.toFixed(2) : '0.00'
        }));
        
        res.json({
          blockHeight,
          running,
          recentTransactions: formattedRecentTxs,
          pendingTransactions: formattedPendingTxs
        });
      });

      this.app.get('/api/diesel/highest-gas', (req, res) => {
        const highestData = this.dieselMonitor.getMempoolHighestGasRate();
        
        const highest = highestData ? {
          txid: highestData.txid,
          feeRate: typeof highestData.feeRate === 'number' ? highestData.feeRate.toFixed(2) : '0.00'
        } : { txid: null, feeRate: '0.00' };
        
        res.json(highest);
      });

      // 获取当前内存池中费率大于50 sat/vB且包含OP_RETURN输出的交易
      this.app.get('/api/diesel/high-gas-op-return', async (req, res) => {
        try {
          const transactions = await this.dieselMonitor.getHighGasOpReturnTransactions();
          
          // 格式化交易列表，只返回必要的信息
          const formattedTransactions = transactions.map(tx => ({
            txid: tx.txid,
            feeRate: typeof tx.feeRate === 'number' ? tx.feeRate.toFixed(2) : '0.00'
          }));
          
          res.json({
            count: formattedTransactions.length,
            transactions: formattedTransactions
          });
        } catch (error) {
          logger.error(`获取高费率OP_RETURN交易失败: ${error.message}`);
          res.status(500).json({
            success: false,
            message: '获取交易失败'
          });
        }
      });

      // 控制启动和停止
      this.app.post('/api/diesel/control', (req, res) => {
        const action = req.body?.action;
        
        if (action === 'start') {
          if (!this.dieselMonitor.isRunning) {
            this.dieselMonitor.start();
            logger.info('通过API启动DIESEL监控');
          }
          res.json({
            success: true,
            running: true,
            blockHeight: this.dieselMonitor.lastScannedHeight || 0
          });
        } else if (action === 'stop') {
          if (this.dieselMonitor.isRunning) {
            this.dieselMonitor.stop();
            logger.info('通过API停止DIESEL监控');
          }
          res.json({
            success: true,
            running: false,
            blockHeight: this.dieselMonitor.lastScannedHeight || 0
          });
        } else {
          res.status(400).json({
            success: false,
            message: '无效的操作'
          });
        }
      });
    }

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
    if (!this.dieselMonitor || !this.io) {
      logger.warn('设置SocketIO失败: dieselMonitor实例或io不存在');
      return;
    }

    const dieselNamespace = this.io.of('/diesel');
    
    dieselNamespace.on('connection', (socket) => {
      logger.info(`新客户端连接: ${socket.id}`);
      
      this.sendInitialStatus(socket);
      
      socket.on('disconnect', () => {
        logger.debug(`客户端断开连接: ${socket.id}`);
      });
    });

    // 确保dieselMonitor是一个有效的EventEmitter实例    
    if (this.dieselMonitor && typeof this.dieselMonitor.on === 'function') {
      // 监听区块扫描事件
      this.dieselMonitor.on('block-scanned', (data) => {
        dieselNamespace.emit('block-update', {
          blockHeight: data.height,
          blockHash: data.hash,
          mintTxCount: data.mintTxCount
        });
      });
      
      // 监听新铸造事件
      this.dieselMonitor.on('new-mint', (tx) => {
        const formattedTx = {
          ...tx,
          feeRate: typeof tx.feeRate === 'number' ? tx.feeRate.toFixed(2) : '0.00'
        };
        dieselNamespace.emit('new-mint', formattedTx);
      });
      
      // 监听内存池更新事件
      this.dieselMonitor.on('mempool-update', (data) => {
        const highestData = this.dieselMonitor.getMempoolHighestGasRate();
        
        const highest = highestData ? {
          txid: highestData.txid,
          feeRate: typeof highestData.feeRate === 'number' ? highestData.feeRate.toFixed(2) : '0.00'
        } : { txid: null, feeRate: '0.00' };
        
        dieselNamespace.emit('mempool-update', {
          count: data.count,
          highest
        });
      });

      // 监听DIESEL特定事件
      this.dieselMonitor.on('highest-gas-updated', (gasInfo) => {
        this.io.emit('diesel-highest-gas', gasInfo);
      });

      this.dieselMonitor.on('diesel-won', (transaction) => {
        this.io.emit('diesel-won', transaction);
      });
    }

    // 监听铸造事件，并通过WebSocket广播
    if (alkanesMonitor && typeof alkanesMonitor.on === 'function') {
      alkanesMonitor.on('mint', (mintEvent) => {
        this.io.emit('mint', mintEvent);
      });
    }
  }

  // 向新连接的客户端发送初始状态
  sendInitialStatus(socket) {
    try {
      if (!this.dieselMonitor) return;
      
      const blockHeight = this.dieselMonitor.lastScannedHeight || 0;
      const running = this.dieselMonitor.isRunning;
      
      // 获取最近的交易历史
      const recentTxs = this.dieselMonitor.getRecentMintTransactions(10);
      const formattedRecentTxs = recentTxs.map(tx => ({
        ...tx,
        feeRate: typeof tx.feeRate === 'number' ? tx.feeRate.toFixed(2) : '0.00'
      }));
      
      // 获取内存池中的DIESEL铸造交易
      const pendingTxs = this.dieselMonitor.getPendingMintTransactions();
      const formattedPendingTxs = pendingTxs.map(tx => ({
        ...tx,
        feeRate: typeof tx.feeRate === 'number' ? tx.feeRate.toFixed(2) : '0.00'
      }));
      
      // 获取最高费率交易
      const highestData = this.dieselMonitor.getMempoolHighestGasRate();
      const highest = highestData ? {
        txid: highestData.txid,
        feeRate: typeof highestData.feeRate === 'number' ? highestData.feeRate.toFixed(2) : '0.00'
      } : { txid: null, feeRate: '0.00' };
      
      // 发送初始状态
      socket.emit('init', {
        blockHeight,
        running,
        recentTransactions: formattedRecentTxs,
        pendingTransactions: formattedPendingTxs,
        highestGasRate: highest
      });
    } catch (error) {
      logger.error(`发送初始状态失败: ${error.message}`);
    }
  }

  /**
   * 启动Web服务
   * 方法保留用于向后兼容
   */
  start() {
    logger.info(`Web服务已初始化并启动`);
  }
}

// 导出类，而不是实例
module.exports = WebService; 