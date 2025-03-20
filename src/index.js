const TradingBot = require('./services/tradingBot');
const logger = require('./utils/logger');
const config = require('./config');

async function main() {
    logger.info('交易机器人启动中...', {
        symbol: config.trading.symbol,
        interval: config.trading.interval
    });

    const bot = new TradingBot();

    // 优雅退出处理
    process.on('SIGINT', async () => {
        logger.info('收到退出信号，正在关闭...');
        await bot.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        logger.info('收到终止信号，正在关闭...');
        await bot.stop();
        process.exit(0);
    });

    try {
        await bot.start();
    } catch (error) {
        logger.error('启动失败', { error: error.message });
        process.exit(1);
    }
}

main(); 