const bitcoinRPC = require('./bitcoinRPC');
const logger = require('../utils/logger');
const config = require('../config');
const EventEmitter = require('events');

class AlkanesMonitor extends EventEmitter {
  constructor() {
    super();
    this.currentBlockHeight = 0;
    this.isRunning = false;
    this.mintEvents = [];
    this.intervalId = null;
  }

  /**
   * 启动监控服务
   */
  async start() {
    if (this.isRunning) {
      logger.warn('监控服务已在运行中');
      return;
    }

    logger.info('启动Alkanes监控服务');
    this.isRunning = true;

    try {
      // 获取起始区块高度
      if (config.alkanes.startBlockHeight === 'latest') {
        this.currentBlockHeight = await bitcoinRPC.getBlockCount();
        logger.info(`从最新区块开始监控: ${this.currentBlockHeight}`);
      } else {
        this.currentBlockHeight = parseInt(config.alkanes.startBlockHeight);
        logger.info(`从区块高度 ${this.currentBlockHeight} 开始监控`);
      }

      // 设置定时器定期扫描新区块
      this.intervalId = setInterval(() => this.scanNewBlocks(), config.alkanes.scanInterval);
      
      // 立即开始第一次扫描
      this.scanNewBlocks();
    } catch (error) {
      logger.error(`启动监控服务失败: ${error.message}`);
      this.isRunning = false;
    }
  }

  /**
   * 停止监控服务
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('监控服务未在运行');
      return;
    }

    logger.info('停止Alkanes监控服务');
    clearInterval(this.intervalId);
    this.isRunning = false;
  }

  /**
   * 扫描新区块
   */
  async scanNewBlocks() {
    try {
      const latestBlockHeight = await bitcoinRPC.getBlockCount();
      
      if (latestBlockHeight <= this.currentBlockHeight) {
        logger.debug('没有新区块产生');
        return;
      }

      logger.info(`发现新区块，当前高度: ${this.currentBlockHeight}, 最新高度: ${latestBlockHeight}`);

      // 扫描从currentBlockHeight到latestBlockHeight之间的所有区块
      for (let height = this.currentBlockHeight + 1; height <= latestBlockHeight; height++) {
        await this.processBlock(height);
        this.currentBlockHeight = height;
      }
    } catch (error) {
      logger.error(`扫描新区块失败: ${error.message}`);
    }
  }

  /**
   * 处理单个区块
   * @param {number} height - 区块高度
   */
  async processBlock(height) {
    try {
      const blockHash = await bitcoinRPC.getBlockHash(height);
      const block = await bitcoinRPC.getBlock(blockHash);
      
      logger.info(`处理区块 #${height}: ${blockHash} (${block.tx.length} 笔交易)`);

      // 处理区块中的所有交易
      for (const txid of block.tx) {
        await this.processTransaction(txid, height, block.time);
      }
    } catch (error) {
      logger.error(`处理区块 #${height} 失败: ${error.message}`);
    }
  }

  /**
   * 处理单个交易
   * @param {string} txid - 交易ID
   * @param {number} blockHeight - 区块高度
   * @param {number} blockTime - 区块时间
   */
  async processTransaction(txid, blockHeight, blockTime) {
    try {
      const tx = await bitcoinRPC.getRawTransaction(txid);
      
      // 检查是否有OP_RETURN输出
      const opReturnOutputs = tx.vout.filter(vout => 
        vout.scriptPubKey && 
        vout.scriptPubKey.type === 'nulldata'
      );

      if (opReturnOutputs.length === 0) {
        return;
      }

      // 分析OP_RETURN数据
      for (const output of opReturnOutputs) {
        this.analyzeOpReturn(output, tx, blockHeight, blockTime);
      }
    } catch (error) {
      logger.error(`处理交易 ${txid} 失败: ${error.message}`);
    }
  }

  /**
   * 分析OP_RETURN输出
   * @param {Object} output - 交易输出
   * @param {Object} tx - 完整交易数据
   * @param {number} blockHeight - 区块高度
   * @param {number} blockTime - 区块时间
   */
  analyzeOpReturn(output, tx, blockHeight, blockTime) {
    try {
      // 获取OP_RETURN数据
      const hex = output.scriptPubKey.hex;
      
      // 检查是否是Alkanes协议数据
      if (!this.isAlkanesProtocol(hex)) {
        return;
      }

      // 解码OP_RETURN数据
      const decodedData = this.decodeAlkanesData(hex);
      
      // 检查是否是铸造操作
      if (this.isMintOperation(decodedData)) {
        // 构建铸造事件数据
        const mintEvent = {
          txid: tx.txid,
          blockHeight,
          blockTime: new Date(blockTime * 1000).toISOString(),
          sender: tx.vin[0].address || 'unknown',
          data: decodedData,
          timestamp: Date.now()
        };

        // 存储和发出铸造事件
        this.mintEvents.push(mintEvent);
        this.emit('mint', mintEvent);
        
        logger.info(`发现Alkanes铸造操作: ${tx.txid} 在区块 #${blockHeight}`);
      }
    } catch (error) {
      logger.error(`分析OP_RETURN失败: ${error.message}`);
    }
  }

  /**
   * 检查是否是Alkanes协议数据
   * @param {string} hexData - 十六进制数据
   * @returns {boolean} - 是否是Alkanes协议
   */
  isAlkanesProtocol(hexData) {
    // 在这里实现Alkanes协议检测逻辑
    // 根据文档，可能需要检查特定的前缀或模式
    
    // 示例实现 - 检查是否包含"ALKANES"的ASCII编码
    const prefix = Buffer.from(config.alkanes.opReturnPrefix).toString('hex');
    return hexData.includes(prefix);
  }

  /**
   * 解码Alkanes协议数据
   * @param {string} hexData - 十六进制数据
   * @returns {Object} - 解码后的数据
   */
  decodeAlkanesData(hexData) {
    // 在这里实现Alkanes数据解码逻辑
    // 这需要根据Alkanes协议的具体格式来实现
    
    // 示例实现 - 将十六进制转为Buffer以便分析
    const buffer = Buffer.from(hexData, 'hex');
    
    // 移除OP_RETURN操作码部分，获取实际数据
    // 典型的OP_RETURN脚本格式: OP_RETURN <data>
    const dataBuffer = buffer.slice(2); // 假设前2个字节是OP_RETURN相关
    
    return {
      raw: hexData,
      data: dataBuffer.toString('hex')
    };
  }

  /**
   * 检查是否是铸造操作
   * @param {Object} decodedData - 解码后的数据
   * @returns {boolean} - 是否是铸造操作
   */
  isMintOperation(decodedData) {
    // 在这里实现铸造操作检测逻辑
    // 根据文档，mintSignature = 77 可能是铸造操作的标识
    
    // 示例实现 - 检查是否包含mintSignature
    const mintSignatureHex = config.alkanes.mintSignature.toString(16).padStart(2, '0');
    return decodedData.data.includes(mintSignatureHex);
  }

  /**
   * 获取所有铸造事件
   * @returns {Array} - 铸造事件列表
   */
  getMintEvents() {
    return this.mintEvents;
  }

  /**
   * 获取指定数量的最新铸造事件
   * @param {number} limit - 限制数量
   * @returns {Array} - 最新的铸造事件列表
   */
  getLatestMintEvents(limit = 10) {
    return this.mintEvents.slice(-limit);
  }
}

module.exports = new AlkanesMonitor(); 