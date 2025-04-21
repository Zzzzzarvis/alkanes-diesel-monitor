#!/usr/bin/env node

const logger = require('../utils/logger');
const bitcoinRPC = require('../services/bitcoinRPC');
const config = require('../config');
const DieselMonitor = require('../services/dieselMonitor');

// 处理命令行参数
const args = process.argv.slice(2);

// 解析命令行参数
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('使用方法: npm run diesel [选项]');
    console.log('');
    console.log('选项:');
    console.log('  --help, -h          显示帮助信息');
    process.exit(0);
  }
}

// 创建DieselMonitor实例，但不启动定时扫描
const dieselMonitor = new DieselMonitor(bitcoinRPC, null, {
  scanInterval: 60000, // 60秒扫描一次，仅用于初始化
  scanMempoolInterval: 30000 // 30秒扫描一次内存池，仅用于初始化
});

// 添加彩色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * 显示交易列表
 * @param {Array} transactions - 交易列表
 */
function displayTransactions(transactions) {
  if (!transactions || transactions.length === 0) {
    console.log(`${colors.yellow}未找到符合条件的交易${colors.reset}`);
    return;
  }
  
  console.log(`${colors.bright}${colors.green}找到 ${transactions.length} 笔费率大于50 sat/vB且包含OP_RETURN输出的交易:${colors.reset}\n`);
  
  // 表头
  console.log(`${colors.bright}${colors.cyan}序号 | 交易ID                                                        | 费率 (sat/vB)${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}-----|-----------------------------------------------------------------|-------------${colors.reset}`);
  
  // 交易列表
  transactions.forEach((tx, index) => {
    const feeRate = parseFloat(tx.feeRate).toFixed(2);
    let colorCode = colors.reset;
    
    // 按费率着色
    if (feeRate >= 200) {
      colorCode = colors.red; // 红色表示费率非常高
    } else if (feeRate >= 100) {
      colorCode = colors.yellow; // 黄色表示费率较高
    } else if (feeRate >= 50) {
      colorCode = colors.green; // 绿色表示费率适中
    }
    
    console.log(`${colors.bright}${(index + 1).toString().padStart(4)}${colors.reset} | ${tx.txid} | ${colorCode}${feeRate.padStart(11)}${colors.reset}`);
  });
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log(`${colors.bright}${colors.blue}正在获取内存池中的所有高费率OP_RETURN交易...${colors.reset}`);
    
    // 获取全部内存池交易
    const mempoolTxids = await bitcoinRPC.getRawMempool();
    console.log(`${colors.bright}${colors.blue}内存池中共有 ${mempoolTxids.length} 笔交易，开始处理所有交易...${colors.reset}`);
    
    // 获取交易 - 传入0表示不限制数量，处理所有交易
    const transactions = await dieselMonitor.getHighGasOpReturnTransactions(0);
    
    // 格式化并显示交易
    const formattedTransactions = transactions.map(tx => ({
      txid: tx.txid,
      feeRate: tx.feeRate.toFixed(2)
    }));
    
    displayTransactions(formattedTransactions);
    
    // 退出程序
    process.exit(0);
  } catch (error) {
    logger.error(`获取交易失败: ${error.message}`);
    console.error(`${colors.bright}${colors.red}错误: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// 执行主函数
main(); 