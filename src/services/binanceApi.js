const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

class BinanceApi {
    constructor(apiKey = config.api.apiKey, apiSecret = config.api.apiSecret) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.baseUrl = config.api.baseUrl;
    }

    sign(query) {
        return crypto
            .createHmac('sha256', this.apiSecret)
            .update(query)
            .digest('hex');
    }

    async getHistoricalKlines(symbol, interval, limit) {
        try {
            const endpoint = '/fapi/v1/klines';
            const url = `${this.baseUrl}${endpoint}`;
            
            const response = await axios.get(url, {
                params: {
                    symbol,
                    interval,
                    limit
                }
            });

            logger.info('获取历史K线数据成功', {
                symbol,
                interval,
                count: response.data.length
            });

            return response.data;
        } catch (error) {
            logger.error('获取历史K线数据失败', {
                error: error.message,
                symbol,
                interval
            });
            throw error;
        }
    }

    async getAccountInfo() {
        try {
            const endpoint = '/fapi/v2/account';
            const timestamp = Date.now();
            const queryString = `timestamp=${timestamp}`;
            const signature = this.sign(queryString);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios.get(url, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            });
            
            const accountInfo = response.data;
            const usdtAsset = accountInfo.assets.find(asset => asset.asset === 'USDT');
            
            if (!usdtAsset) {
                throw new Error('未找到USDT资产信息');
            }

            // 返回格式化的账户信息
            return {
                totalWalletBalance: parseFloat(usdtAsset.walletBalance),
                availableBalance: parseFloat(usdtAsset.availableBalance),
                unrealizedProfit: parseFloat(usdtAsset.unrealizedProfit),
                marginBalance: parseFloat(usdtAsset.marginBalance),
                maintMargin: parseFloat(usdtAsset.maintMargin),
                initialMargin: parseFloat(usdtAsset.initialMargin),
                positions: accountInfo.positions || []
            };
        } catch (error) {
            logger.error('获取账户信息失败', { 
                error: error.message,
                details: error.response?.data 
            });
            throw error;
        }
    }

    async getCurrentPosition(symbol) {
        try {
            const accountInfo = await this.getAccountInfo();
            const position = accountInfo.positions.find(p => p.symbol === symbol);
            
            if (!position || parseFloat(position.positionAmt) === 0) {
                return { type: null, qty: 0 };
            }

            const positionAmt = parseFloat(position.positionAmt);
            return {
                type: positionAmt > 0 ? 'long' : 'short',
                qty: Math.abs(positionAmt),
                leverage: parseInt(position.leverage),
                entryPrice: parseFloat(position.entryPrice),
                markPrice: parseFloat(position.markPrice),
                unrealizedProfit: parseFloat(position.unrealizedProfit)
            };
        } catch (error) {
            logger.error('获取持仓信息失败', { 
                error: error.message,
                symbol 
            });
            throw error;
        }
    }

    async setLeverage(symbol, leverage) {
        try {
            const endpoint = '/fapi/v1/leverage';
            const timestamp = Date.now();
            const queryString = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
            const signature = this.sign(queryString);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios.post(url, null, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            });

            logger.info('设置杠杆倍数成功', {
                symbol,
                leverage,
                response: response.data
            });

            return response.data;
        } catch (error) {
            // 如果已经是目标杠杆倍数，忽略错误
            if (error.response?.data?.code === -4046) {
                logger.debug('杠杆倍数已经是目标设置');
                return;
            }
            logger.error('设置杠杆倍数失败', {
                error: error.message,
                symbol,
                leverage
            });
            throw error;
        }
    }

    async setPositionMode(dualSidePosition = false) {
        try {
            const endpoint = '/fapi/v1/positionSide/dual';
            const timestamp = Date.now();
            const queryString = `dualSidePosition=${dualSidePosition}&timestamp=${timestamp}`;
            const signature = this.sign(queryString);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            await axios.post(url, null, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            });

            logger.info('设置持仓模式成功', {
                mode: dualSidePosition ? '双向持仓' : '单向持仓'
            });
        } catch (error) {
            // 如果已经是目标模式，忽略错误
            if (error.response?.data?.code === -4059) {
                logger.debug('持仓模式已经是目标设置');
                return;
            }
            logger.error('设置持仓模式失败', { error: error.message });
            throw error;
        }
    }

    async placeOrder(symbol, side, quantity, reduceOnly = false) {
        try {
            const endpoint = '/fapi/v1/order';
            const timestamp = Date.now();
            
            // 基础参数
            const params = {
                symbol,
                side,
                type: 'MARKET',
                quantity,
                timestamp
            };

            // 只有在平仓时才添加 reduceOnly 参数
            if (reduceOnly) {
                params.reduceOnly = true;
            }
            
            const queryString = Object.entries(params)
                .map(([key, value]) => `${key}=${value}`)
                .join('&');
            
            const signature = this.sign(queryString);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios.post(url, null, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            });

            logger.info('下单成功', {
                symbol,
                side,
                quantity,
                reduceOnly,
                orderId: response.data.orderId
            });

            return response.data;
        } catch (error) {
            // console.log('error',error);
            logger.error('下单失败', {
                error: error.message,
                details: error.response?.data,
                params: {
                    symbol,
                    side,
                    quantity,
                    reduceOnly
                }
            });
            throw error;
        }
    }

    async cancelAllOrders(symbol) {
        try {
            const endpoint = '/fapi/v1/allOpenOrders';
            const timestamp = Date.now();
            const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
            const signature = this.sign(queryString);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios.delete(url, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            });

            logger.info('取消所有订单成功', { symbol });
            return response.data;
        } catch (error) {
            logger.error('取消所有订单失败', {
                error: error.message,
                symbol
            });
            throw error;
        }
    }

    // 获取账户交易手续费率
    async getCommissionRate(symbol) {
        try {
            const endpoint = '/fapi/v1/commissionRate';
            const timestamp = Date.now();
            const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
            const signature = this.sign(queryString);
            const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;
            
            const response = await axios.get(url, {
                headers: { 'X-MBX-APIKEY': this.apiKey }
            });

            logger.info('获取手续费率成功', {
                symbol,
                rates: response.data
            });

            return response.data;
        } catch (error) {
            logger.error('获取手续费率失败', {
                error: error.message,
                symbol
            });
            throw error;
        }
    }

    // 获取交易所信息,symbol参数用于过滤特定交易对的信息,但目前未使用
    async getExchangeInfo(symbol) {
        try {
            const endpoint = '/fapi/v1/exchangeInfo';
            const url = `${this.baseUrl}${endpoint}`;
            
            const response = await axios.get(url);
            // console.log('response',response.data);
            logger.debug('获取交易所信息成功', {
                symbol,  // 这里symbol参数实际上没有被使用
                timestamp: new Date().toISOString()
            });

            // TODO: 可以根据symbol参数过滤出特定交易对的信息
            return response.data;
        } catch (error) {
            logger.error('获取交易所信息失败', {
                error: error.message,
                symbol
            });
            throw error;
        }
    }

    // 添加获取最新价格的方法
    async getLatestPrice(symbol) {
        try {
            const endpoint = '/fapi/v1/ticker/price';
            const url = `${this.baseUrl}${endpoint}?symbol=${symbol}`;
            
            const response = await axios.get(url);
            const price = parseFloat(response.data.price);

            logger.debug('获取最新价格', {
                symbol,
                price
            });

            return price;
        } catch (error) {
            logger.error('获取最新价格失败', {
                error: error.message,
                symbol
            });
            throw error;
        }
    }
}

module.exports = BinanceApi; 