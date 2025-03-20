const { EMA, RSI, MACD, BollingerBands } = require('technicalindicators');
const config = require('../config');
const logger = require('../utils/logger');

class TechnicalAnalysis {
    constructor() {
        this.closingPrices = [];
        this.ema5History = [];
        this.ema50History = [];
        this.previousEma5 = null;
        this.previousEma50 = null;
        this.volumeHistory = [];
    }

    addPrice(price, volume = null) {
        try {
            // 添加收盘价
            this.closingPrices.push(price);
            if (this.closingPrices.length > config.indicators.maxClosingPrices) {
                this.closingPrices.shift();
            }

            // 添加成交量
            if (volume !== null) {
                this.volumeHistory.push(volume);
                if (this.volumeHistory.length > config.indicators.maxClosingPrices) {
                    this.volumeHistory.shift();
                }
            }

            logger.debug('价格数据已更新', {
                pricesCount: this.closingPrices.length,
                lastPrice: price
            });
        } catch (error) {
            logger.error('添加价格数据失败', { error: error.message });
            throw error;
        }
    }

    calculateEMAs(currentPrice) {
        try {
            const prices = [...this.closingPrices, currentPrice];
            if (prices.length < config.indicators.ema50Period) {
                logger.warn('数据不足，无法计算EMA50', {
                    required: config.indicators.ema50Period,
                    current: prices.length
                });
                return { ema5: null, ema50: null };
            }

            const ema5Array = EMA.calculate({
                period: config.indicators.ema5Period,
                values: prices
            });

            const ema50Array = EMA.calculate({
                period: config.indicators.ema50Period,
                values: prices
            });
            const ema5 = ema5Array[ema5Array.length - 1];
            const ema50 = ema50Array[ema50Array.length - 1];
            logger.debug('EMA计算完成', {
                ema5: ema5,
                ema50: ema50
            });

            return { ema5, ema50 };
        } catch (error) {
            logger.error('计算EMA失败', { error: error.message });
            throw error;
        }
    }

    calculateRSI(period = 14) {
        try {
            if (this.closingPrices.length < period) {
                logger.warn('数据不足，无法计算RSI');
                return null;
            }

            const rsiResult = RSI.calculate({
                period: period,
                values: this.closingPrices
            });

            return rsiResult[rsiResult.length - 1];
        } catch (error) {
            logger.error('计算RSI失败', { error: error.message });
            throw error;
        }
    }

    calculateMACD() {
        try {
            const macdInput = {
                values: this.closingPrices,
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9,
                SimpleMAOscillator: false,
                SimpleMASignal: false
            };

            const macdResults = MACD.calculate(macdInput);
            return macdResults[macdResults.length - 1];
        } catch (error) {
            logger.error('计算MACD失败', { error: error.message });
            throw error;
        }
    }

    calculateBollingerBands(period = 20, stdDev = 2) {
        try {
            const bbInput = {
                period: period,
                values: this.closingPrices,
                stdDev: stdDev
            };

            const bbResults = BollingerBands.calculate(bbInput);
            return bbResults[bbResults.length - 1];
        } catch (error) {
            logger.error('计算布林带失败', { error: error.message });
            throw error;
        }
    }
    updateEmaHistory(ema5, ema50) {
        try {
            this.ema5History.push(ema5);
            this.ema5History.push(ema5);
            if (this.ema5History.length > config.indicators.maxEma5History) {
                this.ema5History.shift();
            }

            this.ema50History.push(ema50);
            this.ema50History.push(ema50);
            if (this.ema50History.length > config.indicators.maxEma5History) {
                this.ema50History.shift();
            }
            this.previousEma5 = ema5;
            this.previousEma50 = ema50;
            logger.debug('EMA历史记录已更新', {
                historyLength: this.ema5History.length,
                lastEma5: ema5,
                lastEma50: ema50
            });
        } catch (error) {
            logger.error('更新EMA历史记录失败', { error: error.message });
            throw error;
        }
    }

    updateLastEma(ema5, ema50) {
        try {
            if (this.ema5History.length > 0 && this.ema50History.length > 0) {
                this.ema5History[this.ema5History.length - 1] = ema5;
                this.ema50History[this.ema50History.length - 1] = ema50;

                logger.debug('最新EMA值已更新', {
                    lastEma5: ema5,
                    lastEma50: ema50
                });
            }
        } catch (error) {
            logger.error('更新最新EMA值失败', { error: error.message });
            throw error;
        }
    }

