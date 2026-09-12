/**
 * Portal 模态层的作用域替身（v1.17.5）。
 *
 * 模态经 createPortal 挂到 document.body 后，脱离了 `.aurora-shell` / `.dark` 子树，会丢失两层上下文：
 *  ① `.aurora-shell .xxx-dialog` 后代版式规则（弹窗宽度 / 最大高度 / 表单 flex 布局，见 index.css）
 *  ② `.dark, [data-theme='dark']` 的 CSS 变量覆盖，以及 Tailwind `dark:` 变体（darkMode: 'class' 要求祖先）
 * 因此模态根元素必须同时带上 `.aurora-shell.aurora-portal-root`（替身，配色见 index.css 对应覆盖规则）
 * 与主题标记，才能在不回到应用树内的前提下保有完整样式与主题。
 *
 * 主题来源与应用外壳一致（localStorage['thunder_theme']，由 Layout.tsx 写入），不引入第二处真值。
 */
export const MODAL_PORTAL_ROOT_CLASS = 'aurora-shell aurora-portal-root'

export interface ModalPortalScope {
  className: string
  'data-theme': 'light' | 'dark'
}

/** 读取当前主题并返回模态根所需的作用域属性；每次渲染调用即可跟随主题变化。 */
export function modalPortalScope(): ModalPortalScope {
  let dark = false
  try {
    dark = localStorage.getItem('thunder_theme') === 'dark'
  } catch {
    /* storage 不可用（隐私模式/测试环境）时退回浅色 */
  }
  return {
    className: dark ? `${MODAL_PORTAL_ROOT_CLASS} dark` : MODAL_PORTAL_ROOT_CLASS,
    'data-theme': dark ? 'dark' : 'light',
  }
}
