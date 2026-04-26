const MARKET_PREFIXES = {
  sh: 'sh', sz: 'sz', bj: 'bj', hk: 'hk', us: 'gb_'
}

const MARKET_SUFFIXES = {
  sh: '1', sz: '0', bj: '0', hk: '116', us: '100'
}

function detectMarket(code) {
  const cleanCode = code.replace(/[\s\-]/g, '')
  if (/^(00|60)\d{4}/.test(cleanCode)) return 'sh'
  if (/^(30|68)\d{4}/.test(cleanCode)) return 'sz'
  if (/^8[0-5]\d{5}/.test(cleanCode)) return 'bj'
  if (/^\d{4,5}/.test(cleanCode) && /^[0-9]/.test(cleanCode)) return 'hk'
  if (/^[a-zA-Z]/.test(cleanCode)) return 'us'
  return null
}

const dataSources = [
  {
    name: 'sina',
    match: (market) => ['sh', 'sz', 'us'].includes(market),
    fetch: async (code, market) => {
      const prefix = MARKET_PREFIXES[market] || 'gb_'
      const url = `https://hq.sinajisu.cn/index.php?symbol=${prefix}${code}&type=detail`
      const response = await fetch(url, { timeout: 8000 })
      const text = await response.text()
      return parseSinaResponse(text, market)
    }
  },
  {
    name: '163_money',
    match: (market) => ['sh', 'sz', 'hk'].includes(market),
    fetch: async (code, market) => {
      const prefix = MARKET_PREFIXES[market]
      const url = `http://api.money.126.net/data/feed/${prefix}${code},money`
      const response = await fetch(url, { timeout: 8000 })
      const text = await response.text()
      return parse163MoneyResponse(text, market)
    }
  },
  {
    name: '163_stock',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const prefix = MARKET_PREFIXES[market]
      const url = `http://money.163.com/stock/${prefix}${code}.json`
      const response = await fetch(url, { timeout: 8000 })
      const json = await response.json()
      return parse163StockResponse(json, market)
    }
  },
  {
    name: 'eastmoney_a',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const secid = market === 'sh' ? `1${code}` : `0${code}`
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f170,f171,f57,f58&flpt=1`
      const response = await fetch(url, { timeout: 8000 })
      const json = await response.json()
      return parseEastMoneyResponse(json, market, code)
    }
  },
  {
    name: 'eastmoney_hk',
    match: () => false,
    fetch: async (code, market) => {
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=116${code}&fields=f43,f170,f171,f57,f58`
      const response = await fetch(url, { timeout: 8000 })
      const json = await response.json()
      return parseEastMoneyResponse(json, 'hk', code)
    }
  },
  {
    name: 'tencent_us',
    match: (market) => market === 'us',
    fetch: async (code, market) => {
      const url = `https://qt.gtimg.cn/q=us${code}`
      const response = await fetch(url, { timeout: 8000 })
      const text = await response.text()
      return parseTencentResponse(text, market)
    }
  },
  {
    name: 'tencent_cn',
    match: (market) => ['sh', 'sz', 'hk'].includes(market),
    fetch: async (code, market) => {
      const prefixes = { sh: 'sh', sz: 'sz', hk: 'hk' }
      const url = `https://qt.gtimg.cn/q=${prefixes[market]}${code}`
      const response = await fetch(url, { timeout: 8000 })
      const text = await response.text()
      return parseTencentResponse(text, market)
    }
  },
  {
    name: 'sina_hq',
    match: (market) => true,
    fetch: async (code, market) => {
      const prefix = MARKET_PREFIXES[market] || 'gb_'
      const url = `https://hq.sinajisu.cn/hq/cn_stocks/${market}${code}.json`
      try {
        const response = await fetch(url, { timeout: 8000 })
        const json = await response.json()
        if (json && json.price) {
          return {
            name: json.name || code,
            price: parseFloat(json.price),
            change: parseFloat(json.price) - parseFloat(json.prev_close || json.price),
            changePercent: parseFloat(json.percent || 0),
            open: parseFloat(json.open || 0),
            high: parseFloat(json.high || 0),
            low: parseFloat(json.low || 0),
            close: parseFloat(json.prev_close || 0)
          }
        }
      } catch {}
      return null
    }
  }
]