    checkArcPattern(currentEma5, currentEma50) {
        try {

            if (this.ema5History.length < 5 || this.ema50History.length < 5) {
                logger.debug('EMA历史数据不足，无法判断圆弧形态');
                return null;
            }
            const lastFiveEma5 = this.ema5History.slice(-5);
            const lastFiveEma50 = this.ema50History.slice(-5);
            const middleEma5 = lastFiveEma5[2];
            const middleEma50 = lastFiveEma50[2];
            if (middleEma5 > lastFiveEma5[0] && middleEma5 > lastFiveEma5[1] &&
                middleEma5 > lastFiveEma5[3] && middleEma5 > lastFiveEma5[4] &&
                currentEma5 > currentEma50) {
                const arcEmaDiff = Math.abs(middleEma5 - middleEma50);
                console.log('arcEmaDiff', arcEmaDiff)
                if (arcEmaDiff < config.trading.minEmaDiff) {
                    logger.debug('圆弧顶/底点与对应时刻EMA50的差值不足，不构成有效信号', {
                        arcPoint: middleEma5,
                        arcEma50: middleEma50,
                        difference: arcEmaDiff,
                        required: config.trading.minEmaDiff
                    });
                    return null;
                }
                logger.info('检测到圆弧顶形态', {
                    ema5Values: lastFiveEma5.map(v => v),
                    ema50Values: lastFiveEma50.map(v => v),
                    arcPoint: middleEma5,
                    arcEma50: middleEma50,
                    arcEmaDiff: arcEmaDiff
                });
                return 'TOP';
            }

            if (middleEma5 < lastFiveEma5[0] && middleEma5 < lastFiveEma5[1] &&
                middleEma5 < lastFiveEma5[3] && middleEma5 < lastFiveEma5[4] &&
                currentEma5 < currentEma50) {


                const arcEmaDiff = Math.abs(middleEma5 - middleEma50);
                console.log('arcEmaDiff', arcEmaDiff)
                if (arcEmaDiff < config.trading.minEmaDiff) {
                    logger.debug('圆弧顶/底点与对应时刻EMA50的差值不足，不构成有效信号', {
                        arcPoint: middleEma5,
                        arcEma50: middleEma50,
                        difference: arcEmaDiff,
                        required: config.trading.minEmaDiff
                    });
                    return null;
                }
                logger.info('检测到圆弧底形态', {
                    ema5Values: lastFiveEma5.map(v => v),
                    ema50Values: lastFiveEma50.map(v => v),
                    arcPoint: middleEma5,
                    arcEma50: middleEma50,
                    arcEmaDiff: arcEmaDiff
                });
                return 'BOTTOM';
            }

            return null;
        } catch (error) {
            logger.error('检查圆弧形态失败', { error: error.message });
            throw error;
        }
    }

    calculateAllIndicators() {
        try {
            const currentPrice = this.closingPrices[this.closingPrices.length - 1];
            const { ema5, ema50 } = this.calculateEMAs(currentPrice);
            const rsi = this.calculateRSI();
            const macd = this.calculateMACD();
            const bb = this.calculateBollingerBands();

            const indicators = {
                ema5,
                ema50,
                rsi,
                macd,
                bb,
                price: currentPrice
            };

            logger.debug('所有技术指标计算完成', indicators);
            return indicators;
        } catch (error) {
            logger.error('计算技术指标失败', { error: error.message });
            throw error;
        }
    }

    getVolatility() {
        try {
            if (this.closingPrices.length < 20) {
                return null;
            }

            const returns = [];
            for (let i = 1; i < this.closingPrices.length; i++) {
                const returnVal = (this.closingPrices[i] - this.closingPrices[i - 1]) / this.closingPrices[i - 1];
                returns.push(returnVal);
            }

            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
            const volatility = Math.sqrt(variance);

            return volatility;
        } catch (error) {
            logger.error('计算波动率失败', { error: error.message });
            throw error;
        }
    }

    reset() {
        this.closingPrices = [];
        this.ema5History = [];
        this.ema50History = [];
        this.previousEma5 = null;
        this.previousEma50 = null;
        this.volumeHistory = [];
        logger.info('技术分析数据已重置');
    }
}

module.exports = TechnicalAnalysis; 