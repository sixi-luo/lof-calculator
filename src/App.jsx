import { useState, useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'lof_funds_data'
const HISTORY_KEY = 'lof_history'

function detectMarket(code) {
  const cleanCode = code.replace(/[\s\-]/g, '')
  if (/^(00|60)\d{4}/.test(cleanCode)) return 'sh'
  if (/^(30|68)\d{4}/.test(cleanCode)) return 'sz'
  if (/^8[0-5]\d{5}/.test(cleanCode)) return 'bj'
  if (/^\d{4,5}/.test(cleanCode) && /^[0-9]/.test(cleanCode)) return 'hk'
  if (/^[a-zA-Z]/.test(cleanCode)) return 'us'
  return null
}

async function fetchFundData(code) {
  const markets = ['sh', 'sz', 'bj', 'hk', 'us']
  const market = detectMarket(code)
  
  const tryMarket = async (m) => {
    try {
      const response = await fetch(`/api/quote?code=${code}&market=${m}`)
      if (response.ok) {
        const data = await response.json()
        if (data.price > 0) return data
      }
    } catch {}
    return null
  }
  
  if (market) {
    const result = await tryMarket(market)
    if (result) return result
  }
  
  for (const m of markets) {
    const result = await tryMarket(m)
    if (result) return result
  }
  
  return null
}

async function fetchHistoryData(code, market) {
  try {
    const response = await fetch(`/api/history?code=${code}&market=${market || ''}`)
    if (response.ok) {
      const data = await response.json()
      return data
    }
  } catch {}
  return null
}

function formatNumber(num, decimals = 2) {
  if (num == null || isNaN(num)) return '-'
  return num.toFixed(decimals)
}

function formatPercent(num) {
  if (num == null || isNaN(num)) return '-'
  return (num >= 0 ? '+' : '') + num.toFixed(2) + '%'
}

function decodeChinese(text) {
  if (!text) return ''
  try {
    const textarea = document.createElement('textarea')
    textarea.innerHTML = text
    return textarea.value || text
  } catch {
    return text
  }
}

function saveToStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.error('Save storage error:', e)
  }
}

function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveHistory(fundCode, dailyData) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}')
    if (!history[fundCode]) history[fundCode] = []
    
    const today = new Date().toISOString().split('T')[0]
    const existing = history[fundCode].findIndex(d => d.date === today)
    if (existing >= 0) {
      history[fundCode][existing] = { ...history[fundCode][existing], ...dailyData }
    } else {
      history[fundCode].unshift({ date: today, ...dailyData })
    }
    
    history[fundCode] = history[fundCode].slice(0, 30)
    
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch (e) {
    console.error('Save history error:', e)
  }
}

