// 重启优化后的DIESEL监控服务
const dieselMonitor = require('./src/services/dieselMonitor');
const logger = require('./src/utils/logger');

// 记录启动信息
logger.info('正在重启优化后的DIESEL监控服务...');

// 停止当前运行的服务
async function stopServices() {
  if (dieselMonitor.isRunning) {
    dieselMonitor.stop();
    logger.info('已停止DIESEL监控');
  }
}

// 启动优化后的服务
async function startServices() {
  try {
    // 启动DIESEL监控
    await dieselMonitor.start();
    logger.info(`DIESEL监控已启动，当前区块高度: ${dieselMonitor.currentBlockHeight}`);
    logger.info('使用优化后的三步筛选算法监控DIESEL铸造交易');
    logger.info('1. 预筛选: 只处理Gas费率 >= 30 sat/vB的高费率交易');
    logger.info('2. 第一阶段: 在高费率交易中筛选包含OP_RETURN的交易');
    logger.info('3. 第二阶段: 详细分析符合条件的交易是否为DIESEL铸造');
    logger.info('4. 使用批量处理减少RPC请求数量');
    logger.info('这种方法可以大幅提高监控效率，专注于有竞争力的DIESEL铸造交易');
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