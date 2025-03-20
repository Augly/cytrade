const config = require('../config');
const logger = require('../utils/logger');
const BinanceApi = require('./binanceApi');
const TechnicalAnalysis = require('./technicalAnalysis');
const WebSocketManager = require('./webSocketManager');

class TradingBot {
    constructor() {
        this.binanceApi = new BinanceApi();
        this.technicalAnalysis = new TechnicalAnalysis();
        this.allowAddOrder = { long: false, short: false };
        this.wsManager = null;
        this.testMode = false; // 添加测试模式标志
        this.lastArcPattern = null; // 记录上一次的圆弧形态
        this.lastCrossSignal = null; // 记录上一次的突破信号
        this.crossPrice = null; // 记录突破时的价格
    }

    async start() {
        try {
            // 设置为单向持仓模式
            await this.binanceApi.setPositionMode(false);

            if (this.testMode) {
                logger.info('交易机器人启动于测试模式');
                await this.testTrading();
                return;
            }
            
            await this.initializeHistoricalData();
            this.startWebSocket();
            logger.info('交易机器人启动成功');
            await this.sendSignal(`${config.trading.symbol} 交易机器人启动成功`);
        } catch (error) {
            logger.error('交易机器人启动失败', { error: error.message });
            throw error;
        }
    }

    async testTrading() {
        try {
            // 获取当前价格
            const currentPrice = await this.binanceApi.getLatestPrice(config.trading.symbol);
            logger.info('当前价格', { price: currentPrice });

            // 测试开多仓
            logger.info('测试开多仓...');
            await this.openPosition('long', currentPrice);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 获取最新价格
            const closePrice = await this.binanceApi.getLatestPrice(config.trading.symbol);

            // 测试平多仓
            logger.info('测试平多仓...');
            await this.closePosition(closePrice);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 测试开空仓
            logger.info('测试开空仓...');
            await this.openPosition('short', closePrice);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 获取最新价格
            const finalPrice = await this.binanceApi.getLatestPrice(config.trading.symbol);

            // 测试平空仓
            logger.info('测试平空仓...');
            await this.closePosition(finalPrice);

            logger.info('交易测试完成');
            process.exit(0);
        } catch (error) {
            logger.error('交易测试失败', {
                error: error.message,
                details: error.response?.data
            });
            process.exit(1);
        }
    }

    async initializeHistoricalData() {
        try {
            const klines = await this.binanceApi.getHistoricalKlines(
                config.trading.symbol,
                config.trading.interval,
                config.indicators.historyLimit
            );

            // 初始化技术分析数据
            klines.forEach(kline => {
                this.technicalAnalysis.addPrice(parseFloat(kline[4])); // 收盘价
            });

            // 计算初始EMA值
            const lastPrice = parseFloat(klines[klines.length - 1][4]);
            const { ema5, ema50 } = this.technicalAnalysis.calculateEMAs(lastPrice);

            if (ema5 && ema50) {
                this.technicalAnalysis.updateEmaHistory(ema5,ema50);
                logger.info('历史数据初始化完成', {
                    ema5: ema5.toFixed(2),
                    ema50: ema50.toFixed(2)
                });
            }
        } catch (error) {
            logger.error('初始化历史数据失败', { error: error.message });
            throw error;
        }
    }

    startWebSocket() {
        this.wsManager = new WebSocketManager(this.handleKline.bind(this));
        this.wsManager.connect();
    }

    async handleKline(message) {
        try {
            if (message.e !== 'kline') return;

            const kline = message.k;
            const currentPrice = parseFloat(kline.c);
            const { ema5, ema50 } = this.technicalAnalysis.calculateEMAs(currentPrice);

            if (!ema5 || !ema50) return;

            // logger.info('实时价格更新', {
            //     price: currentPrice,
            //     ema5: ema5.toFixed(2),
            //     ema50: ema50.toFixed(2),
            //     emaDiff: Math.abs(ema5 - ema50).toFixed(2)
            // });
            
            
            // K线收盘时更新历史数据
            if (kline.x) {
                this.technicalAnalysis.addPrice(currentPrice);
                this.technicalAnalysis.updateEmaHistory(ema5,ema50);
            } else {
                this.technicalAnalysis.updateLastEma(ema5,ema50);
                // 实时检查交易信号
                await this.checkTradeSignals(ema5, ema50, currentPrice);
                // 检查圆弧形态
                const arcPattern = this.technicalAnalysis.checkArcPattern(ema5, ema50);
                if (arcPattern && arcPattern !== this.lastArcPattern) {
                    logger.info(`检测到新的${arcPattern === 'TOP' ? '圆弧顶' : '圆弧底'}形态`);
                    await this.handleArcPattern(arcPattern, currentPrice, ema5, ema50);
                    this.lastArcPattern = arcPattern;
                }
                // this.technicalAnalysis.updateLastEma(ema5,ema50);
            }

        } catch (error) {
            logger.error('处理K线数据失败', { error: error.message });
        }
    }

