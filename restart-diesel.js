// 重启DIESEL监控的脚本
const dieselMonitor = require('./src/services/dieselMonitor');

console.log('正在重启DIESEL监控...');

// 先停止当前的监控
if (dieselMonitor.isRunning) {
  dieselMonitor.stop();
  console.log('已停止当前运行的DIESEL监控');
}

// 重新启动监控
dieselMonitor.start().then(() => {
  console.log('DIESEL监控已成功重启');
  console.log(`当前区块高度: ${dieselMonitor.currentBlockHeight}`);
}).catch(err => {
  console.error('重启DIESEL监控失败:', err);
}); 