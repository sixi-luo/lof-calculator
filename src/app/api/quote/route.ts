import { NextRequest, NextResponse } from 'next/server'
import { serverCache } from '@/utils/server-cache'

// ============================================================
// 全市场行情数据API - 统一接口
// 
// 支持市场：
// - A股：股票、指数、LOF基金
// - 港股：股票、ETF、指数
// - 美股：股票、ETF、指数
// 
// 数据源优先级（统一）：Yahoo Finance → TickFlow
// - Yahoo Finance: 无频率限制，覆盖全市场
// - TickFlow: 有频率限制(10次/分钟)，作为备选
// 
// 特殊数据源：
// - LOF基金行情：东方财富API
// - LOF基金净值：东方财富API
// - LOF基金K线：新浪API
// ============================================================

// ============================================================
// API 配置
// ============================================================
const TICKFLOW_API_KEY = process.env.TICKFLOW_API_KEY || ''
const TICKFLOW_BASE_URL = 'https://api.tickflow.org/v1'

const YAHOO_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
}

const EM_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*',
  'Referer': 'https://quote.eastmoney.com/',
}

// ============================================================
// 类型定义
// ============================================================

type Market = 'A' | 'HK' | 'US'
type SecurityType = 'stock' | 'index' | 'etf' | 'lof' | 'unknown'

interface CodeInfo {
  original: string           // 原始输入
  code: string               // 标准化代码
  market: Market             // 市场
  type: SecurityType         // 证券类型
  exchange?: string          // 交易所
  formatted: {
    tickflow?: string        // TickFlow格式
    yahoo?: string           // Yahoo Finance格式
    eastmoney?: string       // 东方财富格式（secid）
    sina?: string            // 新浪格式
  }
}

interface QuoteData {
  code: string
  name: string
  price: number | null
  change: number | null
  change_percent: number | null
  open: number | null
  high: number | null
  low: number | null
  prev_close: number | null
  volume: number | null
  source: string
  market: Market
  type: SecurityType
}

interface KlineItem {
  date: string
  open: number | null
  close: number | null
  high: number | null
  low: number | null
  volume: number | null
  change_percent: number | null
}

// ============================================================
// 市场识别模块
// ============================================================

// A股指数代码映射
const A_INDEX_CODES: Record<string, { name: string; exchange: string }> = {
  '000001': { name: '上证指数', exchange: 'SH' },
  '000016': { name: '上证50', exchange: 'SH' },
  '000300': { name: '沪深300', exchange: 'SH' },
  '000688': { name: '科创50', exchange: 'SH' },
  '000852': { name: '中证1000', exchange: 'SH' },
  '000905': { name: '中证500', exchange: 'SH' },
  '000903': { name: '中证100', exchange: 'SH' },
  '399001': { name: '深证成指', exchange: 'SZ' },
  '399005': { name: '中小板指', exchange: 'SZ' },
  '399006': { name: '创业板指', exchange: 'SZ' },
  '399102': { name: '创业板综', exchange: 'SZ' },
  '399330': { name: '深证100', exchange: 'SZ' },
  '399905': { name: '深证成指', exchange: 'SZ' },
  '399971': { name: '中证传媒', exchange: 'SZ' },
  '399975': { name: '中证全指证券公司', exchange: 'SZ' },
  '399808': { name: '中证新能源', exchange: 'SZ' },
  '399967': { name: '中证军工', exchange: 'SZ' },
  '399986': { name: '中证银行', exchange: 'SZ' },
  '399989': { name: '中证医疗', exchange: 'SZ' },
  '399997': { name: '中证白酒', exchange: 'SZ' },
  '000827': { name: '中证环保', exchange: 'SH' },
  '000932': { name: '中证主要消费', exchange: 'SH' },
  '000979': { name: '有色金属', exchange: 'SH' },
  '000022': { name: '中证基建', exchange: 'SH' },
}

// 港股指数代码映射（Yahoo Finance格式）
const HK_INDEX_CODES: Record<string, { yahoo: string; name: string }> = {
  'HSI': { yahoo: '^HSI', name: '恒生指数' },
  '恒生指数': { yahoo: '^HSI', name: '恒生指数' },
  '恒指': { yahoo: '^HSI', name: '恒生指数' },
  'HSSTECH': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  '恒生科技': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  '恒生科技指数': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  'HSTECH': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  'HSTECHI': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  'CEI': { yahoo: '^CEI', name: '国企指数' },
  '国企指数': { yahoo: '^CEI', name: '国企指数' },
  '恒生国企': { yahoo: '^CEI', name: '国企指数' },
}

// 美股指数代码映射（Yahoo Finance格式）
const US_INDEX_CODES: Record<string, { yahoo: string; name: string }> = {
  'NDX': { yahoo: '^NDX', name: '纳斯达克100指数' },
  '纳斯达克100': { yahoo: '^NDX', name: '纳斯达克100指数' },
  '纳指100': { yahoo: '^NDX', name: '纳斯达克100指数' },
  'NASDAQ100': { yahoo: '^NDX', name: '纳斯达克100指数' },
  'GSPC': { yahoo: '^GSPC', name: '标普500指数' },
  'SPX': { yahoo: '^GSPC', name: '标普500指数' },
  '标普500': { yahoo: '^GSPC', name: '标普500指数' },
  '标普': { yahoo: '^GSPC', name: '标普500指数' },
  'S&P500': { yahoo: '^GSPC', name: '标普500指数' },
  'DJI': { yahoo: '^DJI', name: '道琼斯指数' },
  '道琼斯': { yahoo: '^DJI', name: '道琼斯指数' },
  'DJA': { yahoo: '^DJI', name: '道琼斯指数' },
  'RUT': { yahoo: '^RUT', name: '罗素2000指数' },
  '罗素2000': { yahoo: '^RUT', name: '罗素2000指数' },
  'VIX': { yahoo: '^VIX', name: '波动率指数' },
  'IXIC': { yahoo: '^IXIC', name: '纳斯达克综合指数' },
  '纳斯达克': { yahoo: '^IXIC', name: '纳斯达克综合指数' },
}