    async checkTradeSignals(ema5, ema50, currentPrice) {
        try {
            // 检查EMA交叉信号
            const prevEma5 = this.technicalAnalysis.previousEma5;
            const prevEma50 = this.technicalAnalysis.previousEma50;

            if (!prevEma5 || !prevEma50) {
                this.technicalAnalysis.previousEma5 = ema5;
                this.technicalAnalysis.previousEma50 = ema50;
                return;
            }

            // 判断是否需要检查持仓状态
            const priceAboveEmas = currentPrice > ema5 && currentPrice > ema50;
            const priceBelowEmas = currentPrice < ema5 && currentPrice < ema50;
            const hasEmaCross = (prevEma5 > prevEma50 && ema5 < ema50) || 
                               (prevEma5 < prevEma50 && ema5 > ema50);

            // 只有在可能需要交易时才获取持仓信息
            if (priceAboveEmas || priceBelowEmas || hasEmaCross) {
                const position = await this.binanceApi.getCurrentPosition(config.trading.symbol);

                // 检查平仓条件
                if (position.type === 'short' && priceAboveEmas) {
                    logger.info('空单平仓条件触发: 价格突破EMA5和EMA50', {
                        currentPrice: currentPrice.toFixed(2),
                        ema5: ema5.toFixed(2),
                        ema50: ema50.toFixed(2),
                        positionType: 'short'
                    });
                    await this.closePosition(currentPrice);
                    this.lastCrossSignal = null;
                    return;
                }

                if (position.type === 'long' && priceBelowEmas) {
                    logger.info('多单平仓条件触发: 价格跌破EMA5和EMA50', {
                        currentPrice: currentPrice.toFixed(2),
                        ema5: ema5.toFixed(2),
                        ema50: ema50.toFixed(2),
                        positionType: 'long'
                    });
                    await this.closePosition(currentPrice);
                    this.lastCrossSignal = null;
                    return;
                }

                // 检查开仓条件
                if (!position.type && hasEmaCross) {  // 只在没有持仓时考虑开新仓
                    let currentSignal = null;

                    if (prevEma5 > prevEma50 && ema5 < ema50) {
                        currentSignal = 'DOWN_CROSS';
                        this.crossPrice = currentPrice;
                    } else if (prevEma5 < prevEma50 && ema5 > ema50) {
                        currentSignal = 'UP_CROSS';
                        this.crossPrice = currentPrice;
                    }

                    if (currentSignal && currentSignal !== this.lastCrossSignal) {
                        const newPositionType = currentSignal === 'DOWN_CROSS' ? 'short' : 'long';
                        logger.info(`检测到新的${newPositionType === 'long' ? '上涨' : '下跌'}突破信号`);
                        await this.openPosition(newPositionType, currentPrice);
                        this.allowAddOrder[newPositionType] = true;
                        this.lastCrossSignal = currentSignal;
                    }
                }
            }

            // 更新EMA历史值
            // this.technicalAnalysis.previousEma5 = ema5;
            // this.technicalAnalysis.previousEma50 = ema50;

        } catch (error) {
            logger.error('检查交易信号失败', { error: error.message });
        }
    }

