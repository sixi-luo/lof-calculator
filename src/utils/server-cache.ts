/**
 * 服务端内存缓存
 * 用于缓存API响应，减少对外部API的请求
 */

interface CacheEntry<T> {
  data: T
  expiresAt: number
  createdAt: number
}

// 重试配置
const RETRY_CONFIG = {
  maxRetries: parseInt(process.env.API_RETRY_ATTEMPTS || '3'),
  baseDelay: parseInt(process.env.API_RETRY_DELAY || '1000'), // 毫秒
}

// 缓存配置（毫秒）
const CACHE_TTL = {
  // 实时行情：30秒（强制刷新可跳过）
  quote: parseInt(process.env.CACHE_QUOTE_TTL || '30000'),
  // 净值数据：5分钟
  nav: parseInt(process.env.CACHE_NAV_TTL || '300000'),
  // 指数行情：30秒（强制刷新可跳过）
  index: parseInt(process.env.CACHE_INDEX_TTL || '30000'),
  // K线数据：1天（历史K线不会变化）
  kline: parseInt(process.env.CACHE_KLINE_TTL || '86400000'),
  // 批量查询结果：1分钟（强制刷新可跳过）
  batch: parseInt(process.env.CACHE_BATCH_TTL || '60000'),
  // 历史数据：1天（历史数据不会变化）
  history: parseInt(process.env.CACHE_HISTORY_TTL || '86400000'),
}

class ServerCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // 每5分钟清理过期缓存
    if (typeof window === 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000)
    }
  }

  private cleanup() {
    const now = Date.now()
    let cleaned = 0
    this.cache.forEach((entry, key) => {
      if (entry.expiresAt <= now) {
        this.cache.delete(key)
        cleaned++
      }
    })
    if (cleaned > 0) {
      console.log(`[Cache] 清理了 ${cleaned} 个过期缓存`)
    }
  }

  private genKey(type: string, ...parts: string[]): string {
    return `${type}:${parts.join(':')}`
  }

  /**
   * 获取缓存
   */
  get<T>(type: string, ...parts: string[]): T | null {
    const key = this.genKey(type, ...parts)
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    
    if (!entry) {
      return null
    }

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key)
      return null
    }

    return entry.data
  }

  /**
   * 设置缓存
   */
  set<T>(type: string, data: T, ...parts: string[]): void {
    const ttl = CACHE_TTL[type as keyof typeof CACHE_TTL] || 60 * 1000
    const key = this.genKey(type, ...parts)
    const now = Date.now()

    this.cache.set(key, {
      data,
      expiresAt: now + ttl,
      createdAt: now,
    })
  }

  /**
   * 删除缓存
   */
  delete(type: string, ...parts: string[]): void {
    const key = this.genKey(type, ...parts)
    this.cache.delete(key)
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * 获取缓存统计
   */
  getStats(): { size: number; types: Record<string, number> } {
    const types: Record<string, number> = {}
    
    this.cache.forEach((_, key) => {
      const type = key.split(':')[0]
      types[type] = (types[type] || 0) + 1
    })

    return {
      size: this.cache.size,
      types,
    }
  }

  /**
   * 带缓存的异步获取函数
   * @param forceRefresh 是否强制刷新（跳过缓存）
   */
  async getOrFetch<T>(
    type: string,
    fetcher: () => Promise<T>,
    options?: { forceRefresh?: boolean; keyParts?: string[] }
  ): Promise<T> {
    const keyParts = options?.keyParts || []
    const forceRefresh = options?.forceRefresh || false

    // 强制刷新时跳过缓存
    if (forceRefresh) {
      console.log(`[Cache] 强制刷新: ${type}:${keyParts.join(':')}`)
      const data = await this.retryFetch(fetcher, type, keyParts)
      this.set(type, data, ...keyParts)
      return data
    }

    // 尝试从缓存获取
    const cached = this.get<T>(type, ...keyParts)
    if (cached !== null) {
      console.log(`[Cache] 命中: ${type}:${keyParts.join(':')}`)
      return cached
    }

    // 缓存未命中，执行获取
    console.log(`[Cache] 未命中: ${type}:${keyParts.join(':')}`)
    const data = await this.retryFetch(fetcher, type, keyParts)
    
    // 存入缓存
    this.set(type, data, ...keyParts)
    
    return data
  }

  /**
   * 重试获取函数
   */
  private async retryFetch<T>(fetcher: () => Promise<T>, type: string, keyParts: string[]): Promise<T> {
    const maxRetries = RETRY_CONFIG.maxRetries
    const baseDelay = RETRY_CONFIG.baseDelay
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fetcher()
      } catch (error) {
        console.warn(`[Cache] ${type}:${keyParts.join(':')} 获取失败 (尝试 ${attempt}/${maxRetries}):`, error)
        
        if (attempt === maxRetries) {
          throw error // 最后一次尝试后抛出错误
        }
        
        // 指数退避延迟
        const delay = baseDelay * Math.pow(2, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    
    // 永远不会到达这里，因为循环会在最后一次尝试后抛出错误
    throw new Error('重试逻辑异常')
  }
}

// 单例导出
export const serverCache = new ServerCache()

// 导出缓存配置供外部使用
export { CACHE_TTL }
