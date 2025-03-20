const winston = require('winston');
const path = require('path');
const config = require('../config');
require('winston-daily-rotate-file');

// 自定义日志格式
const customFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        if (Object.keys(meta).length > 0) {
            logMessage += ` ${JSON.stringify(meta)}`;
        }
        return logMessage;
    })
);

// 创建日志传输器
const transports = [];

// 添加控制台输出
if (config.logging.console.enabled) {
    transports.push(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize({ all: config.logging.console.colorize }),
            customFormat
        )
    }));
}

// 添加文件输出
if (config.logging.file.enabled) {
    // 错误日志
    transports.push(new winston.transports.DailyRotateFile({
        filename: path.join(config.logging.file.path, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: config.logging.file.maxSize,
        maxFiles: config.logging.file.maxFiles,
        format: customFormat
    }));

    // 组合日志
    transports.push(new winston.transports.DailyRotateFile({
        filename: path.join(config.logging.file.path, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.logging.file.maxSize,
        maxFiles: config.logging.file.maxFiles,
        format: customFormat
    }));
}

// 添加Telegram通知（如果启用）
if (config.logging.telegram.enabled) {
    const TelegramLogger = require('./telegramLogger');
    transports.push(new TelegramLogger({
        level: config.logging.telegram.level,
        botToken: config.logging.telegram.botToken,
        chatId: config.logging.telegram.chatId
    }));
}

// 创建logger实例
const logger = winston.createLogger({
    level: config.logging.level,
    transports: transports,
    exitOnError: false
});

// 添加未捕获异常处理
process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常', { error: error.stack });
    process.exit(1);
});

// 添加未处理的Promise拒绝处理
process.on('unhandledRejection', (error) => {
    logger.error('未处理的Promise拒绝', { error: error.stack });
});

// 添加辅助方法
logger.startTime = (label) => {
    if (!logger.timers) logger.timers = new Map();
    logger.timers.set(label, process.hrtime());
};

logger.endTime = (label) => {
    if (!logger.timers || !logger.timers.has(label)) return;
    const diff = process.hrtime(logger.timers.get(label));
    const duration = (diff[0] * 1e9 + diff[1]) / 1e6; // 转换为毫秒
    logger.debug(`${label} 耗时`, { duration: `${duration.toFixed(3)}ms` });
    logger.timers.delete(label);
};

// Telegram日志处理器
class TelegramLogger {
    constructor(options) {
        this.name = 'telegram';
        this.level = options.level;
        this.botToken = options.botToken;
        this.chatId = options.chatId;
    }

    async log(info, callback) {
        try {
            const message = `[${info.level.toUpperCase()}] ${info.message}`;
            await this.sendTelegramMessage(message);
        } catch (error) {
            console.error('Telegram发送消息失败:', error);
        }
        callback();
    }

    async sendTelegramMessage(message) {
        const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        const params = {
            chat_id: this.chatId,
            text: message,
            parse_mode: 'HTML'
        };

        try {
            await axios.post(url, params);
        } catch (error) {
            console.error('发送Telegram消息失败:', error);
        }
    }
}

module.exports = logger; 