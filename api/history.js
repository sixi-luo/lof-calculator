function detectMarket(code) {
  const cleanCode = code.replace(/[\s\-]/g, '')
  if (/^(00|60)\d{4}/.test(cleanCode)) return 'sh'
  if (/^(30|68)\d{4}/.test(cleanCode)) return 'sz'
  if (/^8[0-5]\d{5}/.test(cleanCode)) return 'bj'
  if (/^\d{4,5}/.test(cleanCode) && /^[0-9]/.test(cleanCode)) return 'hk'
  if (/^[a-zA-Z]/.test(cleanCode)) return 'us'
  return null
}

const HISTORY_LIMIT = 30

const KLINE_SOURCES = [
  {
    name: 'eastmoney_kline',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const secid = market === 'sh' ? `1${code}` : `0${code}`
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${HISTORY_LIMIT}`
      const response = await fetch(url)
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
      const response = await fetch(url)
      const json = await response.json()
      return parseSinaKline(json, code)
    }
  }
]

const NAV_SOURCES = [
  {
    name: 'eastmoney_nav',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const secid = market === 'sh' ? `1${code}` : `0${code}`
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=${HISTORY_LIMIT}`
      const response = await fetch(url)
      const json = await response.json()
      return parseEastMoneyNav(json)
    }
  },
  {
    name: 'fund123_nav',
    match: (market) => ['sh', 'sz'].includes(market),
    fetch: async (code, market) => {
      const url = `https://api.fund123.com.cn/v1/fund/${market}${code}/nav/history?days=${HISTORY_LIMIT}`
      const response = await fetch(url)
      if (response.ok) {
        const json = await response.json()
        return parseFund123Nav(json)
      }
      return null
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
  } catch (e) {
    return null
  }
}

function parseEastMoneyNav(json) {
  try {
    if (!json || !json.data || !json.data.klines) return null
    const klines = json.data.klines
    if (!klines || klines.length === 0) return null
    const navMap = {}
    klines.forEach(k => {
      const parts = k.split(',')
      if (parts.length >= 8) {
        navMap[parts[0]] = parseFloat(parts[6]) || null
      }
    })
    return navMap
  } catch (e) {
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
  } catch (e) {
    return null
  }
}

function parseFund123Nav(json) {
  try {
    if (!json || !json.data) return null
    const navMap = {}
    if (Array.isArray(json.data)) {
      json.data.forEach(d => {
        if (d.date && d.nav !== undefined) {
          navMap[d.date] = parseFloat(d.nav) || null
        }
      })
    }
    return Object.keys(navMap).length > 0 ? navMap : null
  } catch (e) {
    return null
  }
}

async function fetchKlineData(code, market) {
  const markets = market ? [market] : ['sh', 'sz']
  
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

  for (const m of markets) {
    const sources = KLINE_SOURCES.filter(s => s.match(m))
    for (const source of sources) {
      try {
        const result = await source.fetch(code, m)
        if (result && result.length > 0) {
          return { market: m, source: source.name, data: result }
        }
      } catch (e) {
        console.error(`Error fetching ${source.name}:`, e.message)
      }
    }
  }

  return null
}

async function fetchNavData(code, market) {
  const markets = market ? [market] : ['sh', 'sz']
  
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

  for (const m of markets) {
    const sources = NAV_SOURCES.filter(s => s.match(m))
    for (const source of sources) {
      try {
        const result = await source.fetch(code, m)
        if (result && Object.keys(result).length > 0) {
          return result
        }
      } catch (e) {
        console.error(`Nav error (${source.name}):`, e.message)
      }
    }
  }

  return null
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const code = searchParams.get('code')
  const market = searchParams.get('market') || null
  const tracking = searchParams.get('tracking') || null

  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter' })
  }

  try {
    const klineData = await fetchKlineData(code, market)
    const navData = await fetchNavData(code, market)
    
    let trackingData = null
    if (tracking) {
      try {
        const trackingCodes = JSON.parse(decodeURIComponent(tracking))
        trackingData = await fetchTrackingHistory(trackingCodes, market)
      } catch (e) {
        console.error('Tracking parse error:', e.message)
      }
    }
    
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'public, max-age=60')
    
    return res.status(200).json({
      ...klineData,
      navMap: navData,
      trackingData
    })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to fetch data' })
  }
}

async function fetchTrackingHistory(trackingCodes, market) {
  const result = {}
  for (const item of trackingCodes) {
    if (!item.code || !item.weight) continue
    try {
      const data = await fetchKlineData(item.code, null)
      if (data && data.data) {
        result[item.code] = {
          weight: item.weight,
          data: data.data
        }
      }
    } catch (e) {
      console.error(`Tracking ${item.code} error:`, e.message)
    }
  }
  return result
}