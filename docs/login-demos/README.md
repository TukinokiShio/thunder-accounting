# 雷霆记账登录注册 Demo 方向评审

本目录是独立视觉 Demo，不接入真实认证，也不修改 `src/pages/Login.tsx`。打开 `index.html` 进入方向选择页。

## 方向矩阵

| Demo | 视觉方向 | 关键词 | 适合的产品印象 |
|---|---|---|---|
| `demo-quiet.html` | 安静品牌型 | 浅蓝、留白、稳定、轻量品牌图形 | 长期使用、低压力、亲和 |
| `demo-lightning.html` | 雷电科技型 | 深色、蓝青电弧、控制台、速度感 | 品牌识别强、年轻、技术感 |
| `demo-ledger.html` | 账本工具型 | 账页、收支摘要、工具结构、数据感 | 产品属性明确、专业、务实 |

## Aurora v4 设计契约

- Surface：product / auth / operate
- 默认主题：light；雷电科技型提供 dark 方向
- Accent：tech-blue；允许 cyan 作为雷电型辅助色
- 组件：1px border、单层 surface、44px 触控目标、可见 `:focus-visible`
- 动效：仅 hover/press 轻动效；`prefers-reduced-motion` 下关闭
- 断点：640px / 1024px / 1440px
- 验收：由用户基于本地真实窗口最终裁定；静态或无头检查不能替代视觉验收

## 评审方式

请优先比较：

1. 是否一眼识别出“雷霆记账”；
2. 登录、注册、找回密码的层级是否清楚；
3. 默认窗口高度下信息是否完整；
4. 你愿意长期使用哪一种。
