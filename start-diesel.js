// 启动DIESEL监控的脚本
const dieselMonitor = require('./src/services/dieselMonitor');

console.log('正在启动DIESEL监控...');
dieselMonitor.start().then(() => {
  console.log('DIESEL监控已启动');
  console.log(`当前区块高度: ${dieselMonitor.currentBlockHeight}`);
}).catch(err => {
  console.error('启动DIESEL监控失败:', err);
}); 