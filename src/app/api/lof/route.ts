import { NextRequest, NextResponse } from 'next/server'
import { serverCache } from '@/utils/server-cache'

// ============================================================
// 全市场行情数据API - 统一接口
// 支持：A股股票/指数、港股股票/ETF/指数、美股股票/ETF/指数、LOF基金
// 
// 数据源优先级（统一）：Yahoo Finance → TickFlow
// - Yahoo Finance: 无频率限制，覆盖全市场
// - TickFlow: 有频率限制(10次/分钟)，作为备选
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

interface NavHistoryItem {
  date: string
  nav: number | null
  accumulated_nav: number | null
}

interface StockQuote {
  code: string
  name: string
  price: number | null
  change_percent: number | null
  change: number | null
}

interface KlineItem {
  date: string
  open: number | null
  close: number | null
  high: number | null
  low: number | null
  change_percent: number | null
}

interface IndexData {
  index_code: string
  index_name: string
  coefficient: number
  change_percent: number | null
  source: string
  is_manual?: boolean
}

type Market = 'A' | 'HK' | 'US'
type SecurityType = 'stock' | 'index' | 'etf' | 'lof' | 'unknown'

interface CodeInfo {
  original: string
  code: string
  market: Market
  type: SecurityType
  exchange?: string
  formatted: {
    tickflow?: string
    yahoo?: string
    eastmoney?: string
    sina?: string
  }
}

// ============================================================
// 市场识别映射
// ============================================================
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

const HK_INDEX_CODES: Record<string, { yahoo: string; name: string }> = {
  'HSI': { yahoo: '^HSI', name: '恒生指数' },
  '恒生指数': { yahoo: '^HSI', name: '恒生指数' },
  '恒指': { yahoo: '^HSI', name: '恒生指数' },
  'HSSTECH': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  '恒生科技': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  '恒生科技指数': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  'HSTECH': { yahoo: '^HSSTECH', name: '恒生科技指数' },
  'CEI': { yahoo: '^CEI', name: '国企指数' },
  '国企指数': { yahoo: '^CEI', name: '国企指数' },
}

const US_INDEX_CODES: Record<string, { yahoo: string; name: string }> = {
  'NDX': { yahoo: '^NDX', name: '纳斯达克100指数' },
  '纳斯达克100': { yahoo: '^NDX', name: '纳斯达克100指数' },
  '纳指100': { yahoo: '^NDX', name: '纳斯达克100指数' },
  'GSPC': { yahoo: '^GSPC', name: '标普500指数' },
  'SPX': { yahoo: '^GSPC', name: '标普500指数' },
  '标普500': { yahoo: '^GSPC', name: '标普500指数' },
  '标普': { yahoo: '^GSPC', name: '标普500指数' },
  'DJI': { yahoo: '^DJI', name: '道琼斯指数' },
  '道琼斯': { yahoo: '^DJI', name: '道琼斯指数' },
  'RUT': { yahoo: '^RUT', name: '罗素2000指数' },
  'VIX': { yahoo: '^VIX', name: '波动率指数' },
  'IXIC': { yahoo: '^IXIC', name: '纳斯达克综合指数' },
  '纳斯达克': { yahoo: '^IXIC', name: '纳斯达克综合指数' },
}