// 合并所有指数映射（包括A股指数的中文别名）
const ALL_INDEX_CODES: Record<string, { yahoo?: string; name: string; market: Market }> = {
  ...Object.fromEntries(Object.entries(HK_INDEX_CODES).map(([k, v]) => [k, { ...v, market: 'HK' as Market }])),
  ...Object.fromEntries(Object.entries(US_INDEX_CODES).map(([k, v]) => [k, { ...v, market: 'US' as Market }])),
  // A股指数别名映射（用于名称识别，实际行情用TickFlow）
  '上证指数': { name: '上证指数', market: 'A' },
  '上证50': { name: '上证50', market: 'A' },
  '沪深300': { name: '沪深300', market: 'A' },
  '科创50': { name: '科创50', market: 'A' },
  '中证500': { name: '中证500', market: 'A' },
  '中证1000': { name: '中证1000', market: 'A' },
  '创业板指': { name: '创业板指', market: 'A' },
  '深证成指': { name: '深证成指', market: 'A' },
  '中证白酒': { name: '中证白酒', market: 'A' },
  '中证医疗': { name: '中证医疗', market: 'A' },
  '中证军工': { name: '中证军工', market: 'A' },
  '中证银行': { name: '中证银行', market: 'A' },
  '中证新能源': { name: '中证新能源', market: 'A' },
}

/**
 * 解析代码，识别市场和证券类型
 */
function parseCode(input: string): CodeInfo {
  const trimmed = input.trim().toUpperCase()
  const result: CodeInfo = {
    original: input,
    code: trimmed,
    market: 'A',
    type: 'stock',
    formatted: {},
  }

  // 1. 带后缀格式解析
  // A股后缀
  if (trimmed.endsWith('.SH') || trimmed.endsWith('.SZ')) {
    result.code = trimmed.replace(/\.(SH|SZ)$/, '')
    result.market = 'A'
    result.exchange = trimmed.slice(-2)
    result.type = getAStockType(result.code)
    result.formatted.tickflow = `${result.code}.${result.exchange}`
    result.formatted.eastmoney = `${result.exchange === 'SH' ? '1' : '0'}.${result.code}`
    result.formatted.sina = `${result.exchange.toLowerCase()}${result.code}`
    // Yahoo Finance格式: 上交所.SS, 深交所.SZ
    result.formatted.yahoo = `${result.code}.${result.exchange === 'SH' ? 'SS' : 'SZ'}`
    return result
  }

  // 港股后缀
  if (trimmed.endsWith('.HK')) {
    result.code = trimmed.replace('.HK', '').padStart(5, '0')
    result.market = 'HK'
    result.type = getHKStockType(result.code)
    result.formatted.tickflow = `${result.code}.HK`
    result.formatted.yahoo = `${parseInt(result.code)}.HK`
    return result
  }

  // 美股后缀
  if (trimmed.endsWith('.US')) {
    result.code = trimmed.replace('.US', '')
    result.market = 'US'
    result.type = 'stock'
    result.formatted.tickflow = `${result.code}.US`
    result.formatted.yahoo = result.code
    return result
  }

  // 2. 检查是否是指数名称
  if (ALL_INDEX_CODES[trimmed]) {
    const indexInfo = ALL_INDEX_CODES[trimmed]
    result.market = indexInfo.market
    result.type = 'index'
    
    // 港股/美股指数使用Yahoo Finance
    if (indexInfo.yahoo) {
      result.code = indexInfo.yahoo
      result.formatted.yahoo = indexInfo.yahoo
    } else {
      // A股指数，查找对应代码
      const aIndexEntry = Object.entries(A_INDEX_CODES).find(([_, v]) => v.name === indexInfo.name)
      if (aIndexEntry) {
        result.code = aIndexEntry[0]
        result.exchange = aIndexEntry[1].exchange
        result.formatted.tickflow = `${result.code}.${result.exchange}`
      }
    }
    return result
  }

  // 3. 检查是否是Yahoo格式的指数代码（^开头）
  if (trimmed.startsWith('^')) {
    if (trimmed.includes('HS') || trimmed.includes('CEI')) {
      result.market = 'HK'
    } else {
      result.market = 'US'
    }
    result.type = 'index'
    result.formatted.yahoo = trimmed
    return result
  }

  // 4. 纯数字格式
  if (/^\d+$/.test(trimmed)) {
    // A股LOF基金（16开头或50开头，必须是6位）
    if (trimmed.length === 6 && (trimmed.startsWith('16') || trimmed.startsWith('50'))) {
      result.market = 'A'
      result.type = 'lof'
      result.exchange = trimmed.startsWith('16') ? 'SZ' : 'SH'
      result.formatted.eastmoney = `0.${trimmed}`
      result.formatted.sina = `${result.exchange.toLowerCase()}${trimmed}`
      result.formatted.tickflow = `${trimmed}.${result.exchange}`
      return result
    }

    // A股指数（已知指数代码，优先判断）
    if (A_INDEX_CODES[trimmed]) {
      result.market = 'A'
      result.type = 'index'
      result.exchange = A_INDEX_CODES[trimmed].exchange
      result.formatted.tickflow = `${trimmed}.${result.exchange}`
      result.formatted.eastmoney = `${result.exchange === 'SH' ? '1' : '0'}.${trimmed}`
      // Yahoo Finance格式: 上交所.SS, 深交所.SZ
      result.formatted.yahoo = `${trimmed}.${result.exchange === 'SH' ? 'SS' : 'SZ'}`
      return result
    }

    // A股（6位数字）
    if (trimmed.length === 6) {
      result.market = 'A'
      result.type = getAStockType(trimmed)
      result.exchange = getAExchange(trimmed)
      result.formatted.tickflow = `${trimmed}.${result.exchange}`
      result.formatted.eastmoney = `${result.exchange === 'SH' ? '1' : '0'}.${trimmed}`
      result.formatted.sina = `${result.exchange.toLowerCase()}${trimmed}`
      // Yahoo Finance格式: 上交所.SS, 深交所.SZ
      result.formatted.yahoo = `${trimmed}.${result.exchange === 'SH' ? 'SS' : 'SZ'}`
      return result
    }

    // 港股（4-5位数字，非6位）
    if (trimmed.length === 4 || trimmed.length === 5) {
      result.code = trimmed.padStart(5, '0')
      result.market = 'HK'
      result.type = getHKStockType(result.code)
      result.formatted.tickflow = `${result.code}.HK`
      result.formatted.yahoo = `${parseInt(result.code)}.HK`
      return result
    }

    return result
  }

  // 5. 纯字母格式（美股）
  if (/^[A-Z]+$/.test(trimmed)) {
    // 检查是否是指数代码
    if (ALL_INDEX_CODES[trimmed]) {
      const indexInfo = ALL_INDEX_CODES[trimmed]
      result.market = indexInfo.market
      result.type = 'index'
      result.code = indexInfo.yahoo || trimmed
      result.formatted.yahoo = indexInfo.yahoo
      return result
    }

    // 美股股票/ETF
    result.market = 'US'
    result.type = trimmed.length <= 4 ? 'stock' : 'etf'
    result.formatted.tickflow = `${trimmed}.US`
    result.formatted.yahoo = trimmed
    return result
  }

  return result
}