    async handleArcPattern(pattern, currentPrice, ema5, ema50) {
        try {
            const emaValues = this.technicalAnalysis.ema5History;

            // 检查是否已经发生突破
            const hasBreakout = pattern === 'TOP' ? ema5 < ema50 : ema5 > ema50;

            if (hasBreakout) {
                // 如果已经发生突破，检查价格差异
                if (!this.crossPrice) {
                    return; // 如果没有记录突破价格，不执行交易
                }

                const priceDiff = Math.abs(currentPrice - this.crossPrice);
                if (priceDiff > config.trading.maxPriceDiff) {
                    logger.info('价格与突破点差异过大，不执行交易', {
                        currentPrice,
                        crossPrice: this.crossPrice,
                        difference: priceDiff,
                        maxAllowed: config.trading.maxPriceDiff
                    });
                    return;
                }

                // 对于圆弧形态，检查与第二低/高点的差异
                const sortedEmaValues = [...emaValues].sort((a, b) => pattern === 'TOP' ? b - a : a - b);
                const secondExtreme = sortedEmaValues[1]; // 第二高/低点
                const extremeDiff = Math.abs(currentPrice - secondExtreme);

                if (extremeDiff > config.trading.maxExtremeDiff) {
                    logger.info('价格与第二极值点差异过大，不执行交易', {
                        currentPrice,
                        secondExtreme,
                        difference: extremeDiff
                    });
                    return;
                }
            }
            if (pattern === 'TOP' && pattern !== this.lastArcPattern) {
                logger.info('检测到新的圆弧顶信号');
                let position = await this.binanceApi.getCurrentPosition(config.trading.symbol);
                if (position.type === 'long') {
                    await this.closePosition(currentPrice);
                }
                if (position.type !== 'short') {
                    await this.openPosition('short', currentPrice);
                    this.allowAddOrder.short = true;
                }
            }
            else if (pattern === 'BOTTOM' && pattern !== this.lastArcPattern) {
                logger.info('检测到新的圆弧底信号');
                let position = await this.binanceApi.getCurrentPosition(config.trading.symbol);
                if (position.type === 'short') {
                    await this.closePosition(currentPrice);
                }
                if (position.type !== 'long') {
                    await this.openPosition('long', currentPrice);
                    this.allowAddOrder.long = true;
                }
            }
        } catch (error) {
            logger.error('处理圆弧形态失败', { error: error.message });
        }
    }

