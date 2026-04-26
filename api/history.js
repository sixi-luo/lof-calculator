const HISTORY_LIMIT = 30

function detectMarket(code) {
  const cleanCode = code.replace(/[\s\-]/g, '')
  if (/^(00|60)\d{4}/.test(cleanCode)) return 'sh'
  if (/^(30|68)\d{4}/.test(cleanCode)) return 'sz'
  if (/^8[0-5]\d{5}/.test(cleanCode)) return 'bj'
  if (/^\d{4,5}/.test(cleanCode) && /^[0-9]/.test(cleanCode)) return 'hk'
  if (/^[a-zA-Z]/.test(cleanCode)) return 'us'
  return null
}

const KLINE_SOURCES = [
  {
    name: 'eastmoney_kline',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const secid = market === 'sh' ? `1${code}` : `0${code}`
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${HISTORY_LIMIT}`
      const response = await fetch(url, { timeout: 10000 })
      const json = await response.json()
      return parseEastMoneyKline(json)
    }
  },
  {
    name: 'sina_kline',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const prefix = market === 'sh' ? 'sh' : 'sz'
      const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${prefix}${code}&scale=240&ma=5&datalen=${HISTORY_LIMIT}`
      const response = await fetch(url, { timeout: 10000 })
      const json = await response.json()
      return parseSinaKline(json, code)
    }
  },
  {
    name: 'tencent_kline',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const prefix = market === 'sh' ? 'sh' : 'sz'
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayqfq&param=${prefix}${code},day,,,,${HISTORY_LIMIT},qfq`
      const response = await fetch(url, { timeout: 10000 })
      const text = await response.text()
      return parseTencentKline(text, code)
    }
  }
]

const NAV_SOURCES = [
  {
    name: 'eastmoney_nav',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const secid = market === 'sh' ? `1${code}` : `0${code}`
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f170,f171,f57,f58,f60,f162`
      const response = await fetch(url, { timeout: 10000 })
      const json = await response.json()
      if (!json || !json.data) return null
      const d = json.data
      return {
        nav: parseFloat(d.f162 || d.f170),
        date: d.f60
      }
    }
  },
  {
    name: 'sina_nav',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const prefix = market === 'sh' ? 'sh' : 'sz'
      const url = `https://hq.sinajisu.cn/index.php?symbol=${prefix}${code}&type=detail`
      const response = await fetch(url, { timeout: 10000 })
      const text = await response.text()
      const match = text.match(/="([^"]+)"/)
      if (!match) return null
      const data = match[1].split(',')
      if (data.length < 32) return null
      return {
        nav: null,
        date: data[30] || data[31]
      }
    }
  }
]

function parseEastMoneyKline(json) {
  try {
    if (!json || !json.data || !json.data.klines) return null
    const klines = json.data.klines
    if (!klines || klines.length === 0) return null
    
    return klines.map(k => {
      const parts = k.split(',')
      return {
        date: parts[0],
        open: parseFloat(parts[1]),
        close: parseFloat(parts[2]),
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        volume: parseInt(parts[5]),
        amount: parseFloat(parts[6])
      }
    })
  } catch {
    return null
  }
}

function parseSinaKline(json, code) {
  try {
    if (!Array.isArray(json) || json.length === 0) return null
    return json.map(d => ({
      date: d.day,
      open: parseFloat(d.open),
      close: parseFloat(d.close),
      high: parseFloat(d.high),
      low: parseFloat(d.low),
      volume: parseInt(d.volume)
    }))
  } catch {
    return null
  }
}

function parseTencentKline(text, code) {
  try {
    const match = text.match(/=(\[.*\])/)
    if (!match) return null
    const json = JSON.parse(match[1])
    if (!Array.isArray(json) || json.length === 0) return null
    return json.map(d => ({
      date: d[0],
      open: parseFloat(d[1]),
      close: parseFloat(d[2]),
      high: parseFloat(d[3]),
      low: parseFloat(d[4]),
      volume: parseInt(d[5])
    }))
  } catch {
    return null
  }
}

export async function fetchHistory(code, market) {
  const markets = market ? [market] : ['sh', 'sz', 'hk', 'us']
  
  if (!market) {
    const detected = detectMarket(code)
    if (detected) {
      const idx = markets.indexOf(detected)
      if (idx > 0) {
        markets.splice(idx, 1)
        markets.unshift(detected)
      }
    }
  }

  let klineData = null
  let navData = null

  for (const m of markets) {
    if (klineData) break
    const sources = KLINE_SOURCES.filter(s => s.match(m))
    for (const source of sources) {
      try {
        const result = await source.fetch(code, m)
        if (result && result.length > 0) {
          klineData = { market: m, source: source.name, data: result }
          break
        }
      } catch {}
    }
  }

  for (const m of markets) {
    if (navData) break
    const sources = NAV_SOURCES.filter(s => s.match(m))
    for (const source of sources) {
      try {
        const result = await source.fetch(code, m)
        if (result) {
          navData = { source: source.name, ...result }
          break
        }
      } catch {}
    }
  }

  if (!klineData || klineData.data.length === 0) {
    throw new Error('No kline data available')
  }

  return {
    ...klineData,
    nav: navData
  }
}

export { detectMarket }