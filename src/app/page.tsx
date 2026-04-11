'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { dataCache } from '@/utils/cache'

// 类型定义
interface IndexConfig {
  index_code: string
  index_name: string
  coefficient: number
}

interface LOFConfig {
  indices: IndexConfig[]
}

interface IndexData {
  index_code: string
  index_name: string
  coefficient: number
  change_percent: number | null
  source: string
}

interface LOFBatchItem {
  code: string
  name: string
  prev_nav: number | null
  prev_nav_date: string | null
  today_nav: number | null
  today_nav_date: string | null
  nav_updated_today: boolean
  price: number | null
  change_percent: number | null
  indices: IndexData[]
  total_index_change: number | null
  estimated_nav: number | null
  premium: number | null
  estimation_error: number | null
  data_sources?: {
    quote: string
    nav: string
  }
  error?: string
  _cachedAt?: number
}

interface HistoryItem {
  date: string
  nav: number | null
  accumulated_nav: number | null
  price: number | null
  premium: number | null
  index_change: number | null
  estimated_nav: number | null
  estimation_error: number | null
}

interface LOFHistory {
  code: string
  name: string
  index_name: string
  coefficient: number
  history: HistoryItem[]
  data_sources?: {
    nav: string
    kline: string
  }
  error?: string
  _cachedAt?: number
}

// 分组类型
interface CodeGroup {
  id: string
  name: string
  codes: string[]
  createdAt: number
  updatedAt: number
}

// 本地存储键名
const STORAGE_KEYS = {
  SELECTED_CODES: 'lof_selected_codes',
  CUSTOM_CONFIGS: 'lof_custom_configs',
  CODE_GROUPS: 'lof_code_groups',
  ACTIVE_GROUP_ID: 'lof_active_group_id',
}

// 数据来源显示名称
const SOURCE_NAMES: Record<string, string> = {
  'TickFlow': 'TickFlow',
  '东财API': '东财API',
  'http': '东财API',
  'invalid': '无效',
  'manual': '手动输入',
}

// 生成唯一ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

