const logger = require('./utils/logger');
const alkanesMonitor = require('./services/alkanesMonitor');
const webService = require('./services/webService');

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
const path = require('path');

if (!fs.existsSync(path.join(__dirname, '../logs'))) {
  fs.mkdirSync(path.join(__dirname, '../logs'));
}

// 启动应用
(async function main() {
  logger.info('启动Alkanes监控系统');
  
  try {
    // 启动Web服务
    webService.start();
    
    // 启动Alkanes监控
    await alkanesMonitor.start();
    
    logger.info('Alkanes监控系统已成功启动');
  } catch (error) {
    logger.error(`启动失败: ${error.message}`);
    process.exit(1);
  }
})(); 