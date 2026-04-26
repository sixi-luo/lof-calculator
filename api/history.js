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

const HISTORY_SOURCES = [
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
    name: '163_kline',
    match: (market) => ['sh', 'sz', 'hk', 'us'].includes(market),
    fetch: async (code, market) => {
      const n = market === 'sh' ? '1' : market === 'sz' ? '0' : market === 'hk' ? '131' : '100'
      const m = market === 'us' ? 'usr' : code
      const url = `http://img1.money.126.net/data/hs/${n}${code}/dayline/20250401.json`
      const url2 = `http://img1.money.126.net/data/${m}/dayline/20250401.json`
      try {
        const response = await fetch(url, { timeout: 10000 })
        if (response.ok) {
          const json = await response.json()
          return parse163Kline(json, code)
        }
      } catch {}
      const response2 = await fetch(url2, { timeout: 10000 })
      return parse163Kline(await response2.json(), code)
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
  },
  {
    name: 'eastmoney_hk',
    match: (market) => market === 'hk',
    fetch: async (code, market) => {
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=116${code}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=0&end=20500101&lmt=${HISTORY_LIMIT}`
      const response = await fetch(url, { timeout: 10000 })
      const json = await response.json()
      return parseEastMoneyKline(json)
    }
  },
  {
    name: 'tencent_us_kline',
    match: (market) => market === 'us',
    fetch: async (code, market) => {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayqfq&param=us${code},day,,,,${HISTORY_LIMIT},qfq`
      const response = await fetch(url, { timeout: 10000 })
      const text = await response.json()
      return parseTencentKline(text, code)
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

function parse163Kline(json, code) {
  try {
    if (!Array.isArray(json) || json.length === 0) return null
    return json.map(d => ({
      date: d.day || d.date,
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

  const errors = []
  for (const m of markets) {
    const sources = HISTORY_SOURCES.filter(s => s.match(m))
    for (const source of sources) {
      try {
        const result = await source.fetch(code, m)
        if (result && result.length > 0) {
          return {
            market: m,
            source: source.name,
            data: result.slice(-HISTORY_LIMIT)
          }
        }
      } catch (e) {
        errors.push(`${m}_${source.name}: ${e.message}`)
      }
    }
  }

  throw new Error(`Failed: ${errors.join(', ')}`)
}

export { detectMarket }