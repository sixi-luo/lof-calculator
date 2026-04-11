/**
 * 数据缓存工具
 * 支持缓存过期时间，用于减少API请求
 */

interface CacheItem<T> {
  data: T
  timestamp: number
  expiresAt: number
}

interface CacheConfig {
  /** 缓存有效期（毫秒） */
  ttl: number
  /** 是否启用缓存 */
  enabled: boolean
}

// 默认缓存配置
const DEFAULT_CONFIGS: Record<string, CacheConfig> = {
  // 实时行情数据：缓存30秒（强制刷新可跳过）
  quote: { ttl: 30 * 1000, enabled: true },
  // 净值数据：缓存5分钟
  nav: { ttl: 5 * 60 * 1000, enabled: true },
  // 批量数据：缓存1分钟（强制刷新可跳过）
  batch: { ttl: 60 * 1000, enabled: true },
  // 历史数据：缓存1天（历史数据不会变化）
  history: { ttl: 24 * 60 * 60 * 1000, enabled: true },
}

class DataCache {
  private cache: Map<string, CacheItem<unknown>> = new Map()
  private storageKey = 'lof_data_cache'

  constructor() {
    // 从localStorage加载持久化缓存
    this.loadFromStorage()
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return
    
    try {
      const saved = localStorage.getItem(this.storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        const now = Date.now()
        
        // 只加载未过期的缓存
        for (const [key, item] of Object.entries(parsed)) {
          const cacheItem = item as CacheItem<unknown>
          if (cacheItem.expiresAt > now) {
            this.cache.set(key, cacheItem)
          }
        }
      }
    } catch (e) {
      console.warn('加载缓存失败:', e)
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return
    
    try {
      const obj: Record<string, CacheItem<unknown>> = {}
      this.cache.forEach((value, key) => {
        obj[key] = value
      })
      localStorage.setItem(this.storageKey, JSON.stringify(obj))
    } catch (e) {
      // localStorage满了，清理旧缓存
      console.warn('保存缓存失败，清理旧缓存:', e)
      this.clearExpired()
    }
  }

  private clearExpired() {
    const now = Date.now()
    const keysToDelete: string[] = []
    
    this.cache.forEach((item, key) => {
      if (item.expiresAt <= now) {
        keysToDelete.push(key)
      }
    })
    
    keysToDelete.forEach(key => this.cache.delete(key))
  }

  /**
   * 生成缓存键
   */
  private genKey(type: string, identifier: string): string {
    return `${type}:${identifier}`
  }

  /**
   * 获取缓存
   * @param forceRefresh 是否强制刷新（跳过缓存）
   */
  get<T>(type: string, identifier: string, forceRefresh: boolean = false): { data: T | null; remaining: number; isStale: boolean } {
    const config = DEFAULT_CONFIGS[type]
    if (!config?.enabled || forceRefresh) {
      return { data: null, remaining: 0, isStale: true }
    }

    const key = this.genKey(type, identifier)
    const item = this.cache.get(key) as CacheItem<T> | undefined
    
    if (!item) {
      return { data: null, remaining: 0, isStale: true }
    }

    const now = Date.now()
    const remaining = Math.max(0, item.expiresAt - now)
    const isStale = remaining === 0

    if (isStale) {
      this.cache.delete(key)
      return { data: null, remaining: 0, isStale: true }
    }

    return { data: item.data, remaining, isStale: false }
  }

  /**
   * 设置缓存
   */
  set<T>(type: string, identifier: string, data: T, customTtl?: number): void {
    const config = DEFAULT_CONFIGS[type]
    if (!config?.enabled) return

    const ttl = customTtl ?? config.ttl
    const now = Date.now()
    const key = this.genKey(type, identifier)

    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + ttl,
    })

    this.saveToStorage()
  }

  /**
   * 删除缓存
   */
  delete(type: string, identifier: string): void {
    const key = this.genKey(type, identifier)
    this.cache.delete(key)
    this.saveToStorage()
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear()
    if (typeof window !== 'undefined') {
      localStorage.removeItem(this.storageKey)
    }
  }

  /**
   * 清除特定类型的缓存
   */
  clearType(type: string): void {
    const prefix = `${type}:`
    const keysToDelete: string[] = []
    
    this.cache.forEach((_, key) => {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key)
      }
    })
    
    keysToDelete.forEach(key => this.cache.delete(key))
    this.saveToStorage()
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { count: number; types: Record<string, number> } {
    const types: Record<string, number> = {}
    
    this.cache.forEach((_, key) => {
      const type = key.split(':')[0]
      types[type] = (types[type] || 0) + 1
    })

    return {
      count: this.cache.size,
      types,
    }
  }

  /**
   * 格式化剩余时间为可读字符串
   */
  formatRemaining(ms: number): string {
    if (ms <= 0) return '已过期'
    
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}秒后过期`
    
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}分钟后过期`
    
    const hours = Math.floor(minutes / 60)
    return `${hours}小时后过期`
  }
}

// 单例导出
export const dataCache = new DataCache()

// 导出类型
export type { CacheConfig, CacheItem }