function getHistory(fundCode) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}')
    return history[fundCode] || []
  } catch {
    return []
  }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function App() {
  const [funds, setFunds] = useState([])
  const [newFundCode, setNewFundCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const saved = loadFromStorage()
    if (saved.length > 0) {
      setFunds(saved)
      saved.forEach(f => refreshFundData(f.code))
    }
  }, [])

  const refreshFundData = useCallback(async (code) => {
    const data = await fetchFundData(code)
    if (data) {
      setFunds(prev => {
        const updated = prev.map(f => 
          f.code === code ? { ...f, ...data, lastUpdate: Date.now() } : f
        )
        saveToStorage(updated)
        return updated
      })
    }
  }, [])

  const refreshAll = () => {
    setRefreshing(true)
    setFunds(current => {
      current.forEach(f => refreshFundData(f.code))
      return current
    })
    setTimeout(() => setRefreshing(false), 2000)
  }

  const addFund = async () => {
    if (!newFundCode.trim()) return
    
    setLoading(true)
    setError(null)
    
    try {
      const data = await fetchFundData(newFundCode.trim())
      if (!data) {
        setError('无法获取数据，请检查基金代码是否正确')
        return
      }
      
      const newFund = {
        id: Date.now(),
        code: newFundCode.trim(),
        name: decodeChinese(data.name) || newFundCode.trim(),
        market: data.market,
        source: data.source,
        trackings: [{ id: 1, code: '', weight: 100 }],
        price: data.price,
        change: data.change,
        changePercent: data.changePercent,
        lastUpdate: Date.now()
      }
      
      setFunds(prev => {
        const updated = [...prev, newFund]
        saveToStorage(updated)
        return updated
      })
      
      setNewFundCode('')
    } catch (e) {
      setError('添加失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const removeFund = (id) => {
    setFunds(prev => {
      const updated = prev.filter(f => f.id !== id)
      saveToStorage(updated)
      return updated
    })
  }

  const updateTracking = useCallback((fundId, trackingId, field, value) => {
    setFunds(prev => {
      const updated = prev.map(f => {
        if (f.id !== fundId) return f
        return {
          ...f,
          trackings: f.trackings.map(t => 
            t.id === trackingId ? { ...t, [field]: value } : t
          )
        }
      })
      saveToStorage(updated)
      return updated
    })
  }, [])

  const addTracking = (fundId) => {
    setFunds(prev => {
      const updated = prev.map(f => {
        if (f.id !== fundId) return f
        const newTracking = { id: Date.now(), code: '', weight: 0 }
        return { ...f, trackings: [...f.trackings, newTracking] }
      })
      saveToStorage(updated)
      return updated
    })
  }

  const removeTracking = (fundId, trackingId) => {
    setFunds(prev => {
      const updated = prev.map(f => {
        if (f.id !== fundId) return f
        return { ...f, trackings: f.trackings.filter(t => t.id !== trackingId) }
      })
      saveToStorage(updated)
      return updated
    })
  }

  return (
    <div className="container">
      <header>
        <h1>LOF基金净值计算器</h1>
        <p>输入LOF基金代码，自动计算估算净值与折溢价率</p>
      </header>

      <div className="add-fund-section">
        <div className="add-fund-form">
          <div className="form-group">
            <label>LOF基金代码</label>
            <input
              type="text"
              value={newFundCode}
              onChange={e => setNewFundCode(e.target.value)}
              placeholder="如: 501018、161725、513500"
              onKeyDown={e => e.key === 'Enter' && addFund()}
            />
          </div>
          <button className="btn btn-primary" onClick={addFund} disabled={loading}>
            {loading ? '加载中...' : '添加基金'}
          </button>
          {funds.length > 0 && (
            <button className="btn btn-secondary" onClick={refreshAll} disabled={refreshing}>
              {refreshing ? '刷新中...' : '刷新全部'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {funds.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14h-2v-4H6v-2h4V7h2v4h4v2h-4v4z"/>
          </svg>
          <h3>暂无基金</h3>
          <p>在上方输入LOF基金代码开始添加</p>
        </div>
      ) : (
        <div className="fund-cards">
          {funds.map(fund => (
            <FundCard
              key={fund.id}
              fund={fund}
              onRemove={() => removeFund(fund.id)}
              onUpdateTracking={updateTracking}
              onAddTracking={addTracking}
              onRemoveTracking={removeTracking}
              onRefresh={() => refreshFundData(fund.code)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FundCard({ fund, onRemove, onUpdateTracking, onAddTracking, onRemoveTracking, onRefresh }) {
  const [trackingData, setTrackingData] = useState({})
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [savedHistory, setSavedHistory] = useState([])
  const trackingDataRef = useRef({})
  
  const marketLabels = {
    sh: { label: '上证', class: 'market-a' },
    sz: { label: '深证', class: 'market-a' },
    bj: { label: '北交', class: 'market-a' },
    hk: { label: '港股', class: 'market-hk' },
    us: { label: '美股', class: 'market-us' }
  }
  
  useEffect(() => {
    setSavedHistory(getHistory(fund.code))
  }, [fund.code])

  useEffect(() => {
    if (showHistory && history.length === 0) {
      loadHistoryFromApi()
    }
  }, [showHistory])

  const loadHistoryFromApi = async () => {
    setHistoryLoading(true)
    try {
      const apiData = await fetchHistoryData(fund.code, fund.market)
      const saved = getHistory(fund.code)
      
      if (apiData && apiData.data && apiData.data.length > 0) {
        const combined = apiData.data.map((h, idx) => {
          const savedItem = saved.find(s => s.date === h.date)
          const prevDay = idx < apiData.data.length - 1 ? apiData.data[idx + 1] : null
          
          let changePercent = 0
          if (prevDay && prevDay.close && prevDay.close > 0) {
            changePercent = ((h.close - prevDay.close) / prevDay.close) * 100
          }
          
          let actualPremiumRate = null
          if (savedItem && savedItem.actualNav && h.close) {
            actualPremiumRate = ((h.close - savedItem.actualNav) / savedItem.actualNav) * 100
          }
          
          return {
            date: h.date,
            open: h.open,
            close: h.close,
            high: h.high,
            low: h.low,
            volume: h.volume,
            changePercent,
            actualNav: savedItem ? savedItem.actualNav : null,
            actualPremiumRate,
            estimatedNav: savedItem ? savedItem.estimatedNav : null,
            estimatedPremiumRate: savedItem ? savedItem.estimatedPremiumRate : null,
            premiumError: savedItem ? savedItem.premiumError : null
          }
        })
        
        if (apiData.nav && apiData.nav.nav) {
          const todayStr = new Date().toISOString().split('T')[0]
          const todayKline = combined.find(h => h.date === todayStr)
          if (todayKline) {
            todayKline.actualNav = apiData.nav.nav
            todayKline.actualPremiumRate = ((todayKline.close - apiData.nav.nav) / apiData.nav.nav) * 100
          }
        }
        
        setHistory(combined)
      } else {
        setHistory(saved.map(h => ({
          date: h.date,
          close: h.price,
          changePercent: h.changePercent,
          actualNav: h.actualNav,
          actualPremiumRate: h.actualPremiumRate,
          estimatedNav: h.estimatedNav,
          estimatedPremiumRate: h.premiumRate,
          premiumError: h.errorRate
        })))
      }
    } catch (e) {
      console.error('Load history error:', e)
      setHistory(saved.map(h => ({
        date: h.date,
        close: h.price,
        changePercent: h.changePercent,
        actualNav: h.actualNav,
        actualPremiumRate: h.actualPremiumRate,
        estimatedNav: h.estimatedNav,
        estimatedPremiumRate: h.premiumRate,
        premiumError: h.errorRate
      })))
    }
    setHistoryLoading(false)
  }

  const loadTrackingData = useCallback(async () => {
    setTrackingLoading(true)
    const data = {}
    for (const t of fund.trackings) {
      if (t.code && t.weight > 0) {
        const result = await fetchFundData(t.code)
        if (result) data[t.id] = result
      }
    }
    trackingDataRef.current = data
    setTrackingData(data)
    setTrackingLoading(false)
    return data
  }, [fund.trackings])

  const validTrackings = fund.trackings.filter(t => t.code && t.weight > 0)
  const totalWeight = validTrackings.reduce((sum, t) => sum + t.weight, 0)
  
  let estimatedNav = null
  if (validTrackings.length > 0 && totalWeight === 100 && fund.price) {
    let weightedChange = 0
    for (const t of validTrackings) {
      const td = trackingData[t.id]
      if (td && td.changePercent != null) {
        weightedChange += td.changePercent * (t.weight / 100)
      }
    }
    estimatedNav = fund.price / (1 + weightedChange / 100)
  }
  
  const premiumRate = estimatedNav ? ((fund.price - estimatedNav) / estimatedNav * 100) : null
  
  const handleRefresh = async () => {
    await onRefresh()
    await loadTrackingData()
    if (fund.price && estimatedNav) {
      saveHistory(fund.code, {
        price: fund.price,
        change: fund.change,
        changePercent: fund.changePercent,
        actualNav: null,
        actualPremiumRate: null,
        estimatedNav,
        estimatedPremiumRate: premiumRate,
        premiumError: fund.changePercent != null ? Math.abs(fund.changePercent - premiumRate) : null,
        trackingConfig: JSON.stringify(fund.trackings)
      })
      setSavedHistory(getHistory(fund.code))
      if (showHistory) {
        loadHistoryFromApi()
      }
    }
  }

  return (
    <div className="fund-card">
      <div className="fund-card-header">
        <div>
          <h3>{decodeChinese(fund.name) || fund.code}</h3>
          <span style={{ fontSize: '12px', color: '#666' }}>代码: {fund.code}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`market-tag ${marketLabels[fund.market]?.class || 'market-a'}`}>
            {marketLabels[fund.market]?.label || '未知'}
          </span>
          <button className="close-btn" onClick={onRemove}>×</button>
        </div>
      </div>

      <div className="price-info">
        <div className="price-item">
          <div className="label">
            市场价格 
            <span style={{fontSize:'10px',color:'#999',marginLeft:'4px'}}>{fund.source}</span>
          </div>
          <div className="value">{formatNumber(fund.price, 3)}</div>
          {fund.changePercent != null && (
            <div className={`change ${fund.change >= 0 ? 'up' : 'down'}`}>
              {formatNumber(fund.change, 3)} ({formatPercent(fund.changePercent)})
            </div>
          )}
        </div>
        <div className="price-item">
          <div className="label">估算净值</div>
          <div className="value">{estimatedNav ? formatNumber(estimatedNav, 4) : '-'}</div>
          {estimatedNav && premiumRate != null && (
            <div className={`change ${premiumRate >= 0 ? 'up' : 'down'}`}>
              折溢价: {formatPercent(premiumRate)}
            </div>
          )}
        </div>
      </div>

      <div className="tracking-config">
        <h4>追踪配置（权重总和: {totalWeight}%）</h4>
        <div className="tracking-items">
          {fund.trackings.map(t => (
            <div key={t.id} className="tracking-item">
              <input
                type="text"
                placeholder="标的代码"
                value={t.code}
                onChange={e => onUpdateTracking(fund.id, t.id, 'code', e.target.value)}
              />
              <input
                type="number"
                className="percent"
                placeholder="权重%"
                min="0"
                max="100"
                value={t.weight || ''}
                onChange={e => onUpdateTracking(fund.id, t.id, 'weight', parseInt(e.target.value) || 0)}
              />
              <div style={{ fontSize: '12px', color: '#666', textAlign: 'center' }}>
                {trackingData[t.id] ? `¥${formatNumber(trackingData[t.id].price, 3)}` : '-'}
              </div>
              <button className="remove-btn" onClick={() => onRemoveTracking(fund.id, t.id)}>×</button>
            </div>
          ))}
        </div>
        {fund.trackings.length < 2 && (
          <button className="add-tracking-btn" onClick={() => onAddTracking(fund.id)}>
            + 添加追踪标的
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
        <button 
          className="btn btn-secondary" 
          style={{ flex: 1 }}
          onClick={onRefresh}
        >
          刷新数据
        </button>
        <button 
          className="btn btn-secondary" 
          style={{ flex: 1 }}
          onClick={handleRefresh}
        >
          保存
        </button>
      </div>

      <div className="history-section">
        <button className="history-toggle" onClick={() => { 
          setShowHistory(!showHistory)
          if (!showHistory && history.length === 0) loadHistoryFromApi()
        }}>
          <span className={`arrow ${showHistory ? 'expanded' : ''}`}>▶</span>
          近30天历史 {(history.length > 0 || savedHistory.length > 0) && `(${(history.length || savedHistory.length)}天)`}
        </button>
        
        {showHistory && (
          <div className="history-table">
            {historyLoading ? (
              <p style={{ textAlign: 'center', color: '#999', padding: '20px' }}>加载中...</p>
            ) : history.length === 0 && savedHistory.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#999', padding: '20px' }}>暂无历史数据，点击"刷新数据并保存"记录今日数据</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>收盘价</th>
                    <th>涨跌幅</th>
                    <th>估算净值</th>
                    <th>估算折溢价</th>
                    <th>实际折溢价</th>
                    <th>折溢价误差</th>
                  </tr>
                </thead>
                <tbody>
                  {(history.length > 0 ? history : savedHistory).map((h, i) => (
                    <tr key={i}>
                      <td>{formatDate(h.date)}</td>
                      <td>{formatNumber(h.close || h.price, 3)}</td>
                      <td style={{ color: (h.changePercent || 0) >= 0 ? '#d4380d' : '#52c41a' }}>
                        {formatPercent(h.changePercent)}
                      </td>
                      <td>{h.estimatedNav ? formatNumber(h.estimatedNav, 4) : '-'}</td>
                      <td style={{ color: (h.estimatedPremiumRate || 0) >= 0 ? '#d4380d' : '#52c41a' }}>
                        {h.estimatedPremiumRate != null ? formatPercent(h.estimatedPremiumRate) : '-'}
                      </td>
                      <td style={{ color: (h.actualPremiumRate || 0) >= 0 ? '#d4380d' : '#52c41a' }}>
                        {h.actualPremiumRate != null ? formatPercent(h.actualPremiumRate) : '-'}
                      </td>
                      <td>{h.premiumError != null ? formatPercent(h.premiumError) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}