    async openPosition(direction, currentPrice) {
        try {
            // 获取账户详细信息
            const accountInfo = await this.binanceApi.getAccountInfo();
            logger.info('账户信息', {
                availableBalance: accountInfo.availableBalance,
                marginBalance: accountInfo.marginBalance
            });

            // 根据是否为测试模式设置不同的参数
            const leverage = this.testMode ? 5 : config.trading.leverage; // 测试模式使用5倍杠杆
            const positionSize = this.testMode ? 0.05 : config.trading.positionSize; // 测试模式使用1%仓位

            // 设置杠杆倍数
            await this.binanceApi.setLeverage(config.trading.symbol, leverage);

            // 计算下单数量
            const availableBalance = accountInfo.availableBalance;
            const orderValue = availableBalance * positionSize;
            let quantity = (orderValue * leverage) / currentPrice;

            // 获取交易对规则
            const exchangeInfo = await this.binanceApi.getExchangeInfo(config.trading.symbol);
            const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === config.trading.symbol);

            if (!symbolInfo) {
                throw new Error(`未找到交易对 ${config.trading.symbol} 的信息`);
            }

            // 处理数量精度
            const quantityPrecision = symbolInfo.quantityPrecision || 3;
            const roundedQuantity = Math.floor(quantity * Math.pow(10, quantityPrecision)) / Math.pow(10, quantityPrecision);

            // 检查最小交易量
            const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
            const minQty = parseFloat(lotSizeFilter.minQty);

            if (roundedQuantity < minQty) {
                throw new Error(`下单数量 ${roundedQuantity} 小于最小交易量 ${minQty}`);
            }

            // 记录下单信息
            logger.info('准备下单', {
                mode: this.testMode ? '测试模式' : '正常模式',
                direction,
                leverage,
                positionSize,
                availableBalance,
                orderValue,
                quantity: roundedQuantity,
                currentPrice
            });

            // 执行下单
            const orderResult = await this.binanceApi.placeOrder(
                config.trading.symbol,
                direction === 'long' ? 'BUY' : 'SELL',
                roundedQuantity
            );

            // 发送开仓信号
            await this.sendSignal(`${config.trading.symbol} ${direction === 'long' ? '开多' : '开空'} 价格:${currentPrice} 数量:${roundedQuantity}`);

            logger.info('开仓成功', {
                direction,
                quantity: roundedQuantity,
                price: currentPrice,
                orderId: orderResult.orderId
            });

            this.allowAddOrder[direction] = true;
        } catch (error) {
            logger.error('开仓失败', {
                error: error.message,
                details: error.response?.data
            });
            throw error;
        }
    }

    async closePosition(currentPrice) {
        try {
            // 1. 获取当前持仓信息
            const position = await this.binanceApi.getCurrentPosition(config.trading.symbol);

            if (!position.type) {
                logger.info('当前无持仓，无需平仓');
                return;
            }

            // 2. 获取交易对规则
            const exchangeInfo = await this.binanceApi.getExchangeInfo(config.trading.symbol);
            const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === config.trading.symbol);

            if (!symbolInfo) {
                throw new Error(`未找到交易对 ${config.trading.symbol} 的信息`);
            }

            // 3. 处理数量精度
            const quantityPrecision = symbolInfo.quantityPrecision || 3;
            const roundedQuantity = Math.floor(position.qty * Math.pow(10, quantityPrecision)) / Math.pow(10, quantityPrecision);

            // 4. 检查最小交易量
            const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
            const minQty = parseFloat(lotSizeFilter.minQty);

            if (roundedQuantity < minQty) {
                throw new Error(`平仓数量 ${roundedQuantity} 小于最小交易量 ${minQty}`);
            }

            // 5. 计算预期盈亏
            const entryPrice = position.entryPrice;
            const pnl = position.type === 'long'
                ? (currentPrice - entryPrice) * roundedQuantity
                : (entryPrice - currentPrice) * roundedQuantity;

            // 6. 记录平仓信息
            logger.info('准备平仓', {
                positionType: position.type,
                quantity: roundedQuantity,
                entryPrice: position.entryPrice,
                currentPrice,
                unrealizedPnl: position.unrealizedProfit,
                expectedPnl: pnl,
                leverage: position.leverage
            });

            // 7. 执行平仓
            const orderResult = await this.binanceApi.placeOrder(
                config.trading.symbol,
                position.type === 'long' ? 'SELL' : 'BUY',
                roundedQuantity,
                true
            );

            // 发送平仓信号
            await this.sendSignal(`${config.trading.symbol} ${position.type === 'long' ? '平多' : '平空'} 价格:${currentPrice} 数量:${roundedQuantity} 盈亏:${pnl.toFixed(2)}`);

            // 8. 记录平仓结果
            logger.info('平仓成功', {
                positionType: position.type,
                quantity: roundedQuantity,
                price: currentPrice,
                orderId: orderResult.orderId,
                expectedPnl: pnl
            });

            // 9. 重置加仓标记
            this.allowAddOrder = { long: false, short: false };

            // 10. 获取最新账户信息
            const accountInfo = await this.binanceApi.getAccountInfo();
            logger.info('平仓后账户信息', {
                availableBalance: accountInfo.availableBalance,
                marginBalance: accountInfo.marginBalance,
                unrealizedProfit: accountInfo.unrealizedProfit
            });

        } catch (error) {
            logger.error('平仓失败', {
                error: error.message,
                details: error.response?.data,
                symbol: config.trading.symbol
            });
            throw error;
        }
    }

    // 添加一个紧急平仓方法
    async emergencyClosePosition() {
        try {
            logger.warn('执行紧急平仓');
            const position = await this.binanceApi.getCurrentPosition(config.trading.symbol);

            if (!position.type) {
                logger.info('当前无持仓，无需紧急平仓');
                return;
            }

            const currentPrice = await this.binanceApi.getLatestPrice(config.trading.symbol);
            await this.closePosition(currentPrice);

            logger.info('紧急平仓完成');
        } catch (error) {
            logger.error('紧急平仓失败', {
                error: error.message,
                details: error.response?.data
            });
            throw error;
        }
    }

    // 添加一个检查持仓状态的方法
    async checkPositionStatus() {
        try {
            const position = await this.binanceApi.getCurrentPosition(config.trading.symbol);
            const currentPrice = await this.binanceApi.getLatestPrice(config.trading.symbol);

            if (!position.type) {
                return null;
            }

            const pnlPercent = ((position.unrealizedProfit || 0) / position.initialMargin) * 100;

            // 检查是否需要止损
            if (pnlPercent <= -config.trading.stopLoss * 100) {
                logger.warn('触发止损信号', {
                    pnlPercent,
                    stopLoss: -config.trading.stopLoss * 100
                });
                await this.closePosition(currentPrice);
                return;
            }

            // 检查是否需要止盈
            if (pnlPercent >= config.trading.takeProfit * 100) {
                logger.info('触发止盈信号', {
                    pnlPercent,
                    takeProfit: config.trading.takeProfit * 100
                });
                await this.closePosition(currentPrice);
                return;
            }

            return {
                type: position.type,
                size: position.qty,
                entryPrice: position.entryPrice,
                currentPrice,
                pnlPercent,
                unrealizedProfit: position.unrealizedProfit
            };
        } catch (error) {
            logger.error('检查持仓状态失败', { error: error.message });
            throw error;
        }
    }

    stop() {
        if (this.wsManager) {
            this.wsManager.close();
        }
        logger.info('交易机器人已停止');
    }

    async sendSignal(text) {
        try {
            const FormData = require('form-data');
            const axios = require('axios');
            
            const formData = new FormData();
            formData.append('text', text);

            const response = await axios.post('http://114.132.237.91:5000/sendxinhao', formData, {
                headers: formData.getHeaders()
            });

            logger.info('信号发送成功', {
                text,
                response: response.data
            });
        } catch (error) {
            logger.error('信号发送失败', {
                error: error.message,
                text
            });
        }
    }
}

module.exports = TradingBot; 