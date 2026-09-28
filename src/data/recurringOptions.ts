/**
 * 周期支出的平台与账户快选常量。
 *
 * ⚠ 这些中文值是持久化在 SQLite 里的规范值（recurrings.payment_platform / fund_account）；
 * 展示层的快选列表经 t() 翻译显示，落库存的还是这里的规范值。
 */
export const PAYMENT_PLATFORM_OPTIONS = ['微信', '支付宝', 'Apple Pay', '谷歌支付', '云闪付', 'PayPal']
export const FUND_ACCOUNT_OPTIONS = ['银行卡', '微信零钱', '支付宝余额', '信用卡', '现金']
