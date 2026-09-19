/**
 * 周期支出的快选选项与默认分类常量（v2.0）。
 *
 * ⚠ 这些中文值是**持久化在 SQLite 里的数据**（recurrings.payment_platform / fund_account /
 * category1），与预设分类（src/data/categories.ts）同理 —— 是数据、不是 UI 文案；
 * 展示层的快选列表经 t() 翻译显示，落库存的还是这里的规范值。
 */
export const PAYMENT_PLATFORM_OPTIONS = ['微信', '支付宝', 'Apple Pay', '谷歌支付', '云闪付', 'PayPal']
export const FUND_ACCOUNT_OPTIONS = ['银行卡', '微信零钱', '支付宝余额', '信用卡', '现金']

/** 入账分类快选（均取自现有预设分类，不新增分类） */
export const SUBSCRIPTION_CATEGORY_OPTIONS = ['其他杂项', '娱乐休闲', '教育学习', '住房物业']
export const DCA_CATEGORY_OPTIONS = ['金融保险', '其他杂项']

/** 按类型给默认分类：订阅 → 其他杂项，定投 → 金融保险（PRD §五） */
export function defaultCategoryFor(type: 'subscription' | 'dca'): string {
  return type === 'dca' ? '金融保险' : '其他杂项'
}
