const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class BitcoinRPC {
  constructor() {
    this.url = config.btcNode.url;
    this.auth = {
      username: config.btcNode.user,
      password: config.btcNode.password
    };
    this.rpcId = 1;
    this.maxRetries = 2; // 最大重试次数
  }

  /**
   * 发送RPC请求到比特币节点
   * @param {string} method - RPC方法名
   * @param {Array} params - RPC参数
   * @param {number} retryCount - 当前重试次数
   * @returns {Promise<any>} - RPC响应
   */
  async call(method, params = [], retryCount = 0) {
    try {
      const response = await axios({
        method: 'post',
        url: this.url,
        auth: this.auth,
        data: {
          jsonrpc: '2.0',
          id: this.rpcId++,
          method,
          params
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10秒超时
      });

      if (response.data.error) {
        throw new Error(`RPC错误: ${JSON.stringify(response.data.error)}`);
      }

      return response.data.result;
    } catch (error) {
      // 检查是否因为网络问题需要重试
      if (retryCount < this.maxRetries && 
         (error.code === 'ECONNREFUSED' || 
          error.code === 'ETIMEDOUT' || 
          error.code === 'ECONNABORTED')) {
        
        logger.warn(`RPC调用失败，正在重试(${retryCount + 1}/${this.maxRetries}) - ${method}: ${error.message}`);
        
        // 指数退避重试
        const delay = 1000 * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.call(method, params, retryCount + 1);
      }
      
      logger.error(`RPC调用失败 - ${method}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取最新区块高度
   * @returns {Promise<number>} - 区块高度
   */
  async getBlockCount() {
    return this.call('getblockcount');
  }

  /**
   * 通过高度获取区块哈希
   * @param {number} height - 区块高度
   * @returns {Promise<string>} - 区块哈希
   */
  async getBlockHash(height) {
    return this.call('getblockhash', [height]);
  }

  /**
   * 获取区块信息
   * @param {string} hash - 区块哈希
   * @param {boolean} verbose - 是否返回详细信息
   * @returns {Promise<any>} - 区块信息
   */
  async getBlock(hash, verbose = true) {
    return this.call('getblock', [hash, verbose]);
  }

  /**
   * 获取完整的交易信息
   * @param {string} txid - 交易ID
   * @param {boolean} verbose - 是否返回详细信息
   * @returns {Promise<any>} - 交易信息
   */
  async getRawTransaction(txid, verbose = true) {
    return this.call('getrawtransaction', [txid, verbose]);
  }

  /**
   * 获取内存池交易信息
   * @param {boolean} verbose - 是否返回详细信息
   * @returns {Promise<any>} - 内存池交易信息
   */
  async getRawMempool(verbose = false) {
    return this.call('getrawmempool', [verbose]);
  }

  /**
   * 安全地获取内存池交易详情
   * 如果交易不存在，返回null而不是抛出异常
   * @param {string} txid - 交易ID 
   * @returns {Promise<object|null>} - 交易信息或null
   */
  async getMempoolTransaction(txid) {
    try {
      // 先检查交易是否在内存池中
      const mempoolContents = await this.getRawMempool(true);
      if (!mempoolContents[txid]) {
        logger.debug(`交易 ${txid} 不在内存池中`);
        return null;
      }
      
      // 获取详细信息
      return await this.getRawTransaction(txid, true);
    } catch (error) {
      logger.warn(`获取内存池交易 ${txid} 失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 批量获取内存池交易
   * 同时获取多个交易，减少单次请求数量
   * @param {string[]} txids - 交易ID数组
   * @param {number} batchSize - 每批处理的交易数量 
   * @returns {Promise<Map<string, object>>} - 交易ID到交易详情的映射
   */
  async getBatchMempoolTransactions(txids, batchSize = 5) {
    const result = new Map();
    
    // 先获取内存池信息，这样可以一次性过滤掉不在内存池中的交易
    const mempoolContents = await this.getRawMempool(true);
    
    // 过滤掉不在内存池中的交易ID
    const validTxids = txids.filter(txid => mempoolContents[txid]);
    
    // 分批处理，每次处理batchSize个交易
    for (let i = 0; i < validTxids.length; i += batchSize) {
      const batch = validTxids.slice(i, i + batchSize);
      
      // 并行获取这一批交易
      const promises = batch.map(txid => {
        return this.getRawTransaction(txid, true)
          .then(tx => ({ txid, tx }))
          .catch(error => {
            logger.warn(`批量获取交易 ${txid} 失败: ${error.message}`);
            return { txid, tx: null };
          });
      });
      
      // 等待所有请求完成
      const results = await Promise.all(promises);
      
      // 处理结果
      for (const { txid, tx } of results) {
        if (tx) {
          result.set(txid, tx);
        }
      }
      
      // 在批次间添加短暂延迟，避免对节点造成突发负载
      if (i + batchSize < validTxids.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return result;
  }

  /**
   * 获取交易的费率（以sat/vB为单位）
   * @param {string} txid - 交易ID
   * @returns {Promise<number>} - 交易费率（sat/vB）
   */
  async getTransactionFeeRate(txid) {
    try {
      const tx = await this.getRawTransaction(txid, true);
      if (!tx) return 0;
      
      // 获取交易大小
      const vsize = tx.vsize || tx.size || (tx.weight ? Math.ceil(tx.weight / 4) : 0);
      if (!vsize || vsize <= 0) return 0;
      
      // 对于mempool中的交易，可能需要计算输入和输出的差额
      let fee = 0;
      
      // 如果交易已经包含fee字段，直接使用
      if (tx.fee !== undefined) {
        fee = Math.abs(tx.fee * 100000000); // 转换为satoshi
      } else {
        // 需要查询输入交易来计算fee
        // 这里为简化，返回一个估计值或默认值
        fee = 1000; // 默认1000 satoshi作为fallback
      }
      
      // 计算费率 sat/vB
      const feeRate = fee / vsize;
      return feeRate;
    } catch (error) {
      logger.warn(`计算交易 ${txid} 费率失败: ${error.message}`);
      return 0;
    }
  }

  /**
   * 估算交易费率
   * @param {number} confirmTarget - 目标确认区块数
   * @returns {Promise<Object>} - 费率估算结果，包含feerate字段
   */
  async estimateSmartFee(confirmTarget = 2) {
    try {
      const result = await this.call('estimatesmartfee', [confirmTarget]);
      return result || { feerate: 10 }; // 默认最低10 sat/vB
    } catch (error) {
      logger.warn(`估算费率失败: ${error.message}`);
      return { feerate: 10 }; // 默认值
    }
  }
}

module.exports = new BitcoinRPC(); 