/**
 * 判断A股股票类型
 */
function getAStockType(code: string): SecurityType {
  // 指数
  if (code.startsWith('000') || code.startsWith('399') || code.startsWith('880') || code.startsWith('9')) {
    return 'index'
  }
  // 科创板
  if (code.startsWith('688')) {
    return 'stock'
  }
  // 创业板
  if (code.startsWith('300') || code.startsWith('301')) {
    return 'stock'
  }
  return 'stock'
}

/**
 * 判断A股交易所
 */
function getAExchange(code: string): string {
  if (code.startsWith('6') || code.startsWith('9') || code.startsWith('000') || code.startsWith('880') || code.startsWith('688')) {
    return 'SH'
  }
  return 'SZ'
}

/**
 * 判断港股类型
 */
function getHKStockType(code: string): SecurityType {
  // 常见港股ETF代码
  const hkETFs = ['2800', '2828', '3033', '3046', '3067', '3096', '3110', '7300', '8300', '83100']
  if (hkETFs.includes(code)) {
    return 'etf'
  }
  // 指数相关代码
  if (code.startsWith('HS')) {
    return 'index'
  }
  return 'stock'
}

// ============================================================
// 数据源API模块
// ============================================================

/**
 * TickFlow API 请求
 */
async function tickflowFetch(endpoint: string, params: Record<string, string>): Promise<unknown> {
  if (!TICKFLOW_API_KEY) {
    console.warn('TickFlow API密钥未配置，跳过请求')
    return null
  }
  const url = new URL(`${TICKFLOW_BASE_URL}${endpoint}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value)
  })

  try {
    const response = await fetch(url.toString(), {
      headers: { 'X-API-Key': TICKFLOW_API_KEY, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      console.error(`TickFlow API错误: ${response.status}`)
      return null
    }

    return await response.json()
  } catch (error) {
    console.error('TickFlow API请求失败:', error)
    return null
  }
}

/**
 * Yahoo Finance 获取行情
 */
async function getYahooQuote(symbol: string): Promise<QuoteData | null> {
  return serverCache.getOrFetch(
    'yahoo_quote',
    async () => {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`
        const response = await fetch(url, {
          headers: YAHOO_HEADERS,
          signal: AbortSignal.timeout(15000),
        })

        if (!response.ok) return null

        const result = await response.json()
        
        if (result?.chart?.result?.[0]) {
          const chartData = result.chart.result[0]
          const meta = chartData.meta || {}
          const quote = chartData.indicators?.quote?.[0]
          
          let currentPrice: number | null = null
          let prevClose: number | null = null
          let changePercent: number | null = null

          if (quote?.close && quote.close.length >= 2) {
            currentPrice = quote.close[quote.close.length - 1]
            prevClose = quote.close[quote.close.length - 2]
            changePercent = prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : null
          } else if (quote?.close && quote.close.length === 1) {
            currentPrice = quote.close[0]
            prevClose = meta.chartPreviousClose
            changePercent = prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : null
          }

          // 判断市场
          let market: Market = 'US'
          if (symbol.includes('.HK') || meta.exchange === 'HKG') {
            market = 'HK'
          } else if (meta.exchange === 'SHH' || meta.exchange === 'SHZ') {
            market = 'A'
          }

          return {
            code: symbol,
            name: meta.shortName || meta.longName || symbol,
            price: currentPrice,
            change: currentPrice && prevClose ? currentPrice - prevClose : null,
            change_percent: changePercent ? Math.round(changePercent * 100) / 100 : null,
            open: quote?.open?.[quote.open.length - 1] || null,
            high: quote?.high?.[quote.high.length - 1] || null,
            low: quote?.low?.[quote.low.length - 1] || null,
            prev_close: prevClose,
            volume: quote?.volume?.[quote.volume.length - 1] || null,
            source: 'Yahoo Finance',
            market,
            type: symbol.startsWith('^') ? 'index' : 'stock',
          }
        }

        return null
      } catch (error) {
        console.error('Yahoo Finance API请求失败:', error)
        return null
      }
    },
    { forceRefresh: false, keyParts: [symbol] }
  )
}

