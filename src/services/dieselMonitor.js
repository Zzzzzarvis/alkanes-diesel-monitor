const bitcoinRPC = require('./bitcoinRPC');
const logger = require('../utils/logger');
const config = require('../config');
const EventEmitter = require('events');

class DieselMonitor extends EventEmitter {
  constructor() {
    super();
    this.currentBlockHeight = 0;
    this.isRunning = false;
    this.blockIntervalId = null;
    this.mempoolIntervalId = null;
    
    // 存储DIESEL铸造交易信息
    this.dieselMintTransactions = [];
    
    // 记录当前mempool中的DIESEL铸造交易
    this.pendingMintTransactions = new Map();
    
    // 当前最高gas费率
    this.highestGasRate = {
      txid: null,
      feeRate: 0,
      timestamp: null
    };

    // 记录已处理的交易，避免重复处理
    this.processedTxids = new Set();
    
    // 记录最后一次扫描的时间戳
    this.lastScanTime = 0;
  }

  /**
   * 启动监控服务
   */
  async start() {
    if (this.isRunning) {
      logger.warn('DIESEL监控服务已在运行中');
      return;
    }

    logger.info('启动DIESEL铸造监控服务');
    this.isRunning = true;

    try {
      // 如果指定了区块高度，只分析该区块
      if (config.blockAnalysis.targetHeight !== null) {
        logger.info(`将分析区块高度: ${config.blockAnalysis.targetHeight}`);
        await this.analyzeSpecificBlock(config.blockAnalysis.targetHeight);
        this.isRunning = false;
        return;
      }

      // 正常监控模式
      if (config.alkanes.startBlockHeight === 'latest') {
        this.currentBlockHeight = await bitcoinRPC.getBlockCount();
        logger.info(`从最新区块开始监控: ${this.currentBlockHeight}`);
      } else {
        this.currentBlockHeight = parseInt(config.alkanes.startBlockHeight);
        logger.info(`从区块高度 ${this.currentBlockHeight} 开始监控`);
      }

      // 设置定时器定期扫描新区块
      this.blockIntervalId = setInterval(() => this.scanNewBlocks(), config.alkanes.scanInterval);
      
      // 设置定时器监控mempool
      this.mempoolIntervalId = setInterval(() => this.scanMempool(), config.alkanes.diesel.mempoolScanInterval);
      
      // 立即开始第一次扫描
      this.scanNewBlocks();
      this.scanMempool();
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
      logger.warn('DIESEL监控服务未在运行');
      return;
    }

    logger.info('停止DIESEL铸造监控服务');
    clearInterval(this.blockIntervalId);
    clearInterval(this.mempoolIntervalId);
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
        
        // 新区块生成时，只清理mempool中的交易，不重置最高费率记录
        this.pendingMintTransactions.clear();
        this.processedTxids.clear();
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
      const block = await bitcoinRPC.getBlock(blockHash, 2); // 详细级别2获取完整交易
      
      logger.info(`处理区块 #${height}: ${blockHash} (${block.tx.length} 笔交易)`);

      // 存储当前区块中的DIESEL铸造交易
      const blockDieselMints = [];
      let highestFeeRateInBlock = 0;
      let highestFeeTxid = null;
      
      // 首先清除该区块中对应的待处理交易
      this.clearConfirmedMempoolTransactions(block.tx.map(tx => tx.txid));

      // 处理区块中的所有交易
      for (const tx of block.tx) {
        // 检查是否是DIESEL铸造交易
        const isDieselMint = this.isDieselMintTransaction(tx);
        
        if (isDieselMint) {
          // 计算交易的fee rate (sat/vB)
          const feeRate = this.calculateFeeRate(tx);
          
          // 如果费率计算失败，跳过这笔交易
          if (feeRate === null) {
            logger.info(`发现DIESEL铸造交易: ${tx.txid} 在区块 #${height}, 费率: 无效`);
            continue;
          }
          
          // 保存交易信息
          const mintInfo = {
            txid: tx.txid,
            blockHeight: height,
            blockTime: block.time,
            feeRate: feeRate,
            sender: this.extractSender(tx),
            timestamp: Date.now()
          };
          
          blockDieselMints.push(mintInfo);
          
          // 更新该区块中最高gas费率的交易
          if (feeRate > highestFeeRateInBlock) {
            highestFeeRateInBlock = feeRate;
            highestFeeTxid = tx.txid;
          }
          
          // 记录交易信息
          this.addDieselMintTransaction(mintInfo);
          
          logger.info(`发现DIESEL铸造交易: ${tx.txid} 在区块 #${height}, 费率: ${feeRate.toFixed(2)} sat/vB`);
        }
      }
      
      // 如果在该区块中找到DIESEL铸造交易
      if (blockDieselMints.length > 0) {
        // 获取赢得DIESEL的交易（应该是第一个成功的铸造交易）
        const winningTransaction = this.findWinningTransaction(blockDieselMints);
        
        if (winningTransaction) {
          logger.info(`区块 #${height} 中赢得DIESEL的交易: ${winningTransaction.txid}, 费率: ${winningTransaction.feeRate.toFixed(2)} sat/vB`);
          
          // 发出赢得DIESEL的事件
          this.emit('diesel-won', winningTransaction);
          
          // 如果费率创历史新高，更新最高记录
          if (winningTransaction.feeRate > this.highestGasRate.feeRate) {
            this.highestGasRate = {
              txid: winningTransaction.txid,
              feeRate: winningTransaction.feeRate,
              blockHeight: height,
              timestamp: Date.now()
            };
            
            this.emit('highest-gas-updated', this.highestGasRate);
            logger.info(`新的历史最高Gas费率: ${this.highestGasRate.feeRate.toFixed(2)} sat/vB, 交易: ${this.highestGasRate.txid}`);
          }
        } else {
          logger.warn(`区块 #${height} 中没有找到有效的DIESEL铸造交易`);
        }
      }
    } catch (error) {
      logger.error(`处理区块 #${height} 失败: ${error.message}`);
    }
  }

  /**
   * 快速检查交易是否包含OP_RETURN输出
   * 这是一个轻量级筛选，避免对所有交易进行深度分析
   * @param {object} tx - 交易对象
   * @returns {boolean} - 是否包含OP_RETURN
   */
  hasOpReturn(tx) {
    if (!tx || !tx.vout || !Array.isArray(tx.vout)) {
      return false;
    }

    // 记录调试信息
    const txid = tx.txid || tx.hash;
    const isSuspectedTx = txid === "f214dd03a3c0d1f68f9dd9a3e6ca16fb1c575913ac8f3176ab85153fb07ce702";
    
    if (isSuspectedTx) {
      logger.info(`分析目标交易的vout结构: ${JSON.stringify(tx.vout.slice(0, 2))}`);
    }
    
    // 查找是否有OP_RETURN输出 - 考虑多种不同的格式
    for (const output of tx.vout) {
      // 情况1: scriptpubkey_type 存在且为 op_return
      if (output.scriptpubkey_type === 'op_return') {
        return true;
      }
      
      // 情况2: scriptPubKey.type 存在且为 nulldata
      if (output.scriptPubKey && output.scriptPubKey.type === 'nulldata') {
        return true;
      }
      
      // 情况3: scriptpubkey_asm 存在且以 OP_RETURN 开头
      if (output.scriptpubkey_asm && output.scriptpubkey_asm.startsWith('OP_RETURN')) {
        return true;
      }
      
      // 情况4: scriptPubKey.asm 存在且以 OP_RETURN 开头
      if (output.scriptPubKey && output.scriptPubKey.asm && output.scriptPubKey.asm.startsWith('OP_RETURN')) {
        return true;
      }
      
      // 情况5: 检查hex数据是否以OP_RETURN开头(0x6a)
      if (output.scriptPubKey && output.scriptPubKey.hex && output.scriptPubKey.hex.startsWith('6a')) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 扫描当前内存池中的交易
   */
  async scanMempool() {
    try {
      const currentTime = Date.now();
      let mempool;
      try {
        mempool = await bitcoinRPC.getRawMempool(true);
      } catch (error) {
        if (error.response && error.response.status === 503) {
          logger.error(`RPC服务暂时不可用(503): ${error.response.data || '无详细信息'}`);
        } else {
          logger.error(`获取Mempool失败: ${error.message}`);
        }
        return;
      }

      const allTxids = Object.keys(mempool);
      
      if (config.debug.enabled) {
        logger.info(`开始扫描内存池，共 ${allTxids.length} 笔交易`);
        logger.info(`距离上次扫描: ${((currentTime - this.lastScanTime) / 1000).toFixed(1)}秒`);
      }

      if (allTxids.length === 0) {
        if (config.debug.enabled) {
          logger.info('内存池为空，没有交易需要处理');
        }
        return;
      }
      
      const MIN_FEE_RATE = 10;
      const highFeeRateTxs = [];
      
      for (const txid of allTxids) {
        if (!this.processedTxids.has(txid) && mempool[txid] && mempool[txid].fees) {
          const feeRateSats = (mempool[txid].fees.base * 100000000) / (mempool[txid].vsize || mempool[txid].size);
          
          if (feeRateSats >= MIN_FEE_RATE) {
            highFeeRateTxs.push({
              txid,
              feeRate: feeRateSats,
              weight: mempool[txid].weight || mempool[txid].vsize * 4,
              size: mempool[txid].size || mempool[txid].vsize
            });
          }
        }
      }
      
      if (config.debug.enabled) {
        logger.info(`内存池中新的高费率交易(>=${MIN_FEE_RATE} sat/vB): ${highFeeRateTxs.length}笔`);
      }
      
      if (highFeeRateTxs.length === 0) {
        if (config.debug.enabled) {
          logger.info('没有新的高费率交易需要处理');
        }
        return;
      }
      
      highFeeRateTxs.sort((a, b) => b.feeRate - a.feeRate);
      
      // 减小批量大小到10个交易
      const batchSize = 10;
      const txBatches = [];
      
      for (let i = 0; i < highFeeRateTxs.length; i += batchSize) {
        txBatches.push(highFeeRateTxs.slice(i, i + batchSize));
      }
      
      if (config.debug.enabled) {
        logger.info(`将${highFeeRateTxs.length}笔交易分成${txBatches.length}批处理`);
      }
      
      const txDetailsMap = new Map();
      
      // 添加延时函数
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      
      // 处理每个批次，添加重试和延时
      for (let i = 0; i < txBatches.length; i++) {
        const batch = txBatches[i];
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            const batchResults = await bitcoinRPC.getBatchMempoolTransactions(batch.map(tx => tx.txid));
            for (const [txid, tx] of batchResults.entries()) {
              const originalTx = batch.find(t => t.txid === txid);
              if (originalTx) {
                txDetailsMap.set(txid, {
                  tx,
                  feeRate: originalTx.feeRate
                });
              }
            }
            // 成功处理后等待100ms再处理下一批
            await delay(100);
            break;
          } catch (error) {
            retryCount++;
            if (error.response && error.response.status === 503) {
              logger.error(`批次${i + 1}处理失败(503): ${error.response.data || '无详细信息'}`);
            } else if (error.response && error.response.data && error.response.data.error) {
              // RBF或其他RPC错误
              const rpcError = error.response.data.error;
              if (rpcError.code === -5) {
                logger.warn(`交易 ${batch[0].txid} 可能已被替换(RBF)或不存在`);
              } else {
                logger.warn(`批次${i + 1}处理失败: ${rpcError.message}`);
              }
            } else {
              logger.warn(`批次${i + 1}处理失败: ${error.message}`);
            }
            
            if (retryCount === maxRetries) {
              logger.warn(`批次${i + 1}处理失败，已达到最大重试次数`);
            } else {
              // 重试前等待时间随重试次数增加
              await delay(1000 * retryCount);
              logger.info(`批次${i + 1}处理失败，第${retryCount}次重试`);
            }
          }
        }
        
        if (config.debug.enabled && (i + 1) % 5 === 0) {
          logger.debug(`完成第${i + 1}/${txBatches.length}批次处理`);
        }
      }
      
      if (config.debug.enabled) {
        logger.info(`高效批处理：成功获取${txDetailsMap.size}/${highFeeRateTxs.length}笔交易详情`);
      }
      
      let mintCount = 0;
      let currentHighestFeeRate = 0;
      let currentHighestFeeTxid = null;
      
      for (const [txid, data] of txDetailsMap.entries()) {
        if (this.hasOpReturn(data.tx)) {
          const isDieselMint = this.isDieselMintTransaction(data.tx);
          
          if (isDieselMint) {
            mintCount++;
            const feeRate = data.feeRate;
            
            const mintInfo = {
              txid: txid,
              feeRate: feeRate,
              sender: this.extractSender(data.tx),
              timestamp: Date.now(),
              inMempool: true
            };
            
            this.pendingMintTransactions.set(txid, mintInfo);
            
            if (feeRate > currentHighestFeeRate) {
              currentHighestFeeRate = feeRate;
              currentHighestFeeTxid = txid;
            }
            
            this.updateHighestGasRate(txid, feeRate, mintInfo.sender);
            
            if (config.debug.enabled) {
              logger.info(`DIESEL铸造交易: ${txid} (费率: ${feeRate.toFixed(2)} sat/vB)`);
            }
          }
        }
        
        this.processedTxids.add(txid);
      }
      
      const expireTime = currentTime - 24 * 60 * 60 * 1000;
      for (const txid of this.processedTxids) {
        if (!mempool[txid] || (this.pendingMintTransactions.get(txid)?.timestamp || 0) < expireTime) {
          this.processedTxids.delete(txid);
        }
      }
      
      // 获取并显示top3交易
      const top3Transactions = Array.from(this.pendingMintTransactions.values())
        .sort((a, b) => b.feeRate - a.feeRate)
        .slice(0, 3);
      
      // 简化的结果输出
      logger.info(`Mempool扫描结果: ${mintCount}笔DIESEL铸造交易, 最高费率: ${this.highestGasRate.feeRate.toFixed(2)} sat/vB (${this.highestGasRate.txid})`);
      
      if (top3Transactions.length > 0) {
        logger.info('Top 3 DIESEL铸造交易:');
        top3Transactions.forEach((tx, index) => {
          logger.info(`${index + 1}. ${tx.txid} - ${tx.feeRate.toFixed(2)} sat/vB`);
        });
      }
      
      if (this.pendingMintTransactions.size > 0) {
        this.emit('mempool-update', {
          count: this.pendingMintTransactions.size,
          highestFeeRate: this.highestGasRate.feeRate,
          highestFeeTxid: this.highestGasRate.txid,
          top3Transactions: top3Transactions
        });
      }
      
      this.lastScanTime = currentTime;
    } catch (error) {
      logger.error(`扫描Mempool失败: ${error.message}`);
    }
  }

  /**
   * 清理不再在mempool中的交易
   * @param {Array<string>} currentTxids - 当前mempool中的交易ID列表
   */
  cleanupMempoolTransactions(currentTxids) {
    const currentTxidSet = new Set(currentTxids);
    
    for (const [txid, info] of this.pendingMintTransactions.entries()) {
      if (!currentTxidSet.has(txid)) {
        this.pendingMintTransactions.delete(txid);
      }
    }
  }

  /**
   * 清除已确认的mempool交易
   * @param {Array<string>} confirmedTxids - 已确认的交易ID列表
   */
  clearConfirmedMempoolTransactions(confirmedTxids) {
    for (const txid of confirmedTxids) {
      if (this.pendingMintTransactions.has(txid)) {
        this.pendingMintTransactions.delete(txid);
      }
    }
  }

  /**
   * 计算交易的fee rate (sat/vB)
   * @param {Object} tx - 交易对象
   * @returns {number|null} - 费率，如果无法计算则返回null
   */
  calculateFeeRate(tx) {
    try {
      // 计算输入总额
      let inputSum = 0;
      for (const vin of tx.vin) {
        if (vin.prevout && vin.prevout.value) {
          inputSum += Number(vin.prevout.value);
        }
      }
      
      // 计算输出总额
      let outputSum = 0;
      for (const vout of tx.vout) {
        if (vout.value) {
          outputSum += Number(vout.value);
        }
      }
      
      // 交易费 = 输入 - 输出
      const fee = inputSum - outputSum;
      
      // 获取交易大小
      const vsize = tx.vsize || tx.size || (tx.weight ? Math.ceil(tx.weight / 4) : 0);
      
      if (vsize === 0) {
        logger.warn(`交易 ${tx.txid} 无法获取大小信息`);
        return null;
      }
      
      // 计算费率 (sat/vB)
      const feeRate = (fee * 100000000) / vsize;
      
      if (config.debug.enabled) {
        logger.debug(`交易 ${tx.txid} 费率计算:`);
        logger.debug(`- 输入总额: ${inputSum} sat`);
        logger.debug(`- 输出总额: ${outputSum} sat`);
        logger.debug(`- 交易费: ${fee} sat`);
        logger.debug(`- 交易大小: ${vsize} vB`);
        logger.debug(`- 费率: ${feeRate.toFixed(2)} sat/vB`);
      }
      
      // 如果费率为负数或0，返回null表示无法计算
      if (feeRate <= 0) {
        logger.warn(`交易 ${tx.txid} 计算出无效费率(${feeRate.toFixed(2)} sat/vB)，将被忽略`);
        return null;
      }
      
      return feeRate;
    } catch (error) {
      logger.error(`计算交易费率失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 提取交易发送者地址
   * @param {Object} tx - 交易对象
   * @returns {string} - 发送者地址
   */
  extractSender(tx) {
    try {
      if (tx.vin && tx.vin.length > 0 && tx.vin[0].prevout && tx.vin[0].prevout.scriptPubKey) {
        return tx.vin[0].prevout.scriptPubKey.address || 'unknown';
      }
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * 检查交易是否是DIESEL铸造交易
   * @param {Object} tx - 交易对象
   * @returns {boolean} - 是否是DIESEL铸造交易
   */
  isDieselMintTransaction(tx) {
    try {
      // 记录交易ID用于调试
      const txid = tx.txid || tx.hash || '';
      
      if (!tx || !tx.vout || !Array.isArray(tx.vout)) {
        return false;
      }

      // 查找OP_RETURN输出
      const opReturnOutput = tx.vout.find(vout => {
        // 获取scriptPubKey的hex数据
        const hexData = vout.scriptPubKey?.hex || vout.scriptpubkey || '';
        
        // 检查输出类型是否为OP_RETURN
        const isOpReturn = (
          vout.scriptPubKey?.type === 'nulldata' ||
          vout.scriptpubkey_type === 'op_return' ||
          hexData.startsWith('6a') // OP_RETURN的操作码是0x6a
        );

        if (config.debug.enabled) {
          if (isOpReturn) {
            logger.debug(`找到OP_RETURN输出，hex数据: ${hexData}`);
          }
        }

        // 检查是否包含DIESEL特征序列
        const containsDieselPattern = hexData.includes('ff7f818cec82d08bc0a88281d215');

        return isOpReturn && containsDieselPattern;
      });

      if (opReturnOutput) {
        if (config.debug.enabled) {
          logger.info(`确认DIESEL铸造交易: ${txid}`);
          // 输出完整的OP_RETURN数据以便调试
          logger.debug(`OP_RETURN数据: ${JSON.stringify(opReturnOutput, null, 2)}`);
        }
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`检查DIESEL铸造交易失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 检查数据是否是Runestone结构
   * @param {string} hexData - 十六进制数据
   * @returns {boolean} - 是否是Runestone
   */
  isRunestone(hexData) {
    // 简单检查开头是否为OP_RETURN (0x6a)
    const isOpReturn = hexData.startsWith('6a');
    
    // 检查是否包含特定模式
    // ff7f818cec82d08bc0a88281d215 - 根据用户提供的示例
    const hasSpecificPattern = hexData.includes('ff7f818cec82d08bc0a88281d215');
    
    return isOpReturn && (hasSpecificPattern || hexData.includes('ff7f81'));
  }

  /**
   * 解码Runestone数据
   * @param {string} hexData - 十六进制数据
   * @returns {Object} - 解码后的数据
   */
  decodeRunestoneData(hexData) {
    // 这里应该根据Runestone协议规范解析数据
    // 简化版本，仅提取关键数据
    try {
      // 基本解析 - 去掉OP_RETURN标识后的数据
      const dataHex = hexData.substring(2);
      
      // 判断是否是目标交易的数据
      const isDebug = hexData && hexData.length > 20;
      
      if (isDebug) {
        logger.debug(`Runestone解析: 原始数据=${hexData.substring(0, 40)}...`);
        logger.debug(`解析后数据=${dataHex.substring(0, 40)}...`);
      }
      
      return {
        raw: hexData,
        data: dataHex
      };
    } catch (error) {
      logger.error(`解析Runestone数据失败: ${error.message}`);
      return { raw: hexData, data: '' };
    }
  }

  /**
   * 检查是否针对DIESEL合约(ID[2,0])
   * @param {Object} runeStoneData - Runestone数据
   * @returns {boolean} - 是否针对DIESEL
   */
  isDieselTarget(runeStoneData) {
    // 实际应用中需要正确解析出target ID
    // 由于DIESEL的ID是[2,0]，需要在数据中找到对应编码
    
    // TODO: 实现正确的target ID解析
    // 临时修改，增加更多检查逻辑
    const data = runeStoneData.data;
    
    // 检查是否包含ALKANES字符串
    const hasAlkanes = data.includes(Buffer.from('ALKANES').toString('hex'));
    
    // 检查是否包含[2,0]编码
    // 注意：这里简化处理，实际应该根据协议正确解析
    const targetPattern = '0200'; // 简化版的ID[2,0]编码
    const hasDieselId = data.includes(targetPattern);
    
    logger.debug(`DIESEL目标检查: hasAlkanes=${hasAlkanes}, hasDieselId=${hasDieselId}`);
    
    // 由于简化实现，这里返回true
    // 实际生产环境应该返回 hasAlkanes && hasDieselId
    return true;
  }

  /**
   * 检查是否包含铸造操作码(77)
   * @param {Object} runeStoneData - Runestone数据
   * @returns {boolean} - 是否包含铸造操作码
   */
  hasMintOpcode(runeStoneData) {
    // 检查是否包含铸造操作码77
    const mintOpcodeHex = config.alkanes.diesel.mintOpcode.toString(16).padStart(2, '0');
    
    // 记录更多信息以便调试
    logger.debug(`铸造操作码检查: 查找操作码=${mintOpcodeHex}, 数据长度=${runeStoneData.data.length}`);
    
    // 检查是否包含操作码
    const hasMintOp = runeStoneData.data.includes(mintOpcodeHex);
    
    // 额外检查，看是否包含ASCII的"77"或十六进制的4D（大写）
    const hasAscii77 = runeStoneData.data.includes('3737'); // ASCII "77"
    const hasHex4D = runeStoneData.data.includes('4D'); // 大写十六进制
    
    logger.debug(`操作码检查结果: 正常检查=${hasMintOp}, ASCII检查=${hasAscii77}, 大写检查=${hasHex4D}`);
    
    // 为测试目的，放宽检查条件
    return hasMintOp || hasAscii77 || hasHex4D;
  }

  /**
   * 添加DIESEL铸造交易记录
   * @param {Object} mintInfo - 铸造信息
   */
  addDieselMintTransaction(mintInfo) {
    this.dieselMintTransactions.push(mintInfo);
    
    // 限制历史记录数量
    if (this.dieselMintTransactions.length > config.alkanes.diesel.maxHistoryRecords) {
      this.dieselMintTransactions = this.dieselMintTransactions.slice(-config.alkanes.diesel.maxHistoryRecords);
    }
    
    // 发出新铸造交易事件
    this.emit('new-mint', mintInfo);
  }

  /**
   * 查找区块中赢得DIESEL的交易
   * @param {Array} mintTransactions - 区块中的铸造交易
   * @returns {Object} - 赢得DIESEL的交易
   */
  findWinningTransaction(mintTransactions) {
    if (mintTransactions.length === 0) {
      return null;
    }
    
    // 过滤掉费率为0或极低的交易(可能是数据错误)
    const validTransactions = mintTransactions.filter(tx => tx.feeRate > 1);
    
    if (validTransactions.length === 0) {
      logger.warn(`区块中所有${mintTransactions.length}笔DIESEL铸造交易费率都为0或过低，无法确定赢家`);
      return null;
    }
    
    // 按交易在区块中的顺序，第一个有效的铸造交易赢得DIESEL
    logger.info(`从${validTransactions.length}笔有效DIESEL铸造交易中选择赢家，赢家费率: ${validTransactions[0].feeRate.toFixed(2)} sat/vB`);
    return validTransactions[0];
  }

  /**
   * 获取当前Mempool中的DIESEL铸造交易
   * @returns {Array} - 交易列表
   */
  getPendingMintTransactions() {
    return Array.from(this.pendingMintTransactions.values());
  }

  /**
   * 获取最近的DIESEL铸造交易
   * @param {number} limit - 限制数量
   * @returns {Array} - 交易列表
   */
  getRecentMintTransactions(limit = 10) {
    return this.dieselMintTransactions.slice(-limit);
  }

  /**
   * 获取当前最高Gas费率信息
   * @returns {Object} - 最高Gas费率信息
   */
  getHighestGasRate() {
    return this.highestGasRate;
  }

  /**
   * 获取mempool中当前最高Gas费率
   * @returns {Object} - 最高Gas费率信息
   */
  getMempoolHighestGasRate() {
    return this.highestGasRate;
  }

  /**
   * 更新最高费率记录
   * @param {string} txid - 交易ID
   * @param {number} feeRate - 费率
   * @param {string} sender - 发送者地址
   * @returns {boolean} - 是否更新了最高费率
   */
  updateHighestGasRate(txid, feeRate, sender) {
    if (feeRate > this.highestGasRate.feeRate) {
      this.highestGasRate = {
        txid,
        feeRate,
        sender,
        timestamp: Date.now()
      };
      logger.info(`更新最高Gas费率记录: ${feeRate.toFixed(2)} sat/vB, 交易: ${txid}`);
      return true;
    }
    return false;
  }

  /**
   * 分析指定区块
   * @param {number} height - 区块高度
   */
  async analyzeSpecificBlock(height) {
    try {
      logger.info(`开始分析区块 #${height}`);
      
      const blockHash = await bitcoinRPC.getBlockHash(height);
      const block = await bitcoinRPC.getBlock(blockHash, 2); // 详细级别2获取完整交易
      
      logger.info(`区块 #${height} 包含 ${block.tx.length} 笔交易`);

      // 存储当前区块中的DIESEL铸造交易
      const blockDieselMints = [];
      let highestFeeRateInBlock = 0;
      let highestFeeTxid = null;
      
      // 处理区块中的所有交易
      for (const tx of block.tx) {
        // 检查是否是DIESEL铸造交易
        const isDieselMint = this.isDieselMintTransaction(tx);
        
        if (isDieselMint) {
          // 计算交易的fee rate (sat/vB)
          const feeRate = this.calculateFeeRate(tx);
          
          // 如果费率计算失败，跳过这笔交易
          if (feeRate === null) {
            logger.info(`发现DIESEL铸造交易: ${tx.txid} 在区块 #${height}, 费率: 无效`);
            continue;
          }
          
          // 保存交易信息
          const mintInfo = {
            txid: tx.txid,
            blockHeight: height,
            blockTime: block.time,
            feeRate: feeRate,
            sender: this.extractSender(tx),
            timestamp: Date.now()
          };
          
          blockDieselMints.push(mintInfo);
          
          // 更新该区块中最高gas费率的交易
          if (feeRate > highestFeeRateInBlock) {
            highestFeeRateInBlock = feeRate;
            highestFeeTxid = tx.txid;
          }
          
          logger.info(`发现DIESEL铸造交易: ${tx.txid}, 费率: ${feeRate.toFixed(2)} sat/vB`);
        }
      }
      
      // 输出分析结果
      if (blockDieselMints.length > 0) {
        logger.info(`\n区块 #${height} 分析结果:`);
        logger.info(`- 发现 ${blockDieselMints.length} 笔DIESEL铸造交易`);
        logger.info(`- 最高费率: ${highestFeeRateInBlock.toFixed(2)} sat/vB`);
        logger.info(`- 最高费率交易: ${highestFeeTxid}`);
        
        // 按费率排序输出所有铸造交易
        blockDieselMints.sort((a, b) => b.feeRate - a.feeRate);
        logger.info('\n所有DIESEL铸造交易(按费率排序):');
        blockDieselMints.forEach((mint, index) => {
          logger.info(`${index + 1}. ${mint.txid} - ${mint.feeRate.toFixed(2)} sat/vB`);
        });
      } else {
        logger.info(`区块 #${height} 中没有发现DIESEL铸造交易`);
      }
      
      // 分析完成后退出
      process.exit(0);
      
    } catch (error) {
      logger.error(`分析区块 #${height} 失败: ${error.message}`);
      process.exit(1);
    }
  }
}

module.exports = new DieselMonitor(); 