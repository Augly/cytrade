require('dotenv').config();

const config = {
    // 交易配置
    trading: {
        symbol: 'BTCUSDT',         // 交易对
        interval: '1h',            // K线周期
        leverage: 50,              // 杠杆倍数
        positionSize: 0.05,         // 使用账户余额的比例
        minEmaDiff: 1000,          // EMA差值阈值
        maxPositions: 3,           // 最大持仓数量
        stopLoss: 0.02,            // 止损比例 (2%)
        takeProfit: 0.05,          // 止盈比例 (5%)
        trailingStop: 0.01,        // 追踪止损比例 (1%)
        emergencyStopLoss: 0.05,    // 5%紧急止损
        maxDrawdown: 0.1,         // 10%最大回撤
        minProfitToClose: 0.01,    // 1%最小获利平仓
        maxPriceDiff: 100,         // 100u价格差异
        maxExtremeDiff: 50,        // 50u极值差异
    },

    // API配置
    api: {
        baseUrl: 'https://fapi.binance.com',
        wsUrl: 'wss://fstream.binance.com/ws',
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET,
        recvWindow: 5000,
    },

    // WebSocket配置
    websocket: {
        pingInterval: 30000,          // 30秒发送一次ping
        pongTimeout: 5000,           // 5秒内没收到pong就重连
        reconnectDelay: 5000,        // 基础重连延迟时间
        maxReconnectAttempts: 5,     // 最大重连次数
        messageTimeout: 120000,       // 消息超时时间（2分钟）
    },

    // 技术指标配置
    indicators: {
        ema5Period: 5,
        ema50Period: 50,
        rsiPeriod: 14,
        macdFast: 12,
        macdSlow: 26,
        macdSignal: 9,
        bbPeriod: 20,
        bbStdDev: 2,
        historyLimit: 100,           // 历史数据条数
        maxEma5History: 20,          // EMA5历史记录最大长度
        maxClosingPrices: 200,       // 收盘价历史记录最大长度
    },

    // 风险管理配置
    riskManagement: {
        maxDailyLoss: 0.05,          // 最大日亏损比例 (5%)
        maxDrawdown: 0.15,           // 最大回撤比例 (15%)
        maxLeverage: 50,             // 最大杠杆倍数
        minBalance: 100,             // 最小账户余额 (USDT)
    },

    // 日志配置
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: {
            enabled: true,
            path: 'logs',
            maxSize: '10m',
            maxFiles: '7d',
        },
        console: {
            enabled: true,
            colorize: true,
        },
        telegram: {
            enabled: false,
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            chatId: process.env.TELEGRAM_CHAT_ID,
            level: 'warn',
        }
    }
};

module.exports = config; 