/**
 * Yahoo Finance 获取K线
 */
async function getYahooKline(symbol: string, count: number = 30): Promise<KlineItem[]> {
  return serverCache.getOrFetch(
    'yahoo_kline',
    async () => {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${count + 5}d`
        const response = await fetch(url, {
          headers: YAHOO_HEADERS,
          signal: AbortSignal.timeout(15000),
        })

        if (!response.ok) return []

        const result = await response.json()
        
        if (result?.chart?.result?.[0]) {
          const chartData = result.chart.result[0]
          const quote = chartData.indicators?.quote?.[0]
          const timestamps = chartData.timestamp || []
          
          if (quote?.close && timestamps.length > 0) {
            const klines: KlineItem[] = []
            
            for (let i = 0; i < timestamps.length; i++) {
              const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0]
              const prevClose = i > 0 ? quote.close[i - 1] : null
              const currentClose = quote.close[i]
              const changePercent = prevClose && currentClose ? ((currentClose - prevClose) / prevClose) * 100 : null
              
              klines.push({
                date,
                open: quote.open?.[i] || null,
                close: currentClose || null,
                high: quote.high?.[i] || null,
                low: quote.low?.[i] || null,
                volume: quote.volume?.[i] || null,
                change_percent: changePercent ? Math.round(changePercent * 100) / 100 : null,
              })
            }
            
            return klines.slice(-count)
          }
        }

        return []
      } catch (error) {
        console.error('Yahoo Finance K线请求失败:', error)
        return []
      }
    },
    { forceRefresh: false, keyParts: [symbol, String(count)] }
  )
}

/**
 * TickFlow 获取行情
 */
async function getTickflowQuote(symbol: string, codeInfo: CodeInfo): Promise<QuoteData | null> {
  return serverCache.getOrFetch(
    'tickflow_quote',
    async () => {
      const result = await tickflowFetch('/quotes', { symbols: symbol }) as {
        data?: Array<{
          symbol: string
          last_price: number
          prev_close: number
          open: number
          high: number
          low: number
          volume: number
          amount: number
          timestamp: number
          ext?: {
            name: string
            change_pct: number
            change_amount: number
          }
        }>
      }

      if (result?.data?.[0]) {
        const d = result.data[0]
        return {
          code: codeInfo.code,
          name: d.ext?.name || '',
          price: d.last_price,
          change: d.ext?.change_amount || null,
          change_percent: d.ext?.change_pct ? d.ext.change_pct * 100 : null,
          open: d.open || null,
          high: d.high || null,
          low: d.low || null,
          prev_close: d.prev_close || null,
          volume: d.volume || null,
          source: 'TickFlow',
          market: codeInfo.market,
          type: codeInfo.type,
        }
      }

      return null
    },
    { forceRefresh: false, keyParts: [symbol] }
  )
}

/**
 * TickFlow 获取K线
 */
async function getTickflowKline(symbol: string, count: number = 30): Promise<KlineItem[]> {
  return serverCache.getOrFetch(
    'tickflow_kline',
    async () => {
      const result = await tickflowFetch('/klines', {
        symbol: symbol,
        interval: '1d',
        limit: String(count)
      }) as {
        data?: {
          timestamp: number[]
          open: number[]
          high: number[]
          low: number[]
          close: number[]
          volume: number[]
        }
      }

      if (result?.data?.timestamp?.length) {
        const d = result.data
        const klines: KlineItem[] = []
        
        for (let i = 0; i < d.timestamp.length; i++) {
          const date = new Date(d.timestamp[i]).toISOString().split('T')[0]
          const prevClose = i > 0 ? d.close[i - 1] : null
          const changePercent = prevClose && d.close[i] 
            ? ((d.close[i] - prevClose) / prevClose) * 100 
            : null

          klines.push({
            date,
            open: d.open[i] || null,
            close: d.close[i] || null,
            high: d.high[i] || null,
            low: d.low[i] || null,
            volume: d.volume[i] || null,
            change_percent: changePercent,
          })
        }

        return klines
      }

      return []
    },
    { forceRefresh: false, keyParts: [symbol, String(count)] }
  )
}

/**
 * 东方财富 获取LOF行情
 */
async function getEMLOFQuote(fundCode: string): Promise<QuoteData | null> {
  return serverCache.getOrFetch(
    'em_lof_quote',
    async () => {
      try {
        const url = `https://push2delay.eastmoney.com/api/qt/stock/get?secid=0.${fundCode}&fields=f43,f57,f58,f170,f46,f44,f45,f47,f48,f50`
        const response = await fetch(url, {
          headers: EM_HEADERS,
          signal: AbortSignal.timeout(15000),
        })

        if (!response.ok) return null

        const result = await response.json()
        
        if (result?.data) {
          const d = result.data
          // LOF价格需要除以1000
          return {
            code: fundCode,
            name: d.f58 || '',
            price: d.f43 ? d.f43 / 1000 : null,
            change: d.f43 && d.f46 ? (d.f43 - d.f46) / 1000 : null,
            change_percent: d.f170 ? d.f170 / 100 : null,
            open: d.f44 ? d.f44 / 1000 : null,
            high: d.f45 ? d.f45 / 1000 : null,
            low: d.f47 ? d.f47 / 1000 : null,
            prev_close: d.f46 ? d.f46 / 1000 : null,
            volume: d.f48 || null,
            source: '东财API',
            market: 'A',
            type: 'lof',
          }
        }

        return null
      } catch (error) {
        console.error('东财LOF行情请求失败:', error)
        return null
      }
    },
    { forceRefresh: false, keyParts: [fundCode] }
  )
}

/**
 * 新浪 获取LOF K线
 */
async function getSinaLOFKline(fundCode: string, count: number = 30): Promise<KlineItem[]> {
  return serverCache.getOrFetch(
    'sina_lof_kline',
    async () => {
      try {
        const market = fundCode.startsWith('16') ? 'sz' : 'sh'
        const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${market}${fundCode}&scale=240&ma=no&datalen=${count}`
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(15000),
        })

        if (!response.ok) return []

        const result = await response.json()
        
        if (Array.isArray(result) && result.length > 0) {
          const klines: KlineItem[] = []
          
          for (let i = 0; i < result.length; i++) {
            const item = result[i]
            const prevClose = i > 0 ? parseFloat(result[i - 1].close) : null
            const currentClose = parseFloat(item.close)
            const changePercent = prevClose && currentClose ? ((currentClose - prevClose) / prevClose) * 100 : null
            
            klines.push({
              date: item.day,
              open: parseFloat(item.open) || null,
              close: currentClose || null,
              high: parseFloat(item.high) || null,
              low: parseFloat(item.low) || null,
              volume: parseFloat(item.volume) || null,
              change_percent: changePercent ? Math.round(changePercent * 100) / 100 : null,
            })
          }
          
          return klines
        }

        return []
      } catch (error) {
        console.error('新浪K线请求失败:', error)
        return []
      }
    },
    { forceRefresh: false, keyParts: [fundCode, String(count)] }
  )
}

// ============================================================
// 统一行情获取接口
// ============================================================

/**
 * 获取行情数据（自动选择数据源）
 */
async function getQuote(codeInfo: CodeInfo): Promise<{ data: QuoteData | null; source: string }> {
  const { market, type, formatted } = codeInfo

  // LOF基金：使用东方财富API
  if (type === 'lof') {
    const data = await getEMLOFQuote(codeInfo.code)
    return { data, source: data?.source || '东财API' }
  }

  // 港股/美股指数：使用Yahoo Finance
  if (type === 'index' && (market === 'HK' || market === 'US')) {
    const yahooSymbol = formatted.yahoo || codeInfo.code
    const data = await getYahooQuote(yahooSymbol)
    return { data, source: data?.source || 'Yahoo Finance' }
  }

  // A股指数/股票：优先Yahoo Finance，失败则TickFlow
  if (market === 'A') {
    // 优先使用Yahoo Finance
    if (formatted.yahoo) {
      const data = await getYahooQuote(formatted.yahoo)
      if (data) {
        return { data, source: 'Yahoo Finance' }
      }
    }
    // Yahoo失败，尝试TickFlow
    if (formatted.tickflow) {
      const data = await getTickflowQuote(formatted.tickflow, codeInfo)
      if (data) {
        return { data, source: 'TickFlow' }
      }
    }
    return { data: null, source: 'none' }
  }

  // 港股：优先Yahoo Finance，失败则TickFlow
  if (market === 'HK') {
    if (formatted.yahoo) {
      const data = await getYahooQuote(formatted.yahoo)
      if (data) {
        return { data, source: 'Yahoo Finance' }
      }
    }
    if (formatted.tickflow) {
      const data = await getTickflowQuote(formatted.tickflow, codeInfo)
      if (data) {
        return { data, source: 'TickFlow' }
      }
    }
    return { data: null, source: 'none' }
  }

  // 美股：优先Yahoo Finance，失败则TickFlow
  if (market === 'US') {
    if (formatted.yahoo) {
      const data = await getYahooQuote(formatted.yahoo)
      if (data) {
        return { data, source: 'Yahoo Finance' }
      }
    }
    if (formatted.tickflow) {
      const data = await getTickflowQuote(formatted.tickflow, codeInfo)
      if (data) {
        return { data, source: 'TickFlow' }
      }
    }
    return { data: null, source: 'none' }
  }

  return { data: null, source: 'none' }
}

/**
 * 获取K线数据（自动选择数据源）
 * 优先级：Yahoo Finance → TickFlow
 */
async function getKline(codeInfo: CodeInfo, count: number = 30): Promise<{ data: KlineItem[]; source: string }> {
  const { market, type, formatted } = codeInfo

  // LOF基金：使用新浪API
  if (type === 'lof') {
    const data = await getSinaLOFKline(codeInfo.code, count)
    return { data, source: '新浪API' }
  }

  // 港股/美股指数：使用Yahoo Finance
  if (type === 'index' && (market === 'HK' || market === 'US')) {
    const yahooSymbol = formatted.yahoo || codeInfo.code
    const data = await getYahooKline(yahooSymbol, count)
    return { data, source: 'Yahoo Finance' }
  }

  // A股：优先Yahoo Finance，失败则TickFlow
  if (market === 'A') {
    if (formatted.yahoo) {
      const data = await getYahooKline(formatted.yahoo, count)
      if (data.length > 0) {
        return { data, source: 'Yahoo Finance' }
      }
    }
    if (formatted.tickflow) {
      const data = await getTickflowKline(formatted.tickflow, count)
      if (data.length > 0) {
        return { data, source: 'TickFlow' }
      }
    }
    return { data: [], source: 'none' }
  }

  // 港股/美股：优先Yahoo Finance，失败则TickFlow
  if (formatted.yahoo) {
    const data = await getYahooKline(formatted.yahoo, count)
    if (data.length > 0) {
      return { data, source: 'Yahoo Finance' }
    }
  }

  if (formatted.tickflow) {
    const data = await getTickflowKline(formatted.tickflow, count)
    if (data.length > 0) {
      return { data, source: 'TickFlow' }
    }
  }

  return { data: [], source: 'none' }
}

// ============================================================
// LOF净值数据（保持原有功能）
// ============================================================

async function emFetch(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: EM_HEADERS,
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

interface NavHistoryItem {
  date: string
  nav: number | null
  accumulated_nav: number | null
}

async function getEMFundNavHistory(fundCode: string, count: number = 30): Promise<{ data: NavHistoryItem[]; source: string }> {
  return serverCache.getOrFetch(
    'nav',
    async () => {
      const url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${fundCode}&page=1&sdate=&edate=&per=${count}`
      const html = await emFetch(url)

      if (!html) {
        return { data: [], source: '东财API' }
      }

      const pattern = /<td>(\d{4}-\d{2}-\d{2})<\/td>\s*<td[^>]*>([\d.]+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>/g
      const result: NavHistoryItem[] = []
      let match

      while ((match = pattern.exec(html)) !== null) {
        result.push({
          date: match[1],
          nav: parseFloat(match[2]) || null,
          accumulated_nav: parseFloat(match[3]) || null,
        })
      }

      return { data: result, source: '东财API' }
    },
    { forceRefresh: false, keyParts: [fundCode, String(count)] }
  )
}

// ============================================================
// LOF配置（保持原有功能）
// ============================================================

interface IndexConfig {
  index_code: string
  index_name: string
  coefficient: number
  is_manual?: boolean
  manual_change_percent?: number
}

interface LOFConfig {
  indices: IndexConfig[]
}

const DEFAULT_LOF_CONFIG: Record<string, LOFConfig> = {
  '161725': { indices: [{ index_code: '399997', index_name: '中证白酒', coefficient: 0.95 }] },
  '161118': { indices: [{ index_code: '000932', index_name: '中证主要消费', coefficient: 0.95 }] },
  '161035': { indices: [{ index_code: '399989', index_name: '中证医疗', coefficient: 0.95 }] },
  '161122': { indices: [{ index_code: '399989', index_name: '中证医疗', coefficient: 0.95 }] },
  '161028': { indices: [{ index_code: '399808', index_name: '中证新能源', coefficient: 0.95 }] },
  '161024': { indices: [{ index_code: '399967', index_name: '中证军工', coefficient: 0.95 }] },
  '161720': { indices: [{ index_code: '399975', index_name: '中证全指证券公司', coefficient: 0.95 }] },
  '161723': { indices: [{ index_code: '399986', index_name: '中证银行', coefficient: 0.95 }] },
  '161038': { indices: [{ index_code: '000827', index_name: '中证环保', coefficient: 0.95 }] },
  '161726': { indices: [{ index_code: '000022', index_name: '中证基建', coefficient: 0.95 }] },
  '160620': { indices: [{ index_code: '000979', index_name: '有色金属', coefficient: 0.95 }] },
  '161632': { indices: [{ index_code: '399994', index_name: '信息安全', coefficient: 0.95 }] },
  '161729': { indices: [{ index_code: '399971', index_name: '中证传媒', coefficient: 0.95 }] },
  '161116': { indices: [{ index_code: 'AU9999', index_name: '黄金现货', coefficient: 0.99 }] },
  '161811': { indices: [{ index_code: '000300', index_name: '沪深300', coefficient: 0.95 }] },
  '161717': { indices: [{ index_code: '000905', index_name: '中证500', coefficient: 0.95 }] },
  '161913': { indices: [{ index_code: '399006', index_name: '创业板指', coefficient: 0.95 }] },
  '161831': { indices: [{ index_code: 'HSI', index_name: '恒生指数', coefficient: 0.95 }] },
  '160125': { indices: [{ index_code: 'HSI', index_name: '恒生指数', coefficient: 0.95 }] },
  '160323': { indices: [{ index_code: 'HSI', index_name: '恒生指数', coefficient: 0.95 }] },
  '161130': { indices: [{ index_code: 'NDX', index_name: '纳斯达克100', coefficient: 0.95 }] },
  '160140': { indices: [{ index_code: 'GSPC', index_name: '标普500', coefficient: 0.95 }] },
  '160416': { indices: [{ index_code: 'GSPC', index_name: '标普500', coefficient: 0.95 }] },
  '160723': { indices: [{ index_code: 'NDX', index_name: '纳斯达克100', coefficient: 0.95 }] },
  '160930': { indices: [{ index_code: 'GSPC', index_name: '标普500', coefficient: 0.95 }] },
}

function getLOFConfig(fundCode: string, customConfig: Record<string, LOFConfig> | null): LOFConfig {
  if (customConfig && customConfig[fundCode]) {
    return customConfig[fundCode]
  }
  return DEFAULT_LOF_CONFIG[fundCode] || { indices: [{ index_code: '', index_name: '未知', coefficient: 0.95 }] }
}

function getYesterdayNav(navHistory: NavHistoryItem[]): {
  prevNav: number | null
  prevNavDate: string | null
  todayNav: number | null
  todayNavDate: string | null
  navUpdatedToday: boolean
} {
  if (!navHistory || navHistory.length === 0) {
    return { prevNav: null, prevNavDate: null, todayNav: null, todayNavDate: null, navUpdatedToday: false }
  }

  const today = new Date().toISOString().split('T')[0]
  const latest = navHistory[0]

  if (latest.date === today) {
    const todayNav = latest.nav
    const todayNavDate = latest.date
    if (navHistory.length > 1) {
      const prev = navHistory[1]
      return { prevNav: prev.nav, prevNavDate: prev.date, todayNav, todayNavDate, navUpdatedToday: true }
    }
    return { prevNav: null, prevNavDate: null, todayNav, todayNavDate, navUpdatedToday: true }
  }

  return { prevNav: latest.nav, prevNavDate: latest.date, todayNav: null, todayNavDate: null, navUpdatedToday: false }
}

// ============================================================
// API处理函数
// ============================================================

async function getSingleData(code: string, customConfig: Record<string, LOFConfig> | null, _forceRefresh: boolean = false) {
  if (!code) {
    return { code: '', error: '请提供代码' }
  }

  const codeInfo = parseCode(code)
  const isLOF = codeInfo.type === 'lof'

  try {
    // 非LOF代码：直接获取行情
    if (!isLOF) {
      const { data: quote, source } = await getQuote(codeInfo)

      if (!quote || !quote.name) {
        return {
          code: codeInfo.code,
          error: '无法获取该代码的行情数据',
          market: codeInfo.market,
          type: codeInfo.type,
        }
      }

      return {
        code: codeInfo.code,
        original_code: codeInfo.original,
        name: quote.name,
        price: quote.price,
        change: quote.change,
        change_percent: quote.change_percent,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        prev_close: quote.prev_close,
        volume: quote.volume,
        prev_nav: null,
        prev_nav_date: null,
        today_nav: null,
        today_nav_date: null,
        nav_updated_today: false,
        indices: [],
        total_index_change: null,
        estimated_nav: null,
        premium: null,
        estimation_error: null,
        data_sources: { quote: source, nav: 'none' },
        market: codeInfo.market,
        type: codeInfo.type,
        is_lof: false,
      }
    }

    // LOF代码：获取净值和计算折溢价
    const config = getLOFConfig(codeInfo.code, customConfig)
    const indices = config.indices

    // 获取LOF行情
    const { data: quote, source: quoteSource } = await getQuote(codeInfo)

    if (!quote || !quote.name) {
      return {
        code: codeInfo.code,
        original_code: codeInfo.original,
        error: '无法获取该LOF基金的数据',
      }
    }

    const fundName = quote.name

    // 获取净值历史
    const { data: navHistory, source: navSource } = await getEMFundNavHistory(codeInfo.code, 10)
    const { prevNav, prevNavDate, todayNav, todayNavDate, navUpdatedToday } = getYesterdayNav(navHistory)

    // 获取所有追踪指数的行情
    const indicesData = []
    for (const idx of indices) {
      const indexCode = idx.index_code
      const coefficient = idx.coefficient || 0.95
      const manualChange = idx.manual_change_percent
      const isManual = idx.is_manual || false

      if (isManual && manualChange !== undefined) {
        indicesData.push({
          index_code: indexCode || 'MANUAL',
          index_name: idx.index_name || '手动输入',
          coefficient,
          change_percent: manualChange,
          source: 'manual',
          is_manual: true,
        })
      } else if (indexCode) {
        const indexCodeInfo = parseCode(indexCode)
        const { data: indexQuote, source: indexSource } = await getQuote(indexCodeInfo)
        
        indicesData.push({
          index_code: indexCode,
          index_name: idx.index_name || indexQuote?.name || '',
          coefficient,
          change_percent: indexQuote?.change_percent ?? null,
          source: indexSource,
          is_manual: false,
        })
      } else {
        indicesData.push({
          index_code: indexCode,
          index_name: idx.index_name || '',
          coefficient,
          change_percent: null,
          source: 'invalid',
          is_manual: false,
        })
      }
    }

    // 计算估算净值
    let estimatedNav: number | null = null
    let totalChange = 0
    if (prevNav) {
      const validIndices = indicesData.filter((i: { change_percent: number | null }) => i.change_percent !== null)
      if (validIndices.length > 0) {
        for (const idx of validIndices) {
          totalChange += idx.change_percent! * idx.coefficient
        }
        estimatedNav = prevNav * (1 + totalChange / 100)
      }
    }

    // 计算估算溢价
    let premium: number | null = null
    if (quote.price && estimatedNav && estimatedNav > 0) {
      premium = (quote.price - estimatedNav) / estimatedNav * 100
    }

    // 计算估值误差
    let estimationError: number | null = null
    if (navUpdatedToday && todayNav && estimatedNav) {
      estimationError = (todayNav - estimatedNav) / estimatedNav * 100
    }

    return {
      code: codeInfo.code,
      original_code: codeInfo.original,
      name: fundName,
      price: quote.price,
      change: quote.change,
      change_percent: quote.change_percent,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      prev_close: quote.prev_close,
      volume: quote.volume,
      prev_nav: prevNav,
      prev_nav_date: prevNavDate,
      today_nav: todayNav,
      today_nav_date: todayNavDate,
      nav_updated_today: navUpdatedToday,
      indices: indicesData,
      total_index_change: totalChange || null,
      estimated_nav: estimatedNav ? Math.round(estimatedNav * 10000) / 10000 : null,
      premium: premium ? Math.round(premium * 100) / 100 : null,
      estimation_error: estimationError ? Math.round(estimationError * 100) / 100 : null,
      data_sources: { quote: quoteSource, nav: navSource },
      market: codeInfo.market,
      type: codeInfo.type,
      is_lof: true,
    }
  } catch (error) {
    return { code: codeInfo.code, original_code: codeInfo.original, error: String(error) }
  }
}

async function getBatchData(codes: string[], customConfig: Record<string, LOFConfig> | null, forceRefresh: boolean = false) {
  const results = []
  for (const code of codes) {
    const data = await getSingleData(code, customConfig, forceRefresh)
    results.push(data)
  }
  return results
}

async function getHistoryData(code: string, customConfig: Record<string, LOFConfig> | null, _forceRefresh: boolean = false) {
  if (!code) {
    return { error: '请提供代码' }
  }

  try {
    const codeInfo = parseCode(code)
    const isLOF = codeInfo.type === 'lof'

    // 获取价格K线
    const { data: klineData, source: klineSource } = await getKline(codeInfo, 30)

    // 非LOF代码：只返回价格K线
    if (!isLOF) {
      const history = klineData.map(item => ({
        date: item.date,
        nav: null,
        accumulated_nav: null,
        price: item.close,
        premium: null,
        index_change: null,
        estimated_nav: null,
        estimation_error: null,
      }))

      return {
        code: codeInfo.code,
        original_code: codeInfo.original,
        name: null,
        index_name: '',
        coefficient: 1.0,
        history,
        market: codeInfo.market,
        type: codeInfo.type,
        is_lof: false,
        data_sources: { nav: 'none', kline: klineSource },
      }
    }

    // LOF代码：获取完整数据
    const config = getLOFConfig(codeInfo.code, customConfig)
    const indices = config.indices
    const firstIndex = indices[0] || {}

    // 获取净值历史
    const { data: navHistory, source: navSource } = await getEMFundNavHistory(codeInfo.code, 35)

    // 获取第一个指数的K线
    let indexKline: KlineItem[] = []
    const indexCode = firstIndex.index_code
    const coefficient = firstIndex.coefficient || 0.95
    const isManual = firstIndex.is_manual || false

    if (!isManual && indexCode) {
      const indexCodeInfo = parseCode(indexCode)
      const { data } = await getKline(indexCodeInfo, 35)
      indexKline = data
    }

    // 创建日期索引
    const navByDate: Record<string, NavHistoryItem> = {}
    for (const item of navHistory) {
      navByDate[item.date] = item
    }

    const priceByDate: Record<string, KlineItem> = {}
    for (const item of klineData) {
      priceByDate[item.date] = item
    }

    const indexByDate: Record<string, KlineItem> = {}
    for (const item of indexKline) {
      indexByDate[item.date] = item
    }

    // 合并历史数据
    const allDates = Object.keys(navByDate).sort().reverse()
    const history = []

    for (let i = 0; i < Math.min(allDates.length, 30); i++) {
      const date = allDates[i]
      const navItem = navByDate[date] || {}
      const priceItem = priceByDate[date] || {}
      const indexItem = indexByDate[date] || {}

      const nav = navItem.nav
      const price = priceItem.close
      const indexChange = indexItem.change_percent

      let premium: number | null = null
      if (nav && price) {
        premium = Math.round((price - nav) / nav * 10000) / 100
      }

      let estimatedNav: number | null = null
      let estimationError: number | null = null

      const prevDate = allDates[i + 1]
      if (prevDate && indexChange !== null) {
        const prevNav = navByDate[prevDate]?.nav
        if (prevNav) {
          estimatedNav = Math.round(prevNav * (1 + indexChange / 100 * coefficient) * 10000) / 10000
          if (nav && estimatedNav) {
            estimationError = Math.round((nav - estimatedNav) / estimatedNav * 10000) / 100
          }
        }
      }

      history.push({
        date,
        nav,
        accumulated_nav: navItem.accumulated_nav,
        price,
        premium,
        index_change: indexChange,
        estimated_nav: estimatedNav,
        estimation_error: estimationError,
      })
    }

    return {
      code: codeInfo.code,
      original_code: codeInfo.original,
      name: null,
      index_name: firstIndex.index_name || '',
      coefficient,
      history,
      market: codeInfo.market,
      type: codeInfo.type,
      is_lof: true,
      data_sources: { nav: navSource, kline: klineSource },
    }
  } catch (error) {
    return { code, error: String(error) }
  }
}

// ============================================================
// Next.js API Route Handler
// ============================================================
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const action = searchParams.get('action')
  const code = searchParams.get('code')
  const codes = searchParams.get('codes')
  const configStr = searchParams.get('config')

  let customConfig: Record<string, LOFConfig> | null = null
  if (configStr) {
    try {
      customConfig = JSON.parse(configStr)
    } catch {
      // 忽略解析错误
    }
  }

  try {
    let result

    if (action === 'batch' && codes) {
      const codeList = codes.split(',').map(c => c.trim()).filter(c => c)
      result = await getBatchData(codeList, customConfig)
    } else if (action === 'single' && code) {
      result = await getSingleData(code, customConfig)
    } else if (action === 'history' && code) {
      result = await getHistoryData(code, customConfig)
    } else if (action === 'parse' && code) {
      // 新增：代码解析接口，用于前端验证
      result = parseCode(code)
    } else {
      result = { error: '未知操作，支持: batch, single, history, parse' }
    }

    const stats = serverCache.getStats()
    const response = NextResponse.json(result)
    response.headers.set('X-Cache-Size', String(stats.size))
    response.headers.set('X-Cache-Types', JSON.stringify(stats.types))
    response.headers.set('X-Data-Source', 'TickFlow + Yahoo Finance + EastMoney')

    return response
  } catch (error) {
    return NextResponse.json(
      { error: '数据获取失败', detail: String(error) },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
