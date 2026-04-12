// 内置LOF基金名单

export interface LOFFund {
  code: string
  name: string
  indexCode: string
  indexName: string
  coefficient: number
  category: string
}

export const LOF_FUND_LIST: LOFFund[] = [
  // 消费
  { code: '161725', name: '招商白酒LOF', indexCode: '399997', indexName: '中证白酒', coefficient: 0.95, category: '消费' },
  { code: '161118', name: '消费LOF', indexCode: '000932', indexName: '中证主要消费', coefficient: 0.95, category: '消费' },
  { code: '161119', name: '易基消费LOF', indexCode: '000932', indexName: '中证主要消费', coefficient: 0.95, category: '消费' },
  { code: '160119', name: '综指LOF', indexCode: '000300', indexName: '沪深300', coefficient: 0.95, category: '宽基' },
  
  // 医药
  { code: '161035', name: '医药LOF', indexCode: '399989', indexName: '中证医疗', coefficient: 0.95, category: '医药' },
  { code: '161122', name: '医疗LOF', indexCode: '399989', indexName: '中证医疗', coefficient: 0.95, category: '医药' },
  
  // 新能源
  { code: '161028', name: '新能源车LOF', indexCode: '399808', indexName: '中证新能源', coefficient: 0.95, category: '新能源' },
  
  // 军工
  { code: '161024', name: '军工LOF', indexCode: '399967', indexName: '中证军工', coefficient: 0.95, category: '军工' },
  
  // 金融
  { code: '161720', name: '证券LOF', indexCode: '399975', indexName: '中证全指证券公司', coefficient: 0.95, category: '金融' },
  { code: '161723', name: '银行LOF', indexCode: '399986', indexName: '中证银行', coefficient: 0.95, category: '金融' },
  
  // 基建
  { code: '161038', name: '环保LOF', indexCode: '000827', indexName: '中证环保', coefficient: 0.95, category: '基建' },
  { code: '161726', name: '基建LOF', indexCode: '000022', indexName: '中证基建', coefficient: 0.95, category: '基建' },
  
  // 资源
  { code: '160620', name: '有色LOF', indexCode: '000979', indexName: '有色金属', coefficient: 0.95, category: '资源' },
  
  // 科技
  { code: '161632', name: '信息安全LOF', indexCode: '399994', indexName: '信息安全', coefficient: 0.95, category: '科技' },
  { code: '161729', name: '传媒LOF', indexCode: '399971', indexName: '中证传媒', coefficient: 0.95, category: '科技' },
  
  // 商品
  { code: '161116', name: '易方达黄金LOF', indexCode: 'AU9999', indexName: '黄金现货', coefficient: 0.99, category: '商品' },
  { code: '164701', name: '黄金LOF', indexCode: 'AU9999', indexName: '黄金现货', coefficient: 0.99, category: '商品' },
  
  // 海外
  { code: '161831', name: '恒生LOF', indexCode: 'HSI', indexName: '恒生指数', coefficient: 0.95, category: '海外' },
  { code: '160125', name: '恒指LOF', indexCode: 'HSI', indexName: '恒生指数', coefficient: 0.95, category: '海外' },
  { code: '160323', name: '纳指LOF', indexCode: 'HSI', indexName: '恒生指数', coefficient: 0.95, category: '海外' },
  { code: '161130', name: '纳指LOF', indexCode: 'NDX', indexName: '纳斯达克100', coefficient: 0.95, category: '海外' },
  { code: '160140', name: '标普LOF', indexCode: 'GSPC', indexName: '标普500', coefficient: 0.95, category: '海外' },
  { code: '160416', name: '标普LOF', indexCode: 'GSPC', indexName: '标普500', coefficient: 0.95, category: '海外' },
  { code: '160723', name: '纳指LOF', indexCode: 'NDX', indexName: '纳斯达克100', coefficient: 0.95, category: '海外' },
  { code: '160930', name: '标普LOF', indexCode: 'GSPC', indexName: '标普500', coefficient: 0.95, category: '海外' },
  
  // 宽基
  { code: '161811', name: '沪深300LOF', indexCode: '000300', indexName: '沪深300', coefficient: 0.95, category: '宽基' },
  { code: '161717', name: '中证500LOF', indexCode: '000905', indexName: '中证500', coefficient: 0.95, category: '宽基' },
  { code: '161913', name: '创业板LOF', indexCode: '399006', indexName: '创业板指', coefficient: 0.95, category: '宽基' },
]

export const LOF_CATEGORIES = [...new Set(LOF_FUND_LIST.map(f => f.category))]

export function getLOFByCode(code: string): LOFFund | undefined {
  return LOF_FUND_LIST.find(f => f.code === code)
}