function parseSinaResponse(text, market) {
  try {
    const match = text.match(/="([^"]+)"/)
    if (!match) return null
    const data = match[1].split(',')
    if (data.length < 10) return null
    
    const price = parseFloat(data[1])
    if (isNaN(price) || price <= 0) return null
    
    return {
      name: data[0],
      price: price,
      change: parseFloat(data[2]) || 0,
      changePercent: parseFloat(data[3]) || 0,
      open: parseFloat(data[6]) || 0,
      high: parseFloat(data[7]) || 0,
      low: parseFloat(data[8]) || 0,
      close: parseFloat(data[9]) || 0
    }
  } catch {
    return null
  }
}

function parse163MoneyResponse(text, market) {
  try {
    const json = JSON.parse(text.replace(/^[^=]+=/, ''))
    const keys = Object.keys(json).filter(k => json[k] && json[k].price)
    if (keys.length === 0) return null
    
    const data = json[keys[0]]
    const price = parseFloat(data.price)
    const yestclose = parseFloat(data.yestclose)
    if (isNaN(price) || price <= 0) return null
    
    return {
      name: data.name || data.symbol,
      price: price,
      change: price - yestclose,
      changePercent: yestclose > 0 ? ((price - yestclose) / yestclose * 100) : 0,
      open: parseFloat(data.open) || 0,
      high: parseFloat(data.high) || 0,
      low: parseFloat(data.low) || 0,
      close: yestclose
    }
  } catch {
    return null
  }
}

function parse163StockResponse(json, market) {
  try {
    if (!json || !json.price) return null
    const price = parseFloat(json.price)
    const yestclose = parseFloat(json.yestclose || json.close)
    if (isNaN(price) || price <= 0) return null
    
    return {
      name: json.name || json.symbol,
      price: price,
      change: price - yestclose,
      changePercent: yestclose > 0 ? ((price - yestclose) / yestclose * 100) : 0,
      open: parseFloat(json.open) || 0,
      high: parseFloat(json.high) || 0,
      low: parseFloat(json.low) || 0,
      close: yestclose
    }
  } catch {
    return null
  }
}

function parseEastMoneyResponse(json, market, code) {
  try {
    if (!json || !json.data) return null
    const d = json.data
    const price = parseFloat(d.f43 || d.f170)
    if (isNaN(price) || price <= 0) return null
    
    const change = parseFloat(d.f4 || 0)
    const changePercent = parseFloat(d.f3 || 0)
    
    return {
      name: d.f58 || code,
      price: price,
      change: change,
      changePercent: changePercent,
      open: parseFloat(d.f86 || 0),
      high: parseFloat(d.f88 || 0),
      low: parseFloat(d.f89 || 0),
      close: parseFloat(d.f60 || 0)
    }
  } catch {
    return null
  }
}

function parseTencentResponse(text, market) {
  try {
    const match = text.match(/="([^"]+)"/)
    if (!match) return null
    const data = match[1].split('~')
    if (data.length < 50) return null
    
    const price = parseFloat(data[3])
    const yestclose = parseFloat(data[4])
    if (isNaN(price) || price <= 0) return null
    
    return {
      name: data[1],
      price: price,
      change: price - yestclose,
      changePercent: yestclose > 0 ? ((price - yestclose) / yestclose * 100) : 0,
      open: parseFloat(data[5]) || 0,
      high: parseFloat(data[33]) || 0,
      low: parseFloat(data[34]) || 0,
      close: yestclose
    }
  } catch {
    return null
  }
}

export async function fetchData(code, market) {
  const markets = market ? [market] : ['sh', 'sz', 'hk', 'us', 'bj']
  
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
    const availableSources = dataSources.filter(s => s.match(m))
    
    for (const source of availableSources) {
      try {
        const result = await source.fetch(code, m)
        if (result && result.price > 0) {
          return { ...result, market: m, source: source.name }
        }
      } catch (e) {
        errors.push(`${m}_${source.name}: ${e.message}`)
      }
    }
  }

  throw new Error(`All ${errors.length} attempts failed`)
}

export { detectMarket }