export default function Home() {
  // 分组相关状态
  const [groups, setGroups] = useState<CodeGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  
  // 数据状态
  const [customConfigs, setCustomConfigs] = useState<Record<string, LOFConfig>>({})
  const [batchData, setBatchData] = useState<LOFBatchItem[]>([])
  const [historyData, setHistoryData] = useState<Record<string, LOFHistory>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const [editModal, setEditModal] = useState<{ code: string; config: LOFConfig } | null>(null)
  const [cacheStats, setCacheStats] = useState<{ count: number; types: Record<string, number> }>({ count: 0, types: {} })
  const [lastUpdateTime, setLastUpdateTime] = useState<number | null>(null)
  const [forceRefresh, setForceRefresh] = useState(false)
  
  // 分组管理弹窗
  const [groupModal, setGroupModal] = useState<{
    mode: 'create' | 'edit' | 'delete'
    group?: CodeGroup
  } | null>(null)
  const [newGroupName, setNewGroupName] = useState('')

  // 获取当前激活分组
  const activeGroup = groups.find(g => g.id === activeGroupId) || null
  const activeCodes = activeGroup?.codes || []

  // 从本地存储加载数据
  useEffect(() => {
    const savedGroups = localStorage.getItem(STORAGE_KEYS.CODE_GROUPS)
    const savedActiveId = localStorage.getItem(STORAGE_KEYS.ACTIVE_GROUP_ID)
    const savedConfigs = localStorage.getItem(STORAGE_KEYS.CUSTOM_CONFIGS)
    
    if (savedGroups) {
      try {
        const parsedGroups = JSON.parse(savedGroups)
        setGroups(parsedGroups)
        
        // 恢复激活分组
        if (savedActiveId && parsedGroups.some((g: CodeGroup) => g.id === savedActiveId)) {
          setActiveGroupId(savedActiveId)
        } else if (parsedGroups.length > 0) {
          setActiveGroupId(parsedGroups[0].id)
        }
      } catch (e) {
        console.error('加载分组失败:', e)
      }
    }
    
    if (savedConfigs) {
      try {
        setCustomConfigs(JSON.parse(savedConfigs))
      } catch (e) {
        console.error('加载自定义配置失败:', e)
      }
    }

    setCacheStats(dataCache.getStats())
  }, [])

  // 保存分组到本地存储
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CODE_GROUPS, JSON.stringify(groups))
  }, [groups])

  useEffect(() => {
    if (activeGroupId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_GROUP_ID, activeGroupId)
    }
  }, [activeGroupId])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_CONFIGS, JSON.stringify(customConfigs))
  }, [customConfigs])

  // 创建新分组
  const createGroup = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    
    const newGroup: CodeGroup = {
      id: generateId(),
      name: trimmed,
      codes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    setGroups(prev => [...prev, newGroup])
    setActiveGroupId(newGroup.id)
    return newGroup
  }

  // 重命名分组
  const renameGroup = (groupId: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed) return
    
    setGroups(prev => prev.map(g => 
      g.id === groupId 
        ? { ...g, name: trimmed, updatedAt: Date.now() }
        : g
    ))
  }

  // 删除分组
  const deleteGroup = (groupId: string) => {
    setGroups(prev => {
      const newGroups = prev.filter(g => g.id !== groupId)
      
      // 如果删除的是当前激活分组，切换到第一个分组
      if (activeGroupId === groupId && newGroups.length > 0) {
        setActiveGroupId(newGroups[0].id)
      } else if (newGroups.length === 0) {
        setActiveGroupId(null)
      }
      
      return newGroups
    })
    
    // 清除该分组代码的缓存
    const group = groups.find(g => g.id === groupId)
    if (group) {
      group.codes.forEach(code => {
        dataCache.delete('batch', code)
        dataCache.delete('history', code)
      })
    }
    setCacheStats(dataCache.getStats())
  }

  // 验证代码格式（支持A股、港股、美股）
  const isValidCode = (code: string): boolean => {
    const trimmed = code.trim().toUpperCase()
    // A股：6位数字（股票、指数、LOF）
    if (/^\d{6}$/.test(trimmed)) return true
    // A股带后缀
    if (/^\d{6}\.(SH|SZ)$/i.test(trimmed)) return true
    // 港股：4-5位数字 或 带.HK后缀
    if (/^\d{4,5}(\.HK)?$/i.test(trimmed)) return true
    // 美股：1-5个字母 或 带.US后缀
    if (/^[A-Z]{1,5}(\.US)?$/i.test(trimmed)) return true
    // 港股/美股指数名称（如HSI, NDX, GSPC等）
    if (/^[A-Z]{2,10}$/i.test(trimmed)) return true
    // 中文指数名称（如恒生指数、纳斯达克100）
    if (/[\u4e00-\u9fa5]/.test(trimmed)) return true
    return false
  }

  // 格式化代码（统一格式）
  const formatCode = (code: string): string => {
    const trimmed = code.trim().toUpperCase()
    // 已经带后缀的，保持原样
    if (/\.(HK|US|SH|SZ)$/i.test(trimmed)) return trimmed
    // 纯数字判断
    if (/^\d+$/.test(trimmed)) {
      if (trimmed.length === 6) return trimmed // A股
      if (trimmed.length === 4 || trimmed.length === 5) return trimmed.padStart(5, '0') + '.HK' // 港股
    }
    // 纯字母，加.US后缀
    if (/^[A-Z]+$/i.test(trimmed)) return trimmed + '.US'
    return trimmed
  }

  // 添加代码到当前分组
  const addCodesToGroup = (codes: string[], groupId?: string) => {
    const targetGroupId = groupId || activeGroupId
    if (!targetGroupId) return { added: 0, invalid: 0 }
    
    const validCodes = codes.filter(c => isValidCode(c)).map(c => formatCode(c))
    
    setGroups(prev => prev.map(g => {
      if (g.id !== targetGroupId) return g
      
      const existingCodes = new Set(g.codes)
      const newCodes = validCodes.filter(c => !existingCodes.has(c))
      
      return {
        ...g,
        codes: [...g.codes, ...newCodes],
        updatedAt: Date.now(),
      }
    }))
    
    return {
      added: validCodes.length,
      invalid: codes.length - validCodes.length,
    }
  }

  // 从当前分组移除代码
  const removeCodeFromGroup = (code: string, groupId?: string) => {
    const targetGroupId = groupId || activeGroupId
    if (!targetGroupId) return
    
    setGroups(prev => prev.map(g => {
      if (g.id !== targetGroupId) return g
      return {
        ...g,
        codes: g.codes.filter(c => c !== code),
        updatedAt: Date.now(),
      }
    }))
    
    // 清除该代码的缓存和数据
    setBatchData(prev => prev.filter(item => item.code !== code))
    setHistoryData(prev => {
      const newData = { ...prev }
      delete newData[code]
      return newData
    })
    dataCache.delete('batch', code)
    dataCache.delete('history', code)
    setCacheStats(dataCache.getStats())
  }

  // 批量添加代码：支持换行、中英文逗号分隔
  const parseAndAddCodes = (input: string) => {
    const normalized = input
      .replace(/，/g, ',')
      .replace(/\n/g, ',')
      .replace(/；/g, ',')
      .replace(/;/g, ',')
    
    const codes = normalized
      .split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0)
    
    return addCodesToGroup(codes)
  }

  const updateCustomConfig = (code: string, config: LOFConfig) => {
    setCustomConfigs(prev => ({
      ...prev,
      [code]: config
    }))
    setEditModal(null)
    dataCache.delete('batch', code)
    dataCache.delete('history', code)
    
    // 如果该代码在当前活跃分组中，强制刷新数据
    if (activeCodes.includes(code)) {
      setTimeout(() => fetchBatchData(true), 100)
    }
  }

  const fetchBatchData = useCallback(async (force: boolean = false) => {
    const codesToFetch = activeCodes
    
    if (codesToFetch.length === 0) {
      setError('当前分组没有基金代码，请先添加')
      return
    }
    
    setLoading(true)
    setError('')
    
    const now = Date.now()
    const results: LOFBatchItem[] = []
    const codesNeeded: string[] = []
    
    // 检查前端缓存
    if (!force) {
      for (const code of codesToFetch) {
        const { data, isStale } = dataCache.get<LOFBatchItem>('batch', code, false)
        if (!isStale && data) {
          results.push(data)
        } else {
          codesNeeded.push(code)
        }
      }
    } else {
      codesNeeded.push(...codesToFetch)
    }

    try {
      if (codesNeeded.length > 0) {
        const configParam = encodeURIComponent(JSON.stringify(customConfigs))
        const forceParam = force ? '&force=true' : ''
        const response = await fetch(`/api/lof?action=batch&codes=${codesNeeded.join(',')}&config=${configParam}${forceParam}`)
        const result = await response.json()
        
        if (result.error) {
          setError(result.error)
          if (results.length === 0) {
            setBatchData([])
          }
        } else {
          for (const item of result) {
            if (!item.error) {
              item._cachedAt = now
              dataCache.set('batch', item.code, item)
            }
            results.push(item)
          }
        }
      }

      // 按原始顺序排序
      const sortedResults = codesToFetch
        .map(code => results.find(r => r.code === code))
        .filter((item): item is LOFBatchItem => !!item)
      
      setBatchData(sortedResults)
      setLastUpdateTime(now)
      setCacheStats(dataCache.getStats())
      
      // 获取历史数据
      const historyResults: Record<string, LOFHistory> = { ...historyData }
      
      for (const item of sortedResults) {
        // 检查是否已有历史数据（从之前的缓存或获取）
        const existingHistory = historyData[item.code]
        
        // 如果已有有效的历史数据，直接使用
        if (existingHistory && existingHistory.history && existingHistory.history.length > 0) {
          historyResults[item.code] = existingHistory
        } else if (!item.error && item.code) {
          // 没有历史数据且主数据无错误，尝试获取
          const { data: cachedHistory, isStale } = dataCache.get<LOFHistory>('history', item.code, false)
          
          console.log(`[历史] ${item.code}: 缓存存在=${!!cachedHistory}, 数据过期=${isStale}, 历史数组长度=${cachedHistory?.history?.length}`)
          
          if (!isStale && cachedHistory && cachedHistory.history?.length > 0) {
            historyResults[item.code] = cachedHistory
          } else {
            try {
              const configParam = encodeURIComponent(JSON.stringify(customConfigs))
              const histResponse = await fetch(`/api/lof?action=history&code=${item.code}&config=${configParam}`)
              const histResult = await histResponse.json()
              console.log(`[历史API] ${item.code}: error=${histResult.error}, history长度=${histResult.history?.length}`)
              histResult._cachedAt = now
              historyResults[item.code] = histResult
              
              if (!histResult.error && histResult.history?.length > 0) {
                dataCache.set('history', item.code, histResult)
              }
            } catch (e) {
              console.error(`获取 ${item.code} 历史数据失败:`, e)
            }
          }
        }
      }
      
      console.log('[历史结果]', Object.keys(historyResults).map(k => `${k}: ${historyResults[k]?.history?.length || 0}条`))
      setHistoryData(historyResults)
      setCacheStats(dataCache.getStats())
      
    } catch (err) {
      setError('数据获取失败，请确保后端服务已启动')
      if (results.length === 0) {
        setBatchData([])
      }
    } finally {
      setLoading(false)
      setForceRefresh(false)
    }
  }, [activeCodes, customConfigs, historyData])

  const clearAllCache = () => {
    dataCache.clear()
    setBatchData([])
    setHistoryData({})
    setCacheStats(dataCache.getStats())
    setLastUpdateTime(null)
  }

  const formatNumber = (num: number | null | undefined, decimals: number = 4) => {
    if (num === null || num === undefined || isNaN(num)) return '-'
    return num.toFixed(decimals)
  }

  const formatPercent = (num: number | null | undefined, decimals: number = 2) => {
    if (num === null || num === undefined || isNaN(num)) return '-'
    const sign = num >= 0 ? '+' : ''
    return `${sign}${num.toFixed(decimals)}%`
  }

  const getSourceName = (source: string) => {
    return SOURCE_NAMES[source] || source
  }

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return '-'
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const getCacheAge = (cachedAt: number | undefined) => {
    if (!cachedAt) return null
    const age = Date.now() - cachedAt
    const seconds = Math.floor(age / 1000)
    if (seconds < 60) return `${seconds}秒前`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}分钟前`
    const hours = Math.floor(minutes / 60)
    return `${hours}小时前`
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* 标题栏 */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">LOF基金折溢价计算器</h1>
            <p className="text-slate-600 mt-1">实时估算 · 历史数据 · 估值误差分析 · 支持A股/港股/美股</p>
          </div>
          
          {/* 刷新按钮 */}
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500 text-right hidden sm:block">
              {lastUpdateTime && (
                <div>更新: {formatTime(lastUpdateTime)}</div>
              )}
              {cacheStats.count > 0 && (
                <div className="text-slate-400">缓存: {cacheStats.count}条</div>
              )}
            </div>
            
            <label className="flex items-center gap-1 text-sm text-slate-600 cursor-pointer" title="强制刷新会跳过缓存，获取最新的实时行情">
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              强制刷新
            </label>
            
            <button
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-md"
              onClick={() => fetchBatchData(forceRefresh)}
              disabled={loading || activeCodes.length === 0}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  获取中...
                </span>
              ) : (
                '🔄 刷新数据'
              )}
            </button>
            
            {cacheStats.count > 0 && (
              <button
                onClick={clearAllCache}
                className="px-3 py-2 text-sm text-slate-600 hover:text-red-600 border border-slate-300 rounded-lg hover:border-red-300"
                title="清除所有缓存数据"
              >
                🗑️ 清缓存
              </button>
            )}
          </div>
        </div>

        {/* 分组管理区域 */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            {/* 分组标签 */}
            <div className="flex flex-wrap gap-2 flex-1">
              {groups.length === 0 ? (
                <span className="text-slate-400 text-sm">暂无分组，请创建新分组</span>
              ) : (
                groups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => setActiveGroupId(group.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      activeGroupId === group.id
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {group.name}
                    <span className="ml-2 text-xs opacity-70">({group.codes.length})</span>
                  </button>
                ))
              )}
            </div>
            
            {/* 分组操作按钮 */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setNewGroupName('')
                  setGroupModal({ mode: 'create' })
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
              >
                + 新建分组
              </button>
              {activeGroup && (
                <>
                  <button
                    onClick={() => {
                      setNewGroupName(activeGroup.name)
                      setGroupModal({ mode: 'edit', group: activeGroup })
                    }}
                    className="px-3 py-2 text-slate-600 hover:text-blue-600 border border-slate-300 rounded-lg text-sm"
                    title="重命名分组"
                  >
                    ✏️ 重命名
                  </button>
                  <button
                    onClick={() => {
                      setGroupModal({ mode: 'delete', group: activeGroup })
                    }}
                    className="px-3 py-2 text-slate-600 hover:text-red-600 border border-slate-300 rounded-lg text-sm"
                    title="删除分组"
                  >
                    🗑️ 删除
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 添加LOF代码 */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 mb-6">
          {activeGroup ? (
            <>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="font-medium text-slate-700">当前分组：{activeGroup.name}</span>
                  <span>·</span>
                  <span>已添加 {activeCodes.length} 个代码</span>
                </div>
                <textarea
                  placeholder="输入代码，支持全市场行情查询：&#10;• A股股票：600519, 000001&#10;• A股指数：000300, 399006, 000905&#10;• A股LOF：161725, 161130&#10;• 港股股票：00700.HK, 02800.HK&#10;• 港股指数：HSI, 恒生指数&#10;• 美股股票：AAPL.US, QQQ.US&#10;• 美股指数：NDX, GSPC, 标普500&#10;• 用换行或中英文逗号分隔"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] resize-y"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                      const textarea = e.target as HTMLTextAreaElement
                      const result = parseAndAddCodes(textarea.value)
                      if (result.added > 0) {
                        textarea.value = ''
                      }
                    }
                  }}
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const textarea = document.querySelector('textarea') as HTMLTextAreaElement
                      const result = parseAndAddCodes(textarea.value)
                      if (result.added > 0) {
                        textarea.value = ''
                      }
                    }}
                    className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700"
                  >
                    添加到分组
                  </button>
                  <span className="text-xs text-slate-400">提示：Ctrl+Enter 快速添加</span>
                </div>
              </div>
              
              {/* 已选择的代码标签 */}
              {activeCodes.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {activeCodes.map(code => {
                    const item = batchData.find(d => d.code === code)
                    const hasCustom = !!customConfigs[code]
                    return (
                      <span
                        key={code}
                        className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${
                          hasCustom ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        <span className="font-medium">{code}</span>
                        {item?.name && <span className="ml-1 text-xs opacity-70">({item.name.slice(0, 4)})</span>}
                        {hasCustom && <span className="ml-1 text-xs" title="已自定义配置">⚙️</span>}
                        <button
                          className="ml-2 hover:text-red-500 font-bold"
                          onClick={() => removeCodeFromGroup(code)}
                        >
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-4 text-slate-500">
              <p>请先创建一个分组来管理您的基金代码</p>
              <button
                onClick={() => {
                  setNewGroupName('')
                  setGroupModal({ mode: 'create' })
                }}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                创建第一个分组
              </button>
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-6">
            {error}
          </div>
        )}

        {/* 实时数据表格 */}
        {batchData.length > 0 && (
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm mb-6">
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">
                    实时折溢价一览
                    {activeGroup && <span className="text-sm font-normal text-slate-500 ml-2">- {activeGroup.name}</span>}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    点击行展开查看历史数据，勾选"强制刷新"跳过缓存
                  </p>
                </div>
                {lastUpdateTime && (
                  <div className="text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                    📅 {formatTime(lastUpdateTime)} 更新
                  </div>
                )}
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-3 text-left font-medium">代码</th>
                    <th className="px-3 py-3 text-left font-medium">名称</th>
                    <th className="px-3 py-3 text-right font-medium">前日净值</th>
                    <th className="px-3 py-3 text-right font-medium">今日净值</th>
                    <th className="px-3 py-3 text-right font-medium">现价</th>
                    <th className="px-3 py-3 text-right font-medium">涨跌幅</th>
                    <th className="px-3 py-3 text-right font-medium">指数涨跌</th>
                    <th className="px-3 py-3 text-right font-medium">估算净值</th>
                    <th className="px-3 py-3 text-right font-medium">估算溢价</th>
                    <th className="px-3 py-3 text-right font-medium">估值误差</th>
                    <th className="px-3 py-3 text-center font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {batchData.map((item) => (
                    <Fragment key={item.code}>
                      <tr
                        className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${
                          expandedCode === item.code ? 'bg-blue-50' : ''
                        } ${item.error ? 'bg-red-50' : ''}`}
                        onClick={() => setExpandedCode(expandedCode === item.code ? null : item.code)}
                      >
                        <td className="px-3 py-3 font-medium">
                          <div className="flex items-center gap-1">
                            {item.code}
                            {item._cachedAt && (
                              <span className="text-xs text-blue-500" title={`缓存于 ${getCacheAge(item._cachedAt)}`}>
                                💾
                              </span>
                            )}
                          </div>
                          {item.data_sources && (
                            <div className="text-xs text-slate-400 mt-0.5">
                              来源: {getSourceName(item.data_sources.quote)}/{getSourceName(item.data_sources.nav)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 max-w-[120px] truncate">
                          {item.error ? (
                            <span className="text-red-500">{item.error}</span>
                          ) : (
                            item.name || '-'
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.prev_nav ? formatNumber(item.prev_nav) : '-'}
                          <div className="text-xs text-slate-400">{item.prev_nav_date || ''}</div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.nav_updated_today && item.today_nav ? (
                            <>
                              <span className="text-green-600">{formatNumber(item.today_nav)}</span>
                              <div className="text-xs text-green-500">{item.today_nav_date}</div>
                            </>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-medium">{item.price ? formatNumber(item.price, 3) : '-'}</td>
                        <td className="px-3 py-3 text-right">
                          {item.change_percent !== null ? (
                            <span className={item.change_percent >= 0 ? 'text-red-600' : 'text-green-600'}>
                              {formatPercent(item.change_percent)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.indices && item.indices.length > 0 ? (
                            <>
                              {item.indices.map((idx, i) => (
                                <div key={i} className="flex items-center justify-end gap-1">
                                  {idx.change_percent !== null ? (
                                    <span className={idx.change_percent >= 0 ? 'text-red-600' : 'text-green-600'}>
                                      {formatPercent(idx.change_percent)}
                                    </span>
                                  ) : '-'}
                                  <span className="text-xs text-slate-400">({idx.index_name}×{idx.coefficient})</span>
                                </div>
                              ))}
                              {item.indices.length > 1 && item.total_index_change !== null && (
                                <div className="text-xs text-blue-600 mt-1">
                                  综合: {formatPercent(item.total_index_change)}
                                </div>
                              )}
                            </>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-3 text-right text-blue-600 font-medium">
                          {item.estimated_nav ? formatNumber(item.estimated_nav) : '-'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.premium !== null ? (
                            <span className={`font-bold ${item.premium >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {formatPercent(item.premium)}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.estimation_error !== null ? (
                            <span className={`font-medium ${Math.abs(item.estimation_error) > 1 ? 'text-orange-600' : 'text-slate-600'}`}>
                              {formatPercent(item.estimation_error)}
                            </span>
                          ) : '-'}
                          {item.nav_updated_today && (
                            <div className="text-xs text-green-600">已更新</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            className="text-blue-600 hover:text-blue-800 text-sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditModal({
                                code: item.code,
                                config: customConfigs[item.code] || {
                                  indices: item.indices?.map(idx => ({
                                    index_code: idx.index_code,
                                    index_name: idx.index_name,
                                    coefficient: idx.coefficient
                                  })) || [{ index_code: '', index_name: '', coefficient: 0.95 }]
                                }
                              })
                            }}
                          >
                            修改
                          </button>
                        </td>
                      </tr>
                      
                      {/* 历史数据展开行 */}
                      {expandedCode === item.code && historyData[item.code] && historyData[item.code].history && historyData[item.code].history.length > 0 && (
                        <tr>
                          <td colSpan={11} className="px-4 py-4 bg-slate-50">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-sm font-medium text-slate-700">
                                📊 近30日历史数据
                                {historyData[item.code].data_sources && (
                                  <span className="text-xs text-slate-400 ml-2">
                                    来源: {getSourceName(historyData[item.code].data_sources.nav)}/{getSourceName(historyData[item.code].data_sources.kline || '')}
                                  </span>
                                )}
                              </div>
                              {historyData[item.code]._cachedAt && (
                                <span className="text-xs text-blue-500">
                                  💾 缓存于 {getCacheAge(historyData[item.code]._cachedAt)}
                                </span>
                              )}
                            </div>
                            <div className="overflow-x-auto max-h-60 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-slate-100">
                                  <tr>
                                    <th className="px-2 py-1 text-left">日期</th>
                                    <th className="px-2 py-1 text-right">净值</th>
                                    <th className="px-2 py-1 text-right">收盘价</th>
                                    <th className="px-2 py-1 text-right">折溢价</th>
                                    <th className="px-2 py-1 text-right">指数涨跌</th>
                                    <th className="px-2 py-1 text-right">估算净值</th>
                                    <th className="px-2 py-1 text-right">估算误差</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {historyData[item.code].history?.map((h) => (
                                    <tr key={h.date} className="border-b border-slate-100">
                                      <td className="px-2 py-1">{h.date}</td>
                                      <td className="px-2 py-1 text-right">{h.nav ? formatNumber(h.nav) : '-'}</td>
                                      <td className="px-2 py-1 text-right">{h.price ? formatNumber(h.price, 3) : '-'}</td>
                                      <td className="px-2 py-1 text-right">
                                        {h.premium !== null ? (
                                          <span className={h.premium >= 0 ? 'text-red-600' : 'text-green-600'}>
                                            {formatPercent(h.premium)}
                                          </span>
                                        ) : '-'}
                                      </td>
                                      <td className="px-2 py-1 text-right">
                                        {h.index_change !== null ? (
                                          <span className={h.index_change >= 0 ? 'text-red-600' : 'text-green-600'}>
                                            {formatPercent(h.index_change)}
                                          </span>
                                        ) : '-'}
                                      </td>
                                      <td className="px-2 py-1 text-right text-blue-600">
                                        {h.estimated_nav ? formatNumber(h.estimated_nav) : '-'}
                                      </td>
                                      <td className="px-2 py-1 text-right">
                                        {h.estimation_error !== null ? (
                                          <span className={Math.abs(h.estimation_error) > 1 ? 'text-orange-600' : 'text-slate-600'}>
                                            {formatPercent(h.estimation_error)}
                                          </span>
                                        ) : '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* 计算说明 */}
            <div className="p-3 bg-blue-50 border-t border-slate-200">
              <div className="text-sm text-blue-700">
                <strong>计算说明：</strong>
                <span className="mx-2">|</span>
                估算净值 = 前日净值 × (1 + Σ(指数涨跌幅 × 校正系数))
                <span className="mx-2">|</span>
                估算溢价 = (现价 - 估算净值) / 估算净值 × 100%
                <span className="mx-2">|</span>
                估值误差 = (实际净值 - 估算净值) / 估算净值 × 100%（今日净值更新后显示）
              </div>
            </div>
          </div>
        )}

        {/* 无数据提示 */}
        {batchData.length === 0 && !loading && activeGroup && (
          <div className="text-center py-12 text-slate-500 bg-white rounded-lg border border-slate-200">
            <p className="text-lg">当前分组暂无数据</p>
            <p className="text-sm mt-2">请在上方添加LOF基金代码后点击"刷新数据"</p>
          </div>
        )}

        {/* 分组管理弹窗 */}
        {groupModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
              {groupModal.mode === 'create' && (
                <>
                  <h3 className="text-lg font-semibold mb-4">新建分组</h3>
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="请输入分组名称"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newGroupName.trim()) {
                        createGroup(newGroupName)
                        setGroupModal(null)
                      }
                    }}
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => setGroupModal(null)}
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        if (newGroupName.trim()) {
                          createGroup(newGroupName)
                          setGroupModal(null)
                        }
                      }}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      创建
                    </button>
                  </div>
                </>
              )}
              
              {groupModal.mode === 'edit' && groupModal.group && (
                <>
                  <h3 className="text-lg font-semibold mb-4">重命名分组</h3>
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="请输入新的分组名称"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newGroupName.trim()) {
                        renameGroup(groupModal.group!.id, newGroupName)
                        setGroupModal(null)
                      }
                    }}
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => setGroupModal(null)}
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        if (newGroupName.trim()) {
                          renameGroup(groupModal.group!.id, newGroupName)
                          setGroupModal(null)
                        }
                      }}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      保存
                    </button>
                  </div>
                </>
              )}
              
              {groupModal.mode === 'delete' && groupModal.group && (
                <>
                  <h3 className="text-lg font-semibold mb-4">删除分组</h3>
                  <p className="text-slate-600 mb-4">
                    确定要删除分组「<strong>{groupModal.group.name}</strong>」吗？
                    <br />
                    <span className="text-sm text-slate-500">
                      该分组下有 {groupModal.group.codes.length} 个代码将一并移除。
                    </span>
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setGroupModal(null)}
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        deleteGroup(groupModal.group!.id)
                        setGroupModal(null)
                      }}
                      className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      删除
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 修改配置弹窗 */}
        {editModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">修改指数配置 - {editModal.code}</h3>
              
              <div className="space-y-4">
                <div className="text-sm text-slate-500 mb-2">
                  支持配置最多3个追踪指数，估算净值 = 前日净值 × (1 + Σ(指数涨跌幅 × 系数))
                </div>
                
                {editModal.config.indices.map((idx, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">指数 {i + 1}</span>
                      {editModal.config.indices.length > 1 && (
                        <button
                          className="text-red-500 text-xs hover:text-red-700"
                          onClick={() => {
                            const newIndices = editModal.config.indices.filter((_, idx) => idx !== i)
                            setEditModal({
                              ...editModal,
                              config: { ...editModal.config, indices: newIndices }
                            })
                          }}
                        >
                          删除
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">指数代码</label>
                        <input
                          type="text"
                          value={idx.index_code}
                          onChange={(e) => {
                            const newIndices = [...editModal.config.indices]
                            newIndices[i] = { ...newIndices[i], index_code: e.target.value }
                            setEditModal({
                              ...editModal,
                              config: { ...editModal.config, indices: newIndices }
                            })
                          }}
                          placeholder="如：399997"
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">指数名称</label>
                        <input
                          type="text"
                          value={idx.index_name}
                          onChange={(e) => {
                            const newIndices = [...editModal.config.indices]
                            newIndices[i] = { ...newIndices[i], index_name: e.target.value }
                            setEditModal({
                              ...editModal,
                              config: { ...editModal.config, indices: newIndices }
                            })
                          }}
                          placeholder="如：中证白酒"
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">校正系数</label>
                        <input
                          type="number"
                          step="0.01"
                          value={idx.coefficient}
                          onChange={(e) => {
                            const newIndices = [...editModal.config.indices]
                            newIndices[i] = { ...newIndices[i], coefficient: parseFloat(e.target.value) || 0.95 }
                            setEditModal({
                              ...editModal,
                              config: { ...editModal.config, indices: newIndices }
                            })
                          }}
                          className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                
                {editModal.config.indices.length < 3 && (
                  <button
                    className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-blue-400 hover:text-blue-500 text-sm"
                    onClick={() => {
                      setEditModal({
                        ...editModal,
                        config: {
                          ...editModal.config,
                          indices: [...editModal.config.indices, { index_code: '', index_name: '', coefficient: 0.95 }]
                        }
                      })
                    }}
                  >
                    + 添加指数
                  </button>
                )}
                
                <div className="text-xs text-slate-400 mt-2">
                  常用指数代码：<br/>
                  • A股：399997(中证白酒)、000932(中证消费)、399989(中证医疗)、399967(中证军工)、000300(沪深300)、000905(中证500)、399006(创业板指)<br/>
                  • 港股指数：HSI(恒生指数)、HSSTECH(恒生科技) - 使用Yahoo Finance真实指数<br/>
                  • 美股指数：NDX(纳斯达克100)、GSPC(标普500)、DJI(道琼斯) - 使用Yahoo Finance真实指数
                </div>
              </div>
              
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setEditModal(null)}
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={() => updateCustomConfig(editModal.code, editModal.config)}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 页脚 */}
        <footer className="mt-8 text-center text-sm text-slate-500">
          <p>数据来源：TickFlow(A股行情) + Yahoo Finance(港美股指数) + 东财API(LOF净值) | 仅供参考，不构成投资建议</p>
        </footer>
      </div>
    </div>
  )
}
