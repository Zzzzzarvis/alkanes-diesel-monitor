require('dotenv').config();

// 解析命令行参数
const argv = require('minimist')(process.argv.slice(2));

module.exports = {
  // 调试配置
  debug: {
    enabled: argv['debug'] || false,
    logLevel: argv['log-level'] || 'info',
    showDetails: argv['show-details'] || false,
    traceApi: argv['trace-api'] || false,
    mempool: argv['debug-mempool'] || false
  },
  // 区块分析配置
  blockAnalysis: {
    // 指定要分析的区块高度，如果为null则分析最新区块
    targetHeight: argv['block-height'] ? parseInt(argv['block-height']) : null,
    // 是否只分析指定区块
    analyzeOnly: argv['analyze-only'] || false
  },
  btcNode: {
    url: process.env.BTC_RPC_URL || 'http://101.43.19.118:8332',
    user: process.env.BTC_RPC_USER || 'bitcoinrpc',
    password: process.env.BTC_RPC_PASSWORD || 'bitcoinrpc'
  },
  server: {
    port: process.env.PORT || 3000
  },
  log: {
    level: process.env.LOG_LEVEL || 'info'
  },
  // Alkanes协议相关配置
  alkanes: {
    // 用于识别Alkanes协议的OP_RETURN前缀
    opReturnPrefix: 'ALKANES',
    // 扫描区块的间隔时间(毫秒)
    scanInterval: 30000,
    // 铸造操作的特征标识
    mintSignature: 77, // 根据文档中的示例，"77"可能是铸造操作的标识
    // 扫描起始区块，可以设为最近的区块，或者Alkanes协议发布的区块高度
    startBlockHeight: process.env.START_BLOCK_HEIGHT || 'latest',
    // DIESEL相关配置
    diesel: {
      // DIESEL的Alkane ID
      blockId: 2,
      txId: 0,
      // 铸造操作码
      mintOpcode: 77,
      // 保留多少个历史最高gas交易记录
      maxHistoryRecords: 50,
      // Mempool扫描间隔(毫秒)
      mempoolScanInterval: 15000
    }
  }
}; 