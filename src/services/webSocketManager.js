const WebSocket = require('ws');
const config = require('../config');
const logger = require('../utils/logger');
const BinanceApi = require('./binanceApi');

class WebSocketManager {
    constructor(onMessage) {
        this.wsUrl = config.api.wsUrl;
        this.onMessage = onMessage;
        this.ws = null;
        this.pingInterval = null;
        this.pongTimeout = null;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.lastMessageTime = Date.now();
        this.subscriptions = new Set();
        this.binanceApi = new BinanceApi();
    }

    async connect() {
        try {
            // 先获取历史K线数据
            const klines = await this.binanceApi.getHistoricalKlines(
                config.trading.symbol,
                config.trading.interval,
                100 // 获取100根K线数据
            );

            // 只处理已闭合的K线数据
            const closedKlines = klines.slice(0, -1);
            
            // 将历史K线数据传给onMessage处理
            closedKlines.forEach(kline => {
                const formattedKline = {
                    e: "kline",
                    k: {
                        t: kline[0], // 开盘时间
                        T: kline[6], // 收盘时间
                        s: config.trading.symbol,
                        i: config.trading.interval,
                        o: kline[1], // 开盘价
                        h: kline[2], // 最高价
                        l: kline[3], // 最低价
                        c: kline[4], // 收盘价
                        v: kline[5], // 成交量
                        x: true // 表示已闭合
                    }
                };
                this.onMessage(formattedKline);
            });

            // 建立WebSocket连接
            const wsEndpoint = `${this.wsUrl}/${config.trading.symbol.toLowerCase()}@kline_${config.trading.interval}`;
            this.ws = new WebSocket(wsEndpoint);
            
            this.setupWebSocketHandlers();
            this.setupHeartbeat();
            this.setupConnectionMonitor();

            logger.info('正在建立WebSocket连接', { endpoint: wsEndpoint });
        } catch (error) {
            logger.error('创建WebSocket连接失败', { error: error.message });
            this.handleReconnect();
        }
    }

    setupWebSocketHandlers() {
        this.ws.on('open', () => {
            this.handleOpen();
        });

        this.ws.on('message', (data) => {
            
            if (data.toString() === "ping") {
                this.handlePing();
                return;
            }
            this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
            this.handleClose(code, reason);
        });

        this.ws.on('error', (error) => {
            this.handleError(error);
        });

        this.ws.on('ping', () => {
            console.log('收到ping');
            this.handlePing();
        });

        this.ws.on('pong', () => {
            // console.log('收到pong');
            this.handlePong();
        });
    }

    handleOpen() {
        logger.info('WebSocket连接已建立');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.lastMessageTime = Date.now();

        // 重新订阅之前的订阅
        this.resubscribe();
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            this.lastMessageTime = Date.now();
            
            // 处理心跳响应
            if (message.pong) {
                this.handlePong();
                return;
            }

            // 处理订阅响应
            if (message.result !== undefined) {
                logger.debug('收到订阅响应', message);
                return;
            }

            // 处理业务消息
            if (this.onMessage) {
                this.onMessage(message);
            }
        } catch (error) {
            logger.error('处理WebSocket消息失败', {
                error: error.message,
                data: data.toString()
            });
        }
    }

    handleClose(code, reason) {
        logger.warn('WebSocket连接关闭', {
            code,
            reason: reason.toString(),
            reconnectAttempts: this.reconnectAttempts
        });

        this.cleanup();
        
        if (!this.isReconnecting) {
            this.handleReconnect();
        }
    }

    handleError(error) {
        logger.error('WebSocket错误', {
            error: error.message,
            reconnectAttempts: this.reconnectAttempts
        });

        this.cleanup();
        this.ws.close();
    }

    handlePing() {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.pong();
            console.log('响应ping');
            logger.debug('响应ping');
        }
    }

    handlePong() {
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
        logger.debug('收到pong响应');
    }

    setupHeartbeat() {
        this.cleanup();
        
        // 设置定期ping
        this.pingInterval = setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.ping();
                logger.debug('发送ping');
                // 设置pong超时检测
                this.pongTimeout = setTimeout(() => {
                    logger.warn('Pong响应超时，准备重连');
                    this.ws.terminate();
                }, config.websocket.pongTimeout);
            }
        }, config.websocket.pingInterval);
    }

    setupConnectionMonitor() {
        // 监控连接状态
        setInterval(() => {
            const now = Date.now();
            const messageAge = now - this.lastMessageTime;

            // 如果超过2分钟没有收到任何消息，认为连接已断开
            if (messageAge > 120000 && this.ws.readyState === WebSocket.OPEN) {
                logger.warn('检测到长时间无消息，准备重连', {
                    messageAge: messageAge / 1000
                });
                this.ws.terminate();
            }
        }, 30000); // 每30秒检查一次
    }

    cleanup() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    async handleReconnect() {
        if (this.isReconnecting) return;

        this.isReconnecting = true;

        if (this.reconnectAttempts < config.websocket.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(
                config.websocket.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
                30000
            );
            
            logger.info('准备重连', {
                attempt: this.reconnectAttempts,
                delay: delay,
                maxAttempts: config.websocket.maxReconnectAttempts
            });

            await new Promise(resolve => setTimeout(resolve, delay));
            this.connect();
        } else {
            logger.error('重连失败次数过多，停止重连');
            this.isReconnecting = false;
            process.exit(1);
        }
    }

    subscribe(channel) {
        if (this.ws.readyState === WebSocket.OPEN) {
            const subscribeMsg = {
                method: "SUBSCRIBE",
                params: [channel],
                id: Date.now()
            };
            
            this.ws.send(JSON.stringify(subscribeMsg));
            this.subscriptions.add(channel);
            
            logger.info('订阅频道', { channel });
        }
    }

    unsubscribe(channel) {
        if (this.ws.readyState === WebSocket.OPEN) {
            const unsubscribeMsg = {
                method: "UNSUBSCRIBE",
                params: [channel],
                id: Date.now()
            };
            
            this.ws.send(JSON.stringify(unsubscribeMsg));
            this.subscriptions.delete(channel);
            
            logger.info('取消订阅频道', { channel });
        }
    }

    resubscribe() {
        if (this.subscriptions.size > 0) {
            const subscribeMsg = {
                method: "SUBSCRIBE",
                params: Array.from(this.subscriptions),
                id: Date.now()
            };
            
            this.ws.send(JSON.stringify(subscribeMsg));
            logger.info('重新订阅所有频道', {
                channels: Array.from(this.subscriptions)
            });
        }
    }

    close() {
        this.cleanup();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        logger.info('WebSocket连接已关闭');
    }
}

module.exports = WebSocketManager;