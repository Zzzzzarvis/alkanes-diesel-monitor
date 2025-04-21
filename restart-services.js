// 重启监控服务的脚本
const alkanesMonitor = require('./src/services/alkanesMonitor');
const dieselMonitor = require('./src/services/dieselMonitor');
const logger = require('./src/utils/logger');

// 记录启动信息
logger.info('正在重启监控服务...');

// 停止当前运行的服务
async function stopServices() {
  if (alkanesMonitor.isRunning) {
    alkanesMonitor.stop();
    logger.info('已停止Alkanes监控');
  }
  
  if (dieselMonitor.isRunning) {
    dieselMonitor.stop();
    logger.info('已停止DIESEL监控');
  }
}

// 启动服务
async function startServices() {
  try {
    // 启动Alkanes监控
    await alkanesMonitor.start();
    logger.info(`Alkanes监控已启动，当前区块高度: ${alkanesMonitor.currentBlockHeight}`);
    
    // 启动DIESEL监控
    await dieselMonitor.start();
    logger.info(`DIESEL监控已启动，当前区块高度: ${dieselMonitor.currentBlockHeight}`);
    
    logger.info('所有监控服务已成功重启');
  } catch (error) {
    logger.error(`启动监控服务失败: ${error.message}`);
  }
}

// 执行重启
async function restart() {
  await stopServices();
  await startServices();
}

restart(); 