const ALL_INDEX_CODES: Record<string, { yahoo?: string; name: string; market: Market }> = {
  ...Object.fromEntries(Object.entries(HK_INDEX_CODES).map(([k, v]) => [k, { ...v, market: 'HK' as Market }])),
  ...Object.fromEntries(Object.entries(US_INDEX_CODES).map(([k, v]) => [k, { ...v, market: 'US' as Market }])),
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

// ============================================================
// 代码解析
// ============================================================
function parseCode(input: string): CodeInfo {
  const trimmed = input.trim().toUpperCase()
  const result: CodeInfo = {
    original: input,
    code: trimmed,
    market: 'A',
    type: 'stock',
    formatted: {},
  }

  // A股后缀
  if (trimmed.endsWith('.SH') || trimmed.endsWith('.SZ')) {
    result.code = trimmed.replace(/\.(SH|SZ)$/, '')
    result.market = 'A'
    result.exchange = trimmed.slice(-2)
    result.type = getAStockType(result.code)
    result.formatted.tickflow = `${result.code}.${result.exchange}`
    // Yahoo Finance格式: 上交所.SS, 深交所.SZ
    result.formatted.yahoo = `${result.code}.${result.exchange === 'SH' ? 'SS' : 'SZ'}`
    return result
  }

  // 港股后缀
  if (trimmed.endsWith('.HK')) {
    result.code = trimmed.replace('.HK', '').padStart(5, '0')
    result.market = 'HK'
    result.type = 'stock'
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

  // 指数名称
  if (ALL_INDEX_CODES[trimmed]) {
    const indexInfo = ALL_INDEX_CODES[trimmed]
    result.market = indexInfo.market
    result.type = 'index'
    if (indexInfo.yahoo) {
      result.code = indexInfo.yahoo
      result.formatted.yahoo = indexInfo.yahoo
    } else {
      const aIndexEntry = Object.entries(A_INDEX_CODES).find(([_, v]) => v.name === indexInfo.name)
      if (aIndexEntry) {
        result.code = aIndexEntry[0]
        result.exchange = aIndexEntry[1].exchange
        result.formatted.tickflow = `${result.code}.${result.exchange}`
      }
    }
    return result
  }

  // Yahoo格式指数
  if (trimmed.startsWith('^')) {
    result.market = trimmed.includes('HS') || trimmed.includes('CEI') ? 'HK' : 'US'
    result.type = 'index'
    result.formatted.yahoo = trimmed
    return result
  }

  // 纯数字
  if (/^\d+$/.test(trimmed)) {
    // LOF基金
    if (trimmed.length === 6 && (trimmed.startsWith('16') || trimmed.startsWith('50'))) {
      result.market = 'A'
      result.type = 'lof'
      result.exchange = trimmed.startsWith('16') ? 'SZ' : 'SH'
      result.formatted.eastmoney = `0.${trimmed}`
      result.formatted.sina = `${result.exchange.toLowerCase()}${trimmed}`
      return result
    }
    // A股指数
    if (A_INDEX_CODES[trimmed]) {
      result.market = 'A'
      result.type = 'index'
      result.exchange = A_INDEX_CODES[trimmed].exchange
      result.formatted.tickflow = `${trimmed}.${result.exchange}`
      // Yahoo Finance格式: 上交所.SS, 深交所.SZ
      result.formatted.yahoo = `${trimmed}.${result.exchange === 'SH' ? 'SS' : 'SZ'}`
      return result
    }
    // A股股票
    if (trimmed.length === 6) {
      result.market = 'A'
      result.type = getAStockType(trimmed)
      result.exchange = getAExchange(trimmed)
      result.formatted.tickflow = `${trimmed}.${result.exchange}`
      // Yahoo Finance格式: 上交所.SS, 深交所.SZ
      result.formatted.yahoo = `${trimmed}.${result.exchange === 'SH' ? 'SS' : 'SZ'}`
      return result
    }
    // 港股
    if (trimmed.length === 4 || trimmed.length === 5) {
      result.code = trimmed.padStart(5, '0')
      result.market = 'HK'
      result.type = 'stock'
      result.formatted.tickflow = `${result.code}.HK`
      result.formatted.yahoo = `${parseInt(result.code)}.HK`
      return result
    }
    return result
  }

  // 纯字母 - 美股
  if (/^[A-Z]+$/.test(trimmed)) {
    if (ALL_INDEX_CODES[trimmed]) {
      const indexInfo = ALL_INDEX_CODES[trimmed]
      result.market = indexInfo.market
      result.type = 'index'
      if (indexInfo.yahoo) {
        result.code = indexInfo.yahoo
        result.formatted.yahoo = indexInfo.yahoo
      }
      return result
    }
    result.market = 'US'
    result.type = 'stock'
    result.formatted.tickflow = `${trimmed}.US`
    result.formatted.yahoo = trimmed
    return result
  }

  return result
}

function getAStockType(code: string): SecurityType {
  if (code.startsWith('000') && code.length === 6 && !code.startsWith('000001') && !code.startsWith('000016')) return 'stock'
  if (code.startsWith('399') || code.startsWith('880') || code.startsWith('9')) return 'index'
  return 'stock'
}

function getAExchange(code: string): string {
  if (code.startsWith('6') || code.startsWith('9') || code.startsWith('000') || code.startsWith('880') || code.startsWith('688')) return 'SH'
  return 'SZ'
}

// ============================================================
// API请求函数
// ============================================================
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
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function getYahooQuote(symbol: string): Promise<{ data: StockQuote | null; source: string }> {
  return serverCache.getOrFetch(
    'yahoo_quote',
    async () => {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`
        const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(15000) })
        if (!response.ok) return { data: null, source: 'Yahoo Finance' }
        const result = await response.json()
        if (result?.chart?.result?.[0]) {
          const meta = result.chart.result[0].meta || {}
          const quote = result.chart.result[0].indicators?.quote?.[0]
          let currentPrice: number | null = null
          let prevClose: number | null = null
          let changePercent: number | null = null
          if (quote?.close && quote.close.length >= 2) {
            currentPrice = quote.close[quote.close.length - 1]
            prevClose = quote.close[quote.close.length - 2]
            changePercent = prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : null
          } else if (quote?.close?.length === 1) {
            currentPrice = quote.close[0]
            prevClose = meta.chartPreviousClose
            changePercent = prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : null
          }
          return {
            data: {
              code: symbol,
              name: meta.shortName || meta.longName || symbol,
              price: currentPrice,
              change_percent: changePercent ? Math.round(changePercent * 100) / 100 : null,
              change: currentPrice && prevClose ? currentPrice - prevClose : null,
            },
            source: 'Yahoo Finance'
          }
        }
        return { data: null, source: 'Yahoo Finance' }
      } catch {
        return { data: null, source: 'Yahoo Finance' }
      }
    },
    { forceRefresh: false, keyParts: [symbol] }
  )
}

async function getYahooKline(symbol: string, count: number = 30): Promise<{ data: KlineItem[]; source: string }> {
  return serverCache.getOrFetch(
    'yahoo_kline',
    async () => {
      try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${count + 5}d`
        const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(15000) })
        if (!response.ok) return { data: [], source: 'Yahoo Finance' }
        const result = await response.json()
        if (result?.chart?.result?.[0]) {
          const quote = result.chart.result[0].indicators?.quote?.[0]
          const timestamps = result.chart.result[0].timestamp || []
          if (quote?.close && timestamps.length > 0) {
            const klines: KlineItem[] = []
            for (let i = 0; i < timestamps.length; i++) {
              const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0]
              const prevClose = i > 0 ? quote.close[i - 1] : null
              const currentClose = quote.close[i]
              const changePercent = prevClose && currentClose ? ((currentClose - prevClose) / prevClose) * 100 : null
              klines.push({ date, open: quote.open?.[i] || null, close: currentClose || null, high: quote.high?.[i] || null, low: quote.low?.[i] || null, change_percent: changePercent ? Math.round(changePercent * 100) / 100 : null })
            }
            return { data: klines.slice(-count), source: 'Yahoo Finance' }
          }
        }
        return { data: [], source: 'Yahoo Finance' }
      } catch {
        return { data: [], source: 'Yahoo Finance' }
      }
    },
    { forceRefresh: false, keyParts: [symbol, String(count)] }
  )
}

async function getTickflowQuote(symbol: string, codeInfo: CodeInfo): Promise<{ data: StockQuote | null; source: string }> {
  return serverCache.getOrFetch(
    'tickflow_quote',
    async () => {
      const result = await tickflowFetch('/quotes', { symbols: symbol }) as { data?: Array<{ last_price: number; ext?: { name: string; change_pct: number; change_amount: number } }> }
      if (result?.data?.[0]) {
        const d = result.data[0]
        return { data: { code: codeInfo.code, name: d.ext?.name || '', price: d.last_price, change_percent: d.ext?.change_pct ? d.ext.change_pct * 100 : null, change: d.ext?.change_amount || null }, source: 'TickFlow' }
      }
      return { data: null, source: 'TickFlow' }
    },
    { forceRefresh: false, keyParts: [symbol] }
  )
}

async function getTickflowKline(symbol: string, count: number = 30): Promise<{ data: KlineItem[]; source: string }> {
  return serverCache.getOrFetch(
    'tickflow_kline',
    async () => {
      const result = await tickflowFetch('/klines', { symbol, interval: '1d', limit: String(count) }) as { data?: { timestamp: number[]; open: number[]; high: number[]; low: number[]; close: number[] } }
      if (result?.data?.timestamp?.length) {
        const d = result.data
        const klines: KlineItem[] = []
        for (let i = 0; i < d.timestamp.length; i++) {
          const date = new Date(d.timestamp[i]).toISOString().split('T')[0]
          const prevClose = i > 0 ? d.close[i - 1] : null
          const changePercent = prevClose && d.close[i] ? ((d.close[i] - prevClose) / prevClose) * 100 : null
          klines.push({ date, open: d.open[i] || null, close: d.close[i] || null, high: d.high[i] || null, low: d.low[i] || null, change_percent: changePercent })
        }
        return { data: klines, source: 'TickFlow' }
      }
      return { data: [], source: 'TickFlow' }
    },
    { forceRefresh: false, keyParts: [symbol, String(count)] }
  )
}

async function getEMLOFQuote(fundCode: string): Promise<{ data: StockQuote | null; source: string }> {
  return serverCache.getOrFetch(
    'em_lof_quote',
    async () => {
      try {
        const url = `https://push2delay.eastmoney.com/api/qt/stock/get?secid=0.${fundCode}&fields=f43,f57,f58,f170,f46`
        const response = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(15000) })
        if (!response.ok) return { data: null, source: '东财API' }
        const result = await response.json()
        if (result?.data) {
          const d = result.data
          return { data: { code: fundCode, name: d.f58 || '', price: d.f43 ? d.f43 / 1000 : null, change_percent: d.f170 ? d.f170 / 100 : null, change: d.f43 && d.f46 ? (d.f43 - d.f46) / 1000 : null }, source: '东财API' }
        }
        return { data: null, source: '东财API' }
      } catch {
        return { data: null, source: '东财API' }
      }
    },
    { forceRefresh: false, keyParts: [fundCode] }
  )
}

async function getSinaLOFKline(fundCode: string, count: number = 30): Promise<{ data: KlineItem[]; source: string }> {
  return serverCache.getOrFetch(
    'sina_lof_kline',
    async () => {
      try {
        const market = fundCode.startsWith('16') ? 'sz' : 'sh'
        const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${market}${fundCode}&scale=240&ma=no&datalen=${count}`
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) })
        if (!response.ok) return { data: [], source: '新浪API' }
        const result = await response.json()
        if (Array.isArray(result)) {
          const klines: KlineItem[] = result.map((item: any, i: number) => {
            const prevClose = i > 0 ? parseFloat(result[i - 1].close) : null
            const currentClose = parseFloat(item.close)
            return { date: item.day, open: parseFloat(item.open) || null, close: currentClose || null, high: parseFloat(item.high) || null, low: parseFloat(item.low) || null, change_percent: prevClose && currentClose ? Math.round(((currentClose - prevClose) / prevClose) * 10000) / 100 : null }
          })
          return { data: klines, source: '新浪API' }
        }
        return { data: [], source: '新浪API' }
      } catch {
        return { data: [], source: '新浪API' }
      }
    },
    { forceRefresh: false, keyParts: [fundCode, String(count)] }
  )
}

// ============================================================
// 统一行情接口
// ============================================================
async function getQuote(codeInfo: CodeInfo): Promise<{ data: StockQuote | null; source: string }> {
  if (codeInfo.type === 'lof') {
    const data = await getEMLOFQuote(codeInfo.code)
    return { data: data.data, source: data.source }
  }
  if (codeInfo.type === 'index' && (codeInfo.market === 'HK' || codeInfo.market === 'US')) {
    const yahooSymbol = codeInfo.formatted.yahoo || codeInfo.code
    return getYahooQuote(yahooSymbol)
  }
  // A股/港股/美股：优先Yahoo Finance，失败则TickFlow
  if (codeInfo.formatted.yahoo) {
    const data = await getYahooQuote(codeInfo.formatted.yahoo)
    if (data.data) return data
  }
  if (codeInfo.formatted.tickflow) {
    const data = await getTickflowQuote(codeInfo.formatted.tickflow, codeInfo)
    if (data.data) return data
  }
  return { data: null, source: 'none' }
}

async function getKline(codeInfo: CodeInfo, count: number = 30): Promise<{ data: KlineItem[]; source: string }> {
  if (codeInfo.type === 'lof') return getSinaLOFKline(codeInfo.code, count)
  if (codeInfo.type === 'index' && (codeInfo.market === 'HK' || codeInfo.market === 'US')) {
    return getYahooKline(codeInfo.formatted.yahoo || codeInfo.code, count)
  }
  // A股/港股/美股：优先Yahoo Finance，失败则TickFlow
  if (codeInfo.formatted.yahoo) {
    const data = await getYahooKline(codeInfo.formatted.yahoo, count)
    if (data.data.length > 0) return data
  }
  if (codeInfo.formatted.tickflow) {
    const data = await getTickflowKline(codeInfo.formatted.tickflow, count)
    if (data.data.length > 0) return data
  }
  return { data: [], source: 'none' }
}

// ============================================================
// LOF净值
// ============================================================
async function emFetch(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(15000) })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

async function getEMFundNavHistory(fundCode: string, count: number = 30): Promise<{ data: NavHistoryItem[]; source: string }> {
  return serverCache.getOrFetch(
    'nav',
    async () => {
      const maxRetries = 3
      let lastError: Error | null = null
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const html = await emFetch(`https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${fundCode}&page=1&sdate=&edate=&per=${count}`)
          if (!html) {
            throw new Error('东方财富API返回空响应')
          }
          
          // 尝试多种解析模式
          const patterns = [
            // 原始模式：精确匹配
            /<td>(\d{4}-\d{2}-\d{2})<\/td>\s*<td[^>]*>([\d.]+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>/g,
            // 宽松模式：允许额外空格和属性
            /<td[^>]*>(\d{4}-\d{2}-\d{2})<\/td>\s*<td[^>]*>([\d.]+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>/g,
            // 更宽松：匹配任何行顺序
            /(\d{4}-\d{2}-\d{2})[\s\S]*?<td[^>]*>([\d.]+)<\/td>[\s\S]*?<td[^>]*>([\d.]+)<\/td>/g
          ]
          
          let result: NavHistoryItem[] = []
          let matchFound = false
          
          for (const pattern of patterns) {
            pattern.lastIndex = 0 // 重置正则状态
            const matches = html.matchAll(pattern)
            const items: NavHistoryItem[] = []
            
            for (const match of matches) {
              const date = match[1]
              const navStr = match[2]
              const accNavStr = match[3]
              
              // 验证数据
              if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
              
              const nav = parseFloat(navStr)
              const accumulated_nav = parseFloat(accNavStr)
              
              if (!isNaN(nav)) {
                items.push({ date, nav, accumulated_nav: isNaN(accumulated_nav) ? null : accumulated_nav })
              }
            }
            
            if (items.length > 0) {
              result = items
              matchFound = true
              break // 使用第一个成功的模式
            }
          }
          
          if (!matchFound) {
            throw new Error('无法解析净值数据HTML结构')
          }
          
          // 按日期降序排序（最新的在前）
          result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          
          // 限制返回数量
          result = result.slice(0, count)
          
          return { data: result, source: '东财API' }
          
        } catch (error) {
          lastError = error as Error
          console.warn(`获取基金 ${fundCode} 净值历史失败 (尝试 ${attempt}/${maxRetries}):`, error)
          
          if (attempt < maxRetries) {
            // 指数退避延迟
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
          }
        }
      }
      
      console.error(`获取基金 ${fundCode} 净值历史彻底失败:`, lastError)
      return { data: [], source: '东财API' }
    },
    { forceRefresh: false, keyParts: [fundCode, String(count)] }
  )
}

// ============================================================
// LOF配置
// ============================================================
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
  if (customConfig?.[fundCode]) return customConfig[fundCode]
  return DEFAULT_LOF_CONFIG[fundCode] || { indices: [{ index_code: '', index_name: '未知', coefficient: 0.95 }] }
}

function getYesterdayNav(navHistory: NavHistoryItem[]) {
  if (!navHistory?.length) return { prevNav: null, prevNavDate: null, todayNav: null, todayNavDate: null, navUpdatedToday: false }
  const today = new Date().toISOString().split('T')[0]
  const latest = navHistory[0]
  if (latest.date === today) {
    if (navHistory.length > 1) return { prevNav: navHistory[1].nav, prevNavDate: navHistory[1].date, todayNav: latest.nav, todayNavDate: latest.date, navUpdatedToday: true }
    return { prevNav: null, prevNavDate: null, todayNav: latest.nav, todayNavDate: latest.date, navUpdatedToday: true }
  }
  return { prevNav: latest.nav, prevNavDate: latest.date, todayNav: null, todayNavDate: null, navUpdatedToday: false }
}

// ============================================================
// API处理
// ============================================================
async function getSingleData(code: string, customConfig: Record<string, LOFConfig> | null, _forceRefresh?: boolean) {
  if (!code) return { code: '', error: '请提供代码' }
  const codeInfo = parseCode(code)
  const isLOF = codeInfo.type === 'lof'

  try {
    if (!isLOF) {
      const { data: quote, source } = await getQuote(codeInfo)
      if (!quote?.name) return { code: codeInfo.code, error: '无法获取该代码的行情数据', market: codeInfo.market, type: codeInfo.type }
      return {
        code: codeInfo.code, name: quote.name, price: quote.price, change: quote.change, change_percent: quote.change_percent,
        prev_nav: null, prev_nav_date: null, today_nav: null, today_nav_date: null, nav_updated_today: false,
        indices: [], total_index_change: null, estimated_nav: null, premium: null, estimation_error: null,
        data_sources: { quote: source, nav: 'none' }, market: codeInfo.market, type: codeInfo.type, is_lof: false,
      }
    }

    const config = getLOFConfig(codeInfo.code, customConfig)
    const { data: quote, source: quoteSource } = await getQuote(codeInfo)
    if (!quote?.name) return { code: codeInfo.code, error: '无法获取该LOF基金的数据' }

    const { data: navHistory, source: navSource } = await getEMFundNavHistory(codeInfo.code, 10)
    const { prevNav, prevNavDate, todayNav, todayNavDate, navUpdatedToday } = getYesterdayNav(navHistory)

    const indicesData: IndexData[] = []
    for (const idx of config.indices) {
      if (idx.is_manual && idx.manual_change_percent !== undefined) {
        indicesData.push({ index_code: idx.index_code || 'MANUAL', index_name: idx.index_name || '手动输入', coefficient: idx.coefficient || 0.95, change_percent: idx.manual_change_percent, source: 'manual', is_manual: true })
      } else if (idx.index_code) {
        const indexCodeInfo = parseCode(idx.index_code)
        const { data: indexQuote, source: indexSource } = await getQuote(indexCodeInfo)
        indicesData.push({ index_code: idx.index_code, index_name: idx.index_name || indexQuote?.name || '', coefficient: idx.coefficient || 0.95, change_percent: indexQuote?.change_percent ?? null, source: indexSource, is_manual: false })
      }
    }

    let estimatedNav: number | null = null, totalChange = 0
    if (prevNav) {
      const validIndices = indicesData.filter(i => i.change_percent !== null)
      if (validIndices.length > 0) {
        // 计算加权平均变化率：sum(change_percent * coefficient) / sum(coefficient)
        let totalCoefficient = 0
        for (const idx of validIndices) {
          totalChange += idx.change_percent! * idx.coefficient
          totalCoefficient += idx.coefficient
        }
        totalChange = totalCoefficient > 0 ? totalChange / totalCoefficient : 0
        estimatedNav = prevNav * (1 + totalChange / 100)
      }
    }

    const premium = quote.price && estimatedNav && estimatedNav > 0 ? (quote.price - estimatedNav) / estimatedNav * 100 : null
    const estimationError = navUpdatedToday && todayNav && estimatedNav ? (todayNav - estimatedNav) / estimatedNav * 100 : null

    return {
      code: codeInfo.code, name: quote.name, price: quote.price, change: quote.change, change_percent: quote.change_percent,
      prev_nav: prevNav, prev_nav_date: prevNavDate, today_nav: todayNav, today_nav_date: todayNavDate, nav_updated_today: navUpdatedToday,
      indices: indicesData, total_index_change: totalChange || null,
      estimated_nav: estimatedNav ? Math.round(estimatedNav * 10000) / 10000 : null,
      premium: premium ? Math.round(premium * 100) / 100 : null,
      estimation_error: estimationError ? Math.round(estimationError * 100) / 100 : null,
      data_sources: { quote: quoteSource, nav: navSource }, market: codeInfo.market, type: codeInfo.type, is_lof: true,
    }
  } catch (error) {
    return { code: codeInfo.code, error: String(error) }
  }
}

async function getBatchData(codes: string[], customConfig: Record<string, LOFConfig> | null, forceRefresh?: boolean) {
  const results = []
  for (const code of codes) results.push(await getSingleData(code, customConfig, forceRefresh))
  return results
}

async function getHistoryData(code: string, customConfig: Record<string, LOFConfig> | null, _forceRefresh?: boolean) {
  if (!code) return { error: '请提供代码' }
  try {
    const codeInfo = parseCode(code)
    const isLOF = codeInfo.type === 'lof'
    const { data: klineData, source: klineSource } = await getKline(codeInfo, 30)

    if (!isLOF) {
      return {
        code: codeInfo.code, name: null, index_name: '', coefficient: 1.0,
        history: klineData.map(item => ({ date: item.date, nav: null, accumulated_nav: null, price: item.close, premium: null, index_change: null, estimated_nav: null, estimation_error: null })),
        market: codeInfo.market, type: codeInfo.type, is_lof: false, data_sources: { nav: 'none', kline: klineSource },
      }
    }

    const config = getLOFConfig(codeInfo.code, customConfig)
    const firstIndex = config.indices[0] || {}
    const { data: navHistory, source: navSource } = await getEMFundNavHistory(codeInfo.code, 35)

    let indexKline: KlineItem[] = []
    if (!firstIndex.is_manual && firstIndex.index_code) {
      const indexCodeInfo = parseCode(firstIndex.index_code)
      const { data } = await getKline(indexCodeInfo, 35)
      indexKline = data
    }

    const navByDate = Object.fromEntries(navHistory.map(item => [item.date, item]))
    const priceByDate = Object.fromEntries(klineData.map(item => [item.date, item]))
    const indexByDate = Object.fromEntries(indexKline.map(item => [item.date, item]))
    const allDates = Object.keys(navByDate).sort().reverse()

    const history = allDates.slice(0, 30).map((date, i) => {
      const navItem = navByDate[date] || {}
      const priceItem = priceByDate[date] || {}
      const indexItem = indexByDate[date] || {}
      const nav = navItem.nav
      const price = priceItem.close
      const indexChange = indexItem.change_percent
      const premium = nav && price ? Math.round((price - nav) / nav * 10000) / 100 : null
      let estimatedNav: number | null = null, estimationError: number | null = null
      const prevDate = allDates[i + 1]
      if (prevDate && indexChange !== null) {
        const prevNav = navByDate[prevDate]?.nav
        if (prevNav) {
          estimatedNav = Math.round(prevNav * (1 + indexChange / 100 * (firstIndex.coefficient || 0.95)) * 10000) / 10000
          if (nav && estimatedNav) estimationError = Math.round((nav - estimatedNav) / estimatedNav * 10000) / 100
        }
      }
      return { date, nav, accumulated_nav: navItem.accumulated_nav, price, premium, index_change: indexChange, estimated_nav: estimatedNav, estimation_error: estimationError }
    })

    return { code: codeInfo.code, name: null, index_name: firstIndex.index_name || '', coefficient: firstIndex.coefficient || 0.95, history, market: codeInfo.market, type: codeInfo.type, is_lof: true, data_sources: { nav: navSource, kline: klineSource } }
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
  if (configStr) try { customConfig = JSON.parse(configStr) } catch {}

  try {
    let result
    if (action === 'batch' && codes) result = await getBatchData(codes.split(',').map(c => c.trim()).filter(c => c), customConfig)
    else if (action === 'single' && code) result = await getSingleData(code, customConfig)
    else if (action === 'history' && code) result = await getHistoryData(code, customConfig)
    else result = { error: '未知操作，支持: batch, single, history' }

    const stats = serverCache.getStats()
    const response = NextResponse.json(result)
    response.headers.set('X-Cache-Size', String(stats.size))
    response.headers.set('X-Cache-Types', JSON.stringify(stats.types))
    response.headers.set('X-Data-Source', 'TickFlow + Yahoo Finance + EastMoney')
    return response
  } catch (error) {
    return NextResponse.json({ error: '数据获取失败', detail: String(error) }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
