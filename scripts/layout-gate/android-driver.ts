/**
 * 安卓布局门禁 —— 浏览器侧驱动器（在真实排版引擎里量测 8 条断言）。
 *
 * 只依赖 DOM + 真实计算样式；不依赖任何 class 名（worker 正在重排 DOM，class 会漂移），
 * 一律用「文本定位 + 祖先关系 + 计算样式」表达，使同一条断言能同时表达新旧两种 DOM。
 *
 * 返回值由 `verify-android-layout.cjs` 序列化后打印；本文件不 console.log。
 *
 * ───────────────────────── 通则（写断言前必读） ─────────────────────────
 *
 * **任何「可达 / 可点 / 可见」的断言，必须同时断言它在视口内。**
 * 只断言 `click()` 成功，证明的是**元素存在**，不是**用户能找到**。
 *
 * 为什么：`el.click()` 只在 DOM 上派发事件，它不要求元素在屏幕上，也不要求它能被手指碰到
 * （Playwright 的 `click()` 更进一步，默认 `scrollIntoViewIfNeeded`，会主动把元素滚进视野）。
 * 于是「程序化点击」是一条**几乎不可能失败**的检查 —— 它在报「元素存在」，却被读成「用户能用」。
 * 而按我们反复确立的口径：**一个不可能失败的检查不是检查。**
 *
 * 真实事故（A7 全绿、用户在真机上找不到入口）：`profile-nav nav` 在 ≤639px 是
 * `flex-wrap: nowrap; overflow-x: auto`，第 4 项「设置」（安卓唯一设置入口）被挤出可视区，
 * 用户点不到、反馈「页面还是没有做到中英文切换」，而门禁 9 条全 PASS。
 * 更刺眼的是 `Profile.tsx` 的注释**已经预见到**这个风险（只有 4 项且总宽 < 348px 才放得下）
 * —— 「作者预见到了、还是发生了」正说明：**文字警告不是约束，断言才是。**
 *
 * 因此「入口可达」= 四件事**同时**成立，缺一不可：
 *   ① `el.click()` 后行为真的发生（本文件既有断言，保留）；
 *   ② 元素在视口内：尺寸非零 + `left >= 0 && right <= innerWidth`
 *      + `top >= bandTop && bottom <= bandBottom`（band 用与 A1/A5 同一口径的内容带）；
 *   ③ 它所在的横向裁剪容器没有“东西在外面”：`scrollWidth <= clientWidth + 1`
 *      —— `overflow-x: auto` + 子项超宽就是藏起入口的机制本身；
 *   ④ 尾随余量：同一行最右项到容器可见右边界 ≥ `MIN_ENTRY_TRAILING_SLACK`（8px），
 *      且**中英两种语言下都要成立**。只对「单行 flex + 可横向滚动」的容器要求（判据见 `trailingOf`）——
 *      它的作用是拦住下一次「塞不下就用滚动兜底」的做法：③ 只管"现在有没有东西在外面"，
 *      ④ 管"还剩多少空间"，因为一个只剩 2px 余量的行，下一个更长的文案就会重演同一次事故。
 *
 * **量余量时不要用 `clientWidth − scrollWidth`**：那个量**恒为 0**（`scrollWidth` 被 clamp 到
 * 不小于 `clientWidth`），拿它做判据会写出「永远通过」或「永远失败」的假断言。
 * 正确的量是「同一行最右项的 `right` 到容器可见右边界的距离」。
 *
 * 判据实现见 `reachVerdict()`；`isRendered()` 与「在视口内」是两件事，不许再合成一个布尔。
 */
import { useStore } from '@/store'
import { BILLS, nameText, amountText } from './fixture'

export interface GateCheck {
  id: string
  title: string
  pass: boolean
  actual: string
  threshold: string
  detail?: string
}

export interface GateReport {
  viewport: { w: number; h: number }
  env: Record<string, unknown>
  checks: GateCheck[]
  fatal?: string
}

type PageName = 'home' | 'bills' | 'stats' | 'categories' | 'profile'

/**
 * 阈值由 `verify-android-layout.cjs` 通过 vite `define` 注入（单一事实源，
 * 避免「报告里写的阈值」和「代码里用的阈值」漂移）。
 */
declare const __GATE_EXPECT__: {
  billsFirstScreenRows: number
  billNameColWidth: number
  statsScrollHeight: number
  chartAnimationDuration: number
  chartCount: number
  homeCardUnionHeight: number
}

function thresholds() {
  if (typeof __GATE_EXPECT__ !== 'object' || __GATE_EXPECT__ === null) {
    throw new Error('__GATE_EXPECT__ 未注入：门禁阈值缺失（探针页必须由 verify-android-layout.cjs 构建）')
  }
  return __GATE_EXPECT__
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/* ───────────────────────── 通用量测工具 ───────────────────────── */

function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
  const r = el.getBoundingClientRect()
  return r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
}

/**
 * 元素是否**被渲染出来**（有盒子、没被 display/visibility/opacity 藏掉）—— 不判它在不在视口内。
 *
 * 存在的意义是把 `isVisible()` 里合成的两件事拆开（见文件头通则）：
 *  - 负向断言（A8「不存在空壳 Tab」）关心的是**存在**，用宽松的「与视口有交集」去筛，
 *    会让「存在但被挤出屏幕」静默过关；
 *  - 正向断言（A6/A7）关心的是**用户找得到**，`click()` 又不要求可见 ⇒ 两边都漏。
 */
function isRendered(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
  const r = el.getBoundingClientRect()
  return r.width >= 1 && r.height >= 1
}

/** 离元素最近的「可能横向裁剪它」的祖先（`overflow-x ≠ visible`）。 */
function hClipContainerOf(el: Element): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement
  while (p) {
    if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return p
    p = p.parentElement
  }
  return null
}

/** 页面级「可用内容带」（与 A1/A5 同一口径 `contentBand`）—— 用于**滚动内容区里**的元素。 */
function pageBand(): { top: number; bottom: number } {
  const anchor: Element =
    document.querySelector('[data-testid="page-frame"]') ??
    document.querySelector('[data-testid="app-main"]') ??
    document.body
  const b = contentBand(anchor)
  return { top: b.top, bottom: b.bottom }
}

/**
 * 整个屏幕（含底部导航 / 弹窗覆盖区）—— 用于**本身就住在固定覆盖层里**的元素。
 *
 * 为什么需要两套带：把内容带套到「弹窗里的按钮」或「底栏上的 Tab」上是**范畴错误**
 * —— 它们按设计就落在内容带之外，用内容带判会把正常布局报成不可达（假阳性）。
 * 内容带比屏幕更严：它额外要求「没被底部悬浮层压住」，所以页面级入口一律用 `pageBand()`。
 */
function viewportBand(): { top: number; bottom: number } {
  return { top: 0, bottom: window.innerHeight }
}

/** 元素所属的「满屏固定覆盖层」（弹窗 / 遮罩），没有则 null。 */
function fixedOverlayOf(el: Element): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement
  while (p) {
    const cs = getComputedStyle(p)
    if (cs.position === 'fixed') {
      const r = p.getBoundingClientRect()
      if (r.width >= window.innerWidth * 0.8 && r.height >= window.innerHeight * 0.5) return p
    }
    p = p.parentElement
  }
  return null
}

interface HOverflowInfo {
  container: string | null
  scrollWidth: number
  clientWidth: number
  /** 容器可见区右边界（容器被祖先再裁一次时取更严的那个） */
  clipLeft: number
  clipRight: number
  ok: boolean
  /** 被这个容器**裁在可视区外**的可点击项（按可访问名点名） */
  outside: string[]
  /**
   * ④ 尾随余量（`entry` 通则的第 4 条）。
   *
   * **不要用 `clientWidth − scrollWidth` 量余量** —— 那个量恒为 0：`scrollWidth` 被 clamp 到不小于
   * `clientWidth`，所以「没溢出」时它恰好等于 `clientWidth`，差值永远是 0，和"还剩多少空间"无关
   * （我最初就是这么误报出「中文态 0px 余量」的，实测是 26px）。真正的量是：
   * **同一行最右可点击项的 `right` 到容器可见右边界 `clipRight` 的距离**。
   *
   * 只在「单行 flex + 可横向滚动」的容器上有意义 —— 见 `applies` 的判据与 `trailingOf()` 的注释。
   */
  trailing: {
    applies: boolean
    slack: number | null
    rowRight: number | null
    required: number
    ok: boolean
    why: string
  }
}

interface ReachVerdict {
  /** 断言用：自身在视口内 **且** 所在横向容器没有内容在外面 **且** 尾随余量够 */
  ok: boolean
  /** 只算元素自身的矩形是否完全落在可用带内（把「容器溢出」单独拿出来，避免把看得见的项也报成不可见） */
  selfOk: boolean
  why: string[]
  rect: { left: number; right: number; top: number; bottom: number; w: number; h: number }
  band: { top: number; bottom: number }
  hOverflow: HOverflowInfo
}

/**
 * 可达性关键容器的尾随余量下限（px）。
 * 只对**导航项 / 入口项所在的、单行且可横向滚动的**容器生效（判据见 `trailingOf`）——
 * 别的容器不参与，因为「内容刚好填满自己的盒子」在很多正常控件里是**设计意图**
 * （实测反例：设置弹窗里的两段式语言开关 `div.flex.rounded-lg.border` 的两个按钮
 * 恰好铺满它 120px 的宽度，把它算成"没有余量"是假阳性）。
 */
const MIN_ENTRY_TRAILING_SLACK = 8

/**
 * 「塞不下就横向滚动」这个机制的识别 + 尾随余量。
 *
 * 三个条件同时成立才算「关键容器」，每个条件都有实测反例兜着：
 *   · `overflowX ∈ {auto, scroll}`：`hidden|clip` 不算 —— 分段开关是靠 `overflow:hidden` 收圆角的，
 *     它不是"塞不下就滚"，内容也不会变长。
 *   · `display: flex` 且 `flex-wrap: nowrap`：**单行**才可能把东西挤出去。主滚动容器
 *     `main.aurora-main` 是 block（它的 `overflowX` 会因 `overflow-y: auto` 计算成 auto，
 *     从而被 `hClipContainerOf` 命中），但它不换行的前提不成立 ⇒ 不参与。
 *   · 内容由子项宽度驱动。`flex-wrap: wrap` 之后「塞不下」表现为**换行**，东西仍然看得见
 *     ⇒ 也不参与（这时断言保持沉默是对的，别把正常换行报成缺陷）。
 *
 * 量的定义：`slack = clipRight − max(同行已渲染可点击项的 right)`。
 * 取「容器**可见**右边界」（`clipRight`，见 `reachVerdict` 里的 `min(cr.right, innerWidth)`），
 * 而不是减掉容器自己的右 `padding` —— 这是**有意偏宽**的一侧：滚动容器里内容溢进 padding 区
 * 仍是可见的，若额外扣掉 padding 会把正常控件报成"没余量"。偏宽的代价是可能漏判一个真·贴边的行，
 * 偏窄的代价是每天报假红；新判据取前者。本次事故的容器 `padding-bottom: 2px`、横向 padding 为 0，
 * 两种取法在这里等价。
 */
function trailingOf(c: HTMLElement, entryRect: DOMRect, clipRight: number, required: number): HOverflowInfo['trailing'] {
  const cs = getComputedStyle(c)
  const isScroller = /auto|scroll/.test(cs.overflowX)
  const isSingleRowFlex = cs.display.includes('flex') && cs.flexWrap === 'nowrap'
  const base = { applies: false, slack: null, rowRight: null, required, ok: true, why: '' }
  if (!isScroller || !isSingleRowFlex) return base

  const mates = Array.from(c.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR))
    .filter((x) => isRendered(x))
    .filter((x) => Math.abs(x.getBoundingClientRect().top - entryRect.top) <= 1)
  const rowRight = mates.length > 0 ? Math.max(...mates.map((x) => x.getBoundingClientRect().right)) : entryRect.right
  const slack = Number((clipRight - rowRight).toFixed(1))
  const ok = !(required > 0) || slack >= required
  return {
    applies: true,
    slack,
    rowRight: Number(rowRight.toFixed(1)),
    required,
    ok,
    why: ok
      ? ''
      : `所在横向容器「塞得下但没有余量」：${describe(c)} 同一行最右项 right=${rowRight.toFixed(1)} 距容器可见右边界 ${clipRight.toFixed(1)} 只剩 ${slack}px < 要求 ${required}px` +
        `（这类容器用「塞不下就横向滚动」兜底，下一个更长的文案就会被藏到屏幕外）`
  }
}

/**
 * 「入口可达」判据（文件头通则的 ②③④ 三条）。
 *
 * `band` 与 `minTrailingSlack` **必须显式传**：页面级入口传 `pageBand()`，固定覆盖层内的元素传
 * `viewportBand()` —— 两套带不能互相替代（见 `viewportBand()` 的注释）；余量只对可达性关键容器
 * 要求（入口项传 `MIN_ENTRY_TRAILING_SLACK`，只做存在性判断的场景传 0）。不给默认值，
 * 逼调用方当场想清楚。
 *
 * 必须在**点击之前**量：点击会让浏览器把元素（若可获得焦点）滚进视野，量出来的就不是用户看到的。
 *
 * ②（`selfOk`）、③（`hOverflow.ok`）、④（`hOverflow.trailing.ok`）分开返回是有意的：
 * 一个「容器溢出」会让**同一行的每一项**都带上 ③ 的失败，若只报一个合并布尔，
 * 报告会写成「0/4 在视口内」——而其中 3 项其实各自都看得见。结论可以合并（`ok`），**证据不许合并**。
 */
function reachVerdict(
  el: HTMLElement,
  band: { top: number; bottom: number },
  minTrailingSlack: number
): ReachVerdict {
  const r = el.getBoundingClientRect()
  const why: string[] = []
  if (r.width <= 0 || r.height <= 0) why.push(`尺寸非正（${r.width.toFixed(1)}×${r.height.toFixed(1)}）`)
  if (r.left < -0.5) why.push(`左边缘在视口外（left=${r.left.toFixed(1)}）`)
  if (r.right > window.innerWidth + 0.5) why.push(`右边缘超出视口（right=${r.right.toFixed(1)} > innerWidth=${window.innerWidth}）`)
  if (r.top < band.top - 0.5) why.push(`上边缘在可用带之上（top=${r.top.toFixed(1)} < ${band.top.toFixed(1)}）`)
  if (r.bottom > band.bottom + 0.5) why.push(`下边缘在可用带之下（bottom=${r.bottom.toFixed(1)} > ${band.bottom.toFixed(1)}）`)
  const selfOk = why.length === 0

  const c = hClipContainerOf(el)
  let hOverflow: HOverflowInfo = {
    container: null,
    scrollWidth: 0,
    clientWidth: 0,
    clipLeft: 0,
    clipRight: 0,
    ok: true,
    outside: [],
    trailing: { applies: false, slack: null, rowRight: null, required: minTrailingSlack, ok: true, why: '' }
  }
  if (c) {
    const cr = c.getBoundingClientRect()
    const clipLeft = Math.max(cr.left, 0)
    const clipRight = Math.min(cr.right, window.innerWidth)
    // 「有东西在外面」= 容器内容比它的可视区宽。overflow-x: auto 只是让外面那部分**可以**滚进来，
    // 不改变「默认看不见」这个事实 —— 而唯一的设置入口一旦落在那里，用户就是找不到。
    const ok = c.scrollWidth <= c.clientWidth + 1
    const outside = ok
      ? []
      : Array.from(c.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR))
          .filter((x) => isRendered(x))
          .filter((x) => {
            const xr = x.getBoundingClientRect()
            return xr.left < clipLeft - 0.5 || xr.right > clipRight + 0.5
          })
          .map((x) => `${accName(x) || describe(x)}[l${x.getBoundingClientRect().left.toFixed(1)}, r${x.getBoundingClientRect().right.toFixed(1)}]`)
    const trailing = trailingOf(c, r, clipRight, minTrailingSlack)
    hOverflow = {
      container: describe(c),
      scrollWidth: c.scrollWidth,
      clientWidth: c.clientWidth,
      clipLeft: Number(clipLeft.toFixed(1)),
      clipRight: Number(clipRight.toFixed(1)),
      ok,
      outside,
      trailing
    }
    if (!ok) {
      why.push(
        `所在横向容器里有内容在可视区外：${hOverflow.container} scrollWidth=${hOverflow.scrollWidth} > clientWidth=${hOverflow.clientWidth}` +
          `（可视区 [${hOverflow.clipLeft}, ${hOverflow.clipRight}]，在外面的是 ${hOverflow.outside.join('、') || '（未能点名）'}）`
      )
    }
    if (!trailing.ok) why.push(trailing.why)
  }
  return {
    ok: selfOk && hOverflow.ok && hOverflow.trailing.ok,
    selfOk,
    why,
    rect: {
      left: Number(r.left.toFixed(1)),
      right: Number(r.right.toFixed(1)),
      top: Number(r.top.toFixed(1)),
      bottom: Number(r.bottom.toFixed(1)),
      w: Number(r.width.toFixed(1)),
      h: Number(r.height.toFixed(1))
    },
    band: { top: Number(band.top.toFixed(1)), bottom: Number(band.bottom.toFixed(1)) },
    hOverflow
  }
}

/** 把判据压成一行可读证据（含全部数字，供人复核）。 */
function fmtReach(el: HTMLElement, v: ReachVerdict): string {
  const name = accName(el) || describe(el)
  const r = v.rect
  const ov = v.hOverflow.container
    ? `${v.hOverflow.container} scrollW${v.hOverflow.scrollWidth}/clientW${v.hOverflow.clientWidth}`
    : '无横向裁剪容器'
  const self = v.selfOk ? '自身在视口内' : `自身不在视口内（${v.why.filter((w) => !w.startsWith('所在横向容器')).join('；')}）`
  const t = v.hOverflow.trailing
  const slack = !t.applies
    ? '不适用（容器不是「单行 flex + 可横向滚动」，余量对该容器无意义）'
    : `尾随余量 ${t.slack}px（要求 ≥ ${t.required}${t.ok ? '' : ' ⟂ 不足'}）`
  return (
    `「${name}」${self} rect[l${r.left}, r${r.right}, t${r.top}, b${r.bottom}, ${r.w}×${r.h}]` +
    ` 视口宽${window.innerWidth} 可用带[${v.band.top}, ${v.band.bottom}] ${ov} ${slack}` +
    (!v.hOverflow.ok ? ` ⟂ 容器外还有 ${v.hOverflow.outside.join('、') || '内容'}` : '')
  )
}

/**
 * 一行入口的汇总：自身可见几个 / 容器是否溢出 / 尾随余量（结论分开给，见 `reachVerdict` 注释）。
 *
 * 余量只在「单行 flex + 可横向滚动」的容器上出现（`trailing.applies`）—— 别的容器整段不打印，
 * 免得读者把「容器刚好填满」误当成待修问题。
 */
function fmtRow(row: Array<{ el: HTMLElement; v: ReachVerdict }>): string {
  if (row.length === 0) return '未能量到（行内没定位到可点击项）'
  const selfOk = row.filter((x) => x.v.selfOk).length
  const ov = row[0].v.hOverflow
  const hidden = row.filter((x) => !x.v.selfOk).map((x) => accName(x.el) || describe(x.el))
  const t = ov.trailing
  // 不适用时**也要写出来**（与 `fmtReach` 同一句措辞）：留空的话，读的人分不清
  // 「这个容器不参与余量判据」和「这一版还没实现余量判据」—— 沉默与遗忘长得一样。
  const slack = t.applies
    ? `；${t.ok ? '' : '⟂ '}尾随余量 ${t.slack}px（同一行最右项 right=${t.rowRight} 到容器可见右边界，要求 ≥ ${t.required}）`
    : '；尾随余量 不适用（容器不是「单行 flex + 可横向滚动」，余量对该容器无意义）'
  return (
    `自身在视口内 ${selfOk}/${row.length}` +
    (hidden.length ? `（自身越界：${hidden.join('、')}）` : '') +
    `；容器 ${ov.ok ? '不溢出' : `溢出 scrollW${ov.scrollWidth}>clientW${ov.clientWidth}，可视区 [${ov.clipLeft}, ${ov.clipRight}]，在外面的是 ${ov.outside.join('、') || '（未能点名）'}`}` +
    slack
  )
}

function depthOf(el: Element): number {
  let d = 0
  let p: Element | null = el
  while (p) { d++; p = p.parentElement }
  return d
}

/** 找出「textContent 恰好等于 text」的最深元素 —— 用文本定位，与 class 无关 */
function deepByText(text: string, root: ParentNode = document.body): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>('*'))
  let best: HTMLElement | null = null
  let bestDepth = -1
  for (const el of all) {
    if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT' || el.tagName === 'TITLE') continue
    if ((el.textContent ?? '').trim() !== text) continue
    const d = depthOf(el)
    if (d > bestDepth) { bestDepth = d; best = el }
  }
  return best
}

function ancestorChain(el: Element): Element[] {
  const out: Element[] = []
  let c: Element | null = el
  while (c) { out.push(c); c = c.parentElement }
  return out
}

/** 两个元素的最小公共祖先 —— 用它把「分类名单元格」和「金额单元格」还原成「一行」 */
function lca(a: Element, b: Element): HTMLElement {
  const set = new Set(ancestorChain(b))
  for (const el of ancestorChain(a)) if (set.has(el)) return el as HTMLElement
  return document.body
}

function scrollContainerOf(el: Element): HTMLElement {
  let c: HTMLElement | null = el.parentElement
  while (c) {
    const cs = getComputedStyle(c)
    if (/auto|scroll/.test(cs.overflowY) && c.scrollHeight > c.clientHeight + 1) return c
    c = c.parentElement
  }
  return (document.scrollingElement as HTMLElement) ?? document.body
}

/** 底部悬浮层（安卓 Tab 栏 / FAB 等）：用 position:fixed 泛化识别，不写死 class 名 */
function bottomOverlays(): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed') continue
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.top < window.innerHeight * 0.5) continue
    out.push(el)
  }
  return out
}

function describe(el: Element | null): string {
  if (!el) return '(null)'
  const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 3)
  return `${el.tagName.toLowerCase()}${cls.length ? '.' + cls.join('.') : ''}`
}

/** 当前页首屏「可用内容带」：[滚动容器顶 / 顶栏底 , 滚动容器底 / 底部悬浮层顶] */
function contentBand(anchor: Element) {
  const sc = scrollContainerOf(anchor)
  const scRect = sc.getBoundingClientRect()
  let top = Math.max(scRect.top, 0)
  let bottom = Math.min(scRect.bottom, window.innerHeight)
  // 顶栏若是 sticky/fixed，量测时内容区应让开它（当前布局里顶栏是普通流，故只是防御）
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'sticky' && cs.position !== 'fixed') continue
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    // 只有「贴在顶部的一条」才该被当作顶栏让位；满屏 fixed（模态遮罩）不算
    if (r.height > window.innerHeight * 0.5) continue
    if (r.top <= top && r.bottom > top) top = Math.max(top, r.bottom)
  }
  for (const ov of bottomOverlays()) bottom = Math.min(bottom, ov.getBoundingClientRect().top)
  return { sc, top, bottom, height: bottom - top }
}

/** 元素被祖先 overflow 裁掉后的可见宽度（诊断用） */
function visibleWidth(el: HTMLElement): number {
  let left = 0
  let right = window.innerWidth
  let p = el.parentElement
  while (p) {
    const cs = getComputedStyle(p)
    if (/hidden|auto|scroll|clip/.test(cs.overflowX) || /hidden|auto|scroll|clip/.test(cs.overflowY)) {
      const r = p.getBoundingClientRect()
      left = Math.max(left, r.left)
      right = Math.min(right, r.right)
    }
    p = p.parentElement
  }
  const r = el.getBoundingClientRect()
  return Math.max(0, Math.min(r.right, right) - Math.max(r.left, left))
}

async function waitFor(fn: () => boolean, timeout = 6000): Promise<boolean> {
  const t0 = Date.now()
  for (;;) {
    try { if (fn()) return true } catch { /* 渲染中途的读取异常忽略 */ }
    if (Date.now() - t0 > timeout) return false
    await sleep(40)
  }
}

async function nav(page: PageName): Promise<void> {
  useStore.getState().setActivePage(page)
  // 页面靠 effect 拉数据（await 内存夹具），留两帧 + 一个宏任务让首屏稳定
  await sleep(420)
}

/** 可点击元素的可访问名 */
function accName(el: Element): string {
  const aria = el.getAttribute('aria-label')
  const title = el.getAttribute('title')
  return (aria || title || el.textContent || '').replace(/\s+/g, ' ').trim()
}

const CLICKABLE_SELECTOR = 'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"]'

function visibleClickables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)).filter((el) => isVisible(el))
}

/**
 * 所有**被渲染出来**的可点击元素 —— 不要求与视口有交集。
 * 负向断言必须用它：用 `visibleClickables()` 去查「有没有」，会把「有，但被挤出屏幕」判成没有。
 */
function renderedClickables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)).filter((el) => isRendered(el))
}

/* ───────────────────────── 账单页行结构 ───────────────────────── */

interface RowProbe {
  id: number
  nameEl: HTMLElement
  amountEl: HTMLElement
  block: HTMLElement
  row: HTMLElement
}

/**
 * 把「分类名」「金额」两个文本单元格还原成**整行**。
 *
 * 两步，且都不看 class：
 *  ① block = 两者的最小公共祖先（重排前就是整行，重排后只到「文字块」）；
 *  ② row = 从 block 往上走，第一个「父级已含全部行」的祖先 —— 那一层才是「一行」，
 *     因为它的兄弟正是其它行。这样重排前后都能拿到**整行**（含图标、操作区）。
 */
function findBillRows(): RowProbe[] {
  const partial: Array<{ id: number; nameEl: HTMLElement; amountEl: HTMLElement; block: HTMLElement }> = []
  for (const bill of BILLS) {
    const amountEl = deepByText(amountText(bill))
    const nameEl = deepByText(nameText(bill))
    if (!amountEl || !nameEl) continue
    partial.push({ id: bill.id, nameEl, amountEl, block: lca(nameEl, amountEl) })
  }
  const blocks = partial.map((p) => p.block)
  const rows = partial.map((p) => {
    let el: HTMLElement = p.block
    while (el.parentElement) {
      const parent = el.parentElement
      const inside = blocks.filter((b) => parent.contains(b)).length
      if (inside >= blocks.length - 1) break
      el = parent
    }
    return { id: p.id, nameEl: p.nameEl, amountEl: p.amountEl, block: p.block, row: el }
  })
  return rows
}

/* ───────────────────────── recharts 实例 props 读取 ───────────────────────── */

interface ReactFiberLike {
  tag?: number
  memoizedProps?: Record<string, unknown>
  stateNode?: { current?: unknown } | null
  return?: ReactFiberLike | null
  child?: ReactFiberLike | null
  sibling?: ReactFiberLike | null
}

function findRootFiber(): ReactFiberLike | null {
  const seeds: Element[] = []
  const root = document.getElementById('root')
  if (root) seeds.push(root)
  const main = document.querySelector('[data-testid="app-main"]')
  if (main) seeds.push(main)
  for (const s of seeds) {
    for (const k of Object.keys(s)) {
      if (!k.startsWith('__reactContainer$') && !k.startsWith('__reactFiber$')) continue
      let f = (s as unknown as Record<string, ReactFiberLike>)[k]
      while (f && f.return) f = f.return
      if (f && (f.tag === 3 || (f.stateNode && f.stateNode.current))) return f
    }
  }
  return null
}

interface ChartFiberProps {
  animationDuration: unknown
  hasDataArray: boolean
  name: unknown
}

function scanChartFibers(): { candidates: ChartFiberProps[]; visited: number; rootFound: boolean } {
  const rootFiber = findRootFiber()
  if (!rootFiber) return { candidates: [], visited: 0, rootFound: false }
  const candidates: ChartFiberProps[] = []
  let visited = 0
  const stack: ReactFiberLike[] = [rootFiber]
  while (stack.length > 0 && visited < 200000) {
    const f = stack.pop() as ReactFiberLike
    visited++
    const props = f.memoizedProps
    if (props && typeof props === 'object' && Object.prototype.hasOwnProperty.call(props, 'dataKey')) {
      candidates.push({
        animationDuration: (props as Record<string, unknown>).animationDuration,
        hasDataArray: Array.isArray((props as Record<string, unknown>).data),
        name: (props as Record<string, unknown>).name
      })
    }
    if (f.child) stack.push(f.child)
    if (f.sibling) stack.push(f.sibling)
  }
  return { candidates, visited, rootFound: true }
}

/* ───────────────────────── 8 条断言 ───────────────────────── */

/** A1 账单页首屏完整可见条数 ≥ 9 */
async function checkA1(): Promise<GateCheck> {
  await nav('bills')
  await waitFor(() => findBillRows().length >= BILLS.length - 1)
  const rows = findBillRows()
  if (rows.length === 0) {
    return { id: 'A1', title: '账单页首屏可见条数 ≥ 9', pass: false, actual: '未定位到任何账单行', threshold: `≥ ${thresholds().billsFirstScreenRows} 条（首屏完整可见）`, detail: `期望能定位 ${BILLS.length} 行（种子账单）` }
  }
  const band = contentBand(rows[0].row)
  band.sc.scrollTop = 0
  await sleep(80)
  const measured = rows.map((r) => {
    const rect = r.row.getBoundingClientRect()
    return { id: r.id, top: rect.top, bottom: rect.bottom, height: rect.height, full: rect.top >= band.top - 0.5 && rect.bottom <= band.bottom + 0.5 }
  })
  const full = measured.filter((m) => m.full).length
  const heights = measured.map((m) => m.height)
  const minH = Math.min(...heights)
  const maxH = Math.max(...heights)
  const weird = heights.some((h) => h < 32 || h > 220)
  const row0 = rows[0].row
  const childH = Array.from(row0.children).map((c) => `${describe(c)}=${c.getBoundingClientRect().height.toFixed(0)}`)
  return {
    id: 'A1',
    title: '账单页首屏完整可见条数 ≥ 9',
    pass: full >= thresholds().billsFirstScreenRows && !weird,
    actual: `完整可见 ${full} 条（共定位 ${rows.length} 行，行高 ${minH.toFixed(1)}~${maxH.toFixed(1)}px，可用内容带 ${band.height.toFixed(1)}px）`,
    threshold: '≥ 9 条',
    detail:
      `内容带 [${band.top.toFixed(1)}, ${band.bottom.toFixed(1)}]；首行 top=${measured[0].top.toFixed(1)} bottom=${measured[0].bottom.toFixed(1)}；` +
      `行结构 ${describe(row0)} 子元素[${childH.join(', ')}]` +
      (weird ? '；行高超出 32~220px，行结构可能没被正确还原（LCA 失败）' : '')
  }
}

/** A2 账单行分类名文字列宽 ≥ 200px 且未被裁切 */
async function checkA2(): Promise<GateCheck> {
  await nav('bills')
  await waitFor(() => findBillRows().length >= BILLS.length - 1)
  const rows = findBillRows()
  if (rows.length < 3) {
    return { id: 'A2', title: '账单行分类名列宽 ≥ 200px 且未裁切', pass: false, actual: `仅定位到 ${rows.length} 行`, threshold: `列宽 ≥ ${thresholds().billNameColWidth}px`, detail: '行定位不足 3 行，无法量测' }
  }
  const probes = rows.slice(0, 3).map((r) => {
    const parent = r.nameEl.parentElement
    const colWidth = parent ? parent.getBoundingClientRect().width : 0
    const nameRect = r.nameEl.getBoundingClientRect()
    const visible = visibleWidth(r.nameEl)
    return {
      id: r.id,
      colWidth,
      nameWidth: nameRect.width,
      scrollWidth: r.nameEl.scrollWidth,
      clientWidth: r.nameEl.clientWidth,
      clipped: r.nameEl.scrollWidth > r.nameEl.clientWidth + 1,
      overflow: nameRect.width > colWidth + 1,
      visible,
      // 被祖先 overflow 裁掉（卡片是 overflow-hidden）：可见宽度必须等于文字框宽度
      ancestorClipped: visible < nameRect.width - 1
    }
  })
  const minCol = Math.min(...probes.map((p) => p.colWidth))
  const bad = probes.filter((p) => p.clipped || p.overflow || p.ancestorClipped)
  const pass = minCol >= thresholds().billNameColWidth && bad.length === 0
  return {
    id: 'A2',
    title: '账单行分类名列宽 ≥ 200px 且未裁切',
    pass,
    actual: `最小列宽 ${minCol.toFixed(1)}px；裁切行 ${bad.length}/${probes.length}`,
    threshold: `列宽 ≥ ${thresholds().billNameColWidth}px 且 0 行裁切`,
    detail: probes.map((p) => `#${p.id} 列宽${p.colWidth.toFixed(1)} 文字框${p.nameWidth.toFixed(1)} scrollW${p.scrollWidth}/clientW${p.clientWidth} 可见${p.visible.toFixed(1)}`).join(' | ')
  }
}

/** A3 统计页窄屏 scrollHeight ≤ 1400px */
async function checkA3(): Promise<GateCheck> {
  await nav('stats')
  const painted = await waitFor(() => {
    const frame = document.querySelector('[data-testid="page-frame"]')
    return Boolean(frame && (frame.querySelector('.recharts-wrapper') || deepByText('该时间段暂无数据')))
  })
  const anchor =
    document.querySelector('[data-testid="page-frame"]') ??
    document.querySelector('[data-testid="app-main"]') ??
    document.body
  const sc = scrollContainerOf(anchor)
  sc.scrollTop = 0
  await sleep(120)
  const h = sc.scrollHeight
  return {
    id: 'A3',
    title: '统计页窄屏 scrollHeight ≤ 1400px',
    pass: painted && h <= thresholds().statsScrollHeight,
    actual: `scrollHeight = ${h}px（clientHeight ${sc.clientHeight}px，图表已渲染=${painted}）`,
    threshold: `≤ ${thresholds().statsScrollHeight}px`,
    detail: `滚动容器 = ${describe(sc)}`
  }
}

/** A4 统计页每个已渲染图表的 animationDuration 均为 300（运行时读 recharts 实例 props） */
async function checkA4Runtime(): Promise<{ check: GateCheck; diag: unknown }> {
  await nav('stats')
  await waitFor(() => document.querySelectorAll('.recharts-wrapper').length >= 1)
  await sleep(300)
  const scan = scanChartFibers()
  const wrappers = document.querySelectorAll('.recharts-wrapper').length
  const want = thresholds().chartAnimationDuration
  const withWant = scan.candidates.filter((c) => c.animationDuration === want).length
  // 「非 undefined 且非 300」= 显式跑了别的时长（重排前是 recharts 默认 1500ms）
  const bad = scan.candidates.filter((c) => c.animationDuration !== undefined && c.animationDuration !== want)
  const values = scan.candidates.map((c) => String(c.animationDuration))
  const pass = scan.rootFound && wrappers >= thresholds().chartCount && withWant >= wrappers && bad.length === 0
  return {
    check: {
      id: 'A4',
      title: `统计页每个已渲染图表的 animationDuration = ${want}`,
      pass,
      actual: `已渲染图表 ${wrappers} 个（下限 ${thresholds().chartCount}）；实例 props 中 animationDuration=${want} 的 ${withWant}/${scan.candidates.length}；非 ${want} 的取值 ${JSON.stringify(bad.map((b) => b.animationDuration))}`,
      threshold: `每个已渲染图表 animationDuration === ${want}，且不存在其它取值（禁止 recharts 默认 1500ms）`,
      detail: `fiber 扫描：rootFound=${scan.rootFound} visited=${scan.visited} 值集=${JSON.stringify(values.slice(0, 12))}`
    },
    diag: { wrappers, values, visited: scan.visited, rootFound: scan.rootFound, withWant }
  }
}

/** A5 首页 6 张统计卡占高 ≤ 340px */
async function checkA5(): Promise<GateCheck> {
  await nav('home')
  const LABELS = ['今日支出', '本月支出', '日均支出', '累计记录', '本月收入', '本月结余']
  await waitFor(() => LABELS.every((l) => deepByText(l) !== null))

  /** 从标签往上走到「只含这一个标签」的最大祖先 —— 即卡片本身 */
  const cardOf = (label: string): HTMLElement | null => {
    const labelEl = deepByText(label)
    if (!labelEl) return null
    let card: HTMLElement | null = labelEl
    let el: HTMLElement | null = labelEl
    while (el && el !== document.body) {
      // 显式标注：`el` 在循环里被重新赋值，不标注会形成自引用推断 ⇒ TS7022（整条链退化成 any）。
      // 这条与 desktop-driver.ts 的 pathOf 是同一形状，加 scripts 类型门禁后一起现形。
      const parent: HTMLElement | null = el.parentElement
      if (!parent) break
      const inside = LABELS.filter((l) => parent.textContent?.includes(l)).length
      if (inside > 1) break
      card = parent
      el = parent
    }
    return card
  }

  const cards = LABELS.map(cardOf).filter((c): c is HTMLElement => c !== null)
  if (cards.length !== 6) {
    return { id: 'A5', title: `首页 6 张统计卡占高 ≤ ${thresholds().homeCardUnionHeight}px`, pass: false, actual: `仅识别到 ${cards.length} 张统计卡`, threshold: '6 张卡合计占高 ≤ 340px', detail: `期望 6 张；标签命中情况=${JSON.stringify(LABELS.map((l) => Boolean(deepByText(l))))}` }
  }
  const rects = cards.map((c) => c.getBoundingClientRect())
  const top = Math.min(...rects.map((r) => r.top))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const union = bottom - top
  const cardH = rects.map((r) => r.height).sort((a, b) => a - b)
  return {
    id: 'A5',
    title: '首页 6 张统计卡占高 ≤ 340px',
    pass: union <= thresholds().homeCardUnionHeight,
    actual: `6 卡合计占高 ${union.toFixed(1)}px（单卡高 ${cardH[0].toFixed(1)}~${cardH[cardH.length - 1].toFixed(1)}px）`,
    threshold: `6 张卡合计占高 ≤ ${thresholds().homeCardUnionHeight}px`,
    detail: `卡片并集 top=${top.toFixed(1)} bottom=${bottom.toFixed(1)}；单卡宽=${rects.map((r) => r.width.toFixed(0)).join('/')}`
  }
}

/** A6 分类管理页存在**在视口内**的返回入口，点击后 activePage === 'profile' */
async function checkA6(): Promise<GateCheck> {
  await nav('categories')
  await waitFor(() => Boolean(deepByText('分类管理')) || visibleClickables().length > 0)
  await sleep(200)
  const cands = visibleClickables().filter((el) => /返回|back/i.test(accName(el)))
  if (cands.length === 0) {
    const inventory = visibleClickables().map((el) => accName(el)).filter(Boolean).slice(0, 12)
    return {
      id: 'A6',
      title: '分类管理页有在视口内的返回入口且点击后回到「我的」',
      pass: false,
      actual: '未找到任何可见的返回入口（可点击元素的可访问名无一匹配 /返回|back/i）',
      threshold: '存在**在视口内**的返回入口，点击后 activePage === "profile"',
      detail: `当前可点击元素清单=${JSON.stringify(inventory)}`
    }
  }
  const target = cands[0]
  // 判据必须在点击**之前**量（点击可能把元素滚进视野，之后量到的就不是用户看到的）
  // 这是**入口**，故要求尾随余量（若它恰好在「单行 flex + 可横向滚动」的容器里）
  const reach = reachVerdict(target, pageBand(), MIN_ENTRY_TRAILING_SLACK)
  target.click()
  const acted = await waitFor(() => useStore.getState().activePage === 'profile', 3000)
  const pass = reach.ok && acted
  return {
    id: 'A6',
    title: '分类管理页有在视口内的返回入口且点击后回到「我的」',
    pass,
    actual: `找到 ${cands.length} 个候选返回入口（如「${accName(target)}」）；点击后 activePage = "${useStore.getState().activePage}"；${fmtReach(target, reach)}`,
    threshold: `在视口内（水平完全可见 + 竖直落在内容带内 + 所在横向容器不溢出 + 单行可横向滚动容器的尾随余量 ≥ ${MIN_ENTRY_TRAILING_SLACK}px）且 点击后 activePage === "profile"`,
    detail: [
      `点击行为=${acted ? 'ok' : '未回到「我的」页'}`,
      `视口判据=${reach.ok ? 'ok' : reach.why.join('；')}`,
      `尾随余量=${!reach.hOverflow.trailing.applies ? '不适用（容器不是「单行 flex + 可横向滚动」）' : `${reach.hOverflow.trailing.slack}px（要求 ≥ ${reach.hOverflow.trailing.required}）`}`
    ].join(' | ')
  }
}

interface SwitcherInfo { found: boolean; rect?: DOMRect; buttons: string[]; els: HTMLElement[] }

/** 语言切换器：一个可见容器内同时含「中文」与「English」两个按钮 */
function findLanguageSwitcher(): SwitcherInfo {
  const els = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(isVisible)
  for (const el of els) {
    if ((el.textContent ?? '').includes('中文') && (el.textContent ?? '').includes('English')) {
      const btns = Array.from(el.querySelectorAll<HTMLElement>('button')).filter(isVisible)
      if (btns.length >= 2) {
        return { found: true, rect: el.getBoundingClientRect(), buttons: btns.map((b) => accName(b)), els: btns }
      }
    }
  }
  return { found: false, buttons: [], els: [] }
}

/** A7 「我的」页设置入口**在两种语言下都在视口内**，点击后出现**在视口内**的语言切换器（且切换器真的可用） */
async function checkA7(): Promise<GateCheck> {
  const attempts: string[] = []
  /** 按可访问名找「设置」入口；`excludeOverlay` 用来排除弹窗内部的按钮（弹窗此时可能开着）。 */
  const findSettingsEntries = (excludeOverlay: HTMLElement | null): HTMLElement[] =>
    renderedClickables().filter(
      (el) => /设置|settings/i.test(accName(el)) && !(excludeOverlay && excludeOverlay.contains(el))
    )
  /** 入口所在的**那一行**（同一个横向裁剪容器里的全部可点击项）—— 一个入口被挤出屏幕，同行的都是嫌疑人。 */
  const chipRowOf = (seed: HTMLElement): HTMLElement[] => {
    const c = hClipContainerOf(seed)
    if (!c) return [seed]
    return Array.from(c.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)).filter((x) => isRendered(x))
  }
  // 这一行是**入口行**，因此除「都在视口内」外还要看尾随余量：容器里已经没有空间时，
  // 下一个更长的文案（例如再翻一种语言）就会把最后一项挤出去。
  const rowVerdicts = (row: HTMLElement[]) =>
    row.map((el) => ({ el, v: reachVerdict(el, pageBand(), MIN_ENTRY_TRAILING_SLACK) }))
  {
    await nav('profile')
    await waitFor(() => visibleClickables().length > 0)
    await sleep(150)
    const cands = findSettingsEntries(null)
    if (cands.length === 0) {
      // 「不存在」与「存在但用户看不到」必须分开报：前者是入口没做，后者是入口被藏在屏幕外，
      // 修法完全不同。旧版只报「没有任何可见的可点击元素」，会把后者也说成前者。
      const offscreen = renderedClickables().filter((el) => /设置|settings/i.test(accName(el)))
      const inventory = visibleClickables().map((el) => accName(el)).filter(Boolean).slice(0, 14)
      return {
        id: 'A7',
        title: '「我的」页有在视口内的设置入口，点击后出现语言切换器',
        pass: false,
        actual: offscreen.length
          ? `设置入口存在（${offscreen.length} 个）但一个都不在视口内：${offscreen.map((el) => fmtReach(el, reachVerdict(el, pageBand(), MIN_ENTRY_TRAILING_SLACK))).join(' | ')}`
          : '「我的」页没有任何匹配 /设置|settings/i 的可点击元素（入口根本没渲染）',
        threshold: '存在**在视口内**的设置入口 → 点击后出现**在视口内**的语言切换器',
        detail: `当前可见可点击元素清单=${JSON.stringify(inventory)}`
      }
    }
    // 所有候选的视口判据都在点击**之前**一次量完：点击可能把元素滚进视野，逐个边点边量会拿到假绿
    const reaches = cands.map((el) => reachVerdict(el, pageBand(), MIN_ENTRY_TRAILING_SLACK))
    for (let i = 0; i < cands.length; i++) {
      const el = cands[i]
      const reach = reaches[i]
      const name = accName(el)
      const cnRow = rowVerdicts(chipRowOf(el))
      const cnOk = cnRow.every((x) => x.v.ok)
      el.click()
      const appeared = await waitFor(() => findLanguageSwitcher().found, 1500)
      if (!appeared) { attempts.push(`「${name}」→ 未出现语言切换器`); continue }
      const sw = findLanguageSwitcher()
      const overlay = sw.els.length > 0 ? fixedOverlayOf(sw.els[0]) : null
      // 切换器自身也必须是「用户点得到的」：弹窗是 fixed 遮罩、按设计就盖住内容带，
      // 所以这里用**视口**判据而不是内容带判据（把内容带套到弹窗上会把正常弹窗误判为不可达）。
      // 余量传 0：这是**分段开关**，两个按钮精确铺满自己那一条是**设计意图**，不是隐患。
      const swReaches = sw.els.map((b) => reachVerdict(b, viewportBand(), 0))
      const swOk = swReaches.every((v) => v.ok)
      // 行为级：切换器的按钮必须真的能切换
      const btns = Array.from(document.querySelectorAll<HTMLElement>('button')).filter(
        (b) => isVisible(b) && (accName(b) === 'English' || accName(b) === '中文')
      )
      const target = btns.find((b) => accName(b) === 'English') ?? btns.find((b) => b.getAttribute('aria-pressed') !== 'true')
      let toggled = false
      /** 英文态下的入口行判据（在切换成英文之后、还原中文之前量）。 */
      let enRow: Array<{ el: HTMLElement; v: ReachVerdict }> = []
      if (target) {
        const label = accName(target)
        target.click()
        toggled = await waitFor(() => {
          const again = Array.from(document.querySelectorAll<HTMLElement>('button')).filter(
            (b) => isVisible(b) && accName(b) === label
          )
          return again.some((b) => b.getAttribute('aria-pressed') === 'true')
        }, 1500)
        /**
         * 【英文态】同一行入口必须**也**都在视口内。这一步不是锦上添花，是本缺陷的唯一显影剂：
         * 中文态 4 个 chip 的容器 `scrollW342 == clientW342`（不溢出）且尾随余量 26px，
         * 看起来完全正常；**英文标签更长**，`flex-wrap: nowrap; overflow-x: auto` 才把第 4 项
         * 「Settings」挤出可视区（`scrollW414 > clientW342`，Settings 落在 l368.3..r445.7 而视口宽 412）。
         * 而英文态不是边缘场景 —— 它正是用户用过一次切换器之后的**唯一**状态，
         * 此时设置入口不可达 ⇒ 用户再也切不回中文（单向陷阱）。只量中文，这条断言对真实事故是空过的。
         *
         * 更正一处我自己的误报：我最初写的是「中文态恰好铺满 342px、**0px 余量**」——
         * 那个 0 来自 `clientWidth − scrollWidth`，而该量**恒为 0**（`scrollWidth` 被 clamp 到不小于
         * `clientWidth`）。实测余量是 26px，恰恰是「看起来还有空间」的那一侧，所以中文态才不显影。
         */
        if (toggled) {
          await sleep(150)
          const seed = el.isConnected ? el : findSettingsEntries(overlay)[0]
          enRow = seed ? rowVerdicts(chipRowOf(seed)) : []
        }
        // 还原成中文，避免污染后续断言
        const zh = Array.from(document.querySelectorAll<HTMLElement>('button')).filter((b) => isVisible(b) && accName(b) === '中文')
        if (toggled && zh.length > 0) { zh[0].click(); await sleep(150) }
      }
      // 收尾：关掉设置弹窗（它是 fixed 满屏遮罩，留着会污染后续量测的内容带）
      // 按钮名随语言变（关闭/Close），所以按两种语言 + 弹窗范围去找，不能只认「关闭」。
      const closeBtn = overlay
        ? Array.from(overlay.querySelectorAll<HTMLElement>('button')).filter(isVisible).find((b) => /关闭|close|完成|done/i.test(accName(b)))
        : visibleClickables().find((b) => /关闭|close/i.test(accName(b)))
      if (closeBtn) { closeBtn.click(); await sleep(150) }
      const enOk = enRow.length > 0 && enRow.every((x) => x.v.ok)
      const enHidden = new Set(enRow.flatMap((x) => x.v.hOverflow.outside))
      attempts.push(
        `「${name}」→ ${fmtReach(el, reach)}；出现语言切换器（${JSON.stringify(sw.buttons)}），切换器视口判据=${swOk ? 'ok' : '不通过'}，切换可交互=${toggled}`
      )
      const pass = reach.ok && cnOk && swOk && toggled && enOk
      return {
        id: 'A7',
        title: '「我的」页设置入口在两种语言下都在视口内，点击后出现语言切换器',
        pass,
        actual:
          `设置入口「${name}」${reach.selfOk ? '自身在视口内' : '自身不在视口内'}，点击后出现语言切换器，按钮=${JSON.stringify(sw.buttons)}；` +
          `中文态入口行 ${fmtRow(cnRow)}；` +
          `英文态入口行 ${fmtRow(enRow)}` +
          (enOk || enHidden.size === 0 ? '' : `；英文态被容器裁在可视区外的入口：${[...enHidden].join('、')}`),
        threshold:
          '入口在视口内（自身完全可见 + 所在横向容器不溢出 scrollWidth ≤ clientWidth + 尾随余量 ≥ ' +
          `${MIN_ENTRY_TRAILING_SLACK}px，仅对「单行 flex + 可横向滚动」的容器要求）；**中文与英文两种语言下都成立**；` +
          '且 出现语言切换器且切换按钮在视口内且 aria-pressed 随点击翻转',
        detail: [
          attempts.join(' | '),
          `分段结论：入口自身视口=${reach.selfOk ? 'ok' : reach.why.join('；')}`,
          `入口所在容器=${reach.hOverflow.ok ? '不溢出' : `溢出 scrollW${reach.hOverflow.scrollWidth}>clientW${reach.hOverflow.clientWidth}，在外面的是 ${reach.hOverflow.outside.join('、')}`}`,
          `入口所在容器尾随余量=${!reach.hOverflow.trailing.applies ? '不适用（容器不是「单行 flex + 可横向滚动」）' : `${reach.hOverflow.trailing.slack}px（要求 ≥ ${reach.hOverflow.trailing.required}）`}`,
          `中文态入口行逐项=${cnRow.map((x) => fmtReach(x.el, x.v)).join(' / ')}`,
          `英文态入口行逐项=${enRow.length ? enRow.map((x) => fmtReach(x.el, x.v)).join(' / ') : '未能量到（语言切换后入口行未定位到）'}`,
          `切换器视口=${swOk ? 'ok' : swReaches.filter((v) => !v.ok).map((v) => v.why.join('；')).join('；')}`,
          `行为=${toggled ? 'ok' : '切换器存在但点击未改变 aria-pressed'}`
        ].join('；')
      }
    }
  }
  return {
    id: 'A7',
    title: '「我的」页设置入口在两种语言下都在视口内，点击后出现语言切换器',
    pass: false,
    actual: attempts.join(' | ') || '未找到可用的设置入口',
    threshold: '入口在两种语言下都在视口内且 出现语言切换器且切换按钮在视口内'
  }
}
/** A8 安卓端「我的」页不存在「空壳 Tab」 */
async function checkA8(): Promise<GateCheck> {
  await nav('profile')
  await waitFor(() => visibleClickables().length > 0)
  await sleep(150)
  const SHELL_LABELS = ['安全设置', '绑定管理', '危险操作']
  const hits: string[] = []
  // 用 `renderedClickables()`（存在性）而不是 `visibleClickables()`（与视口有交集）：
  // 「存在但被挤出屏幕」照样是一个导航项，用后者去查「有没有」会把它判成没有。
  const all = renderedClickables()
  // 这里用 `viewportBand()` 而不是 `pageBand()`：本页的底栏 Tab（首页/账单/统计/我的）
  // 按设计就落在内容带之外（被底部悬浮层占住），用内容带判会把它们全报成「不可达」——
  // 那是假阳性，会淹掉真正要找的东西（被 `overflow-x` 裁掉的入口）。
  const band = viewportBand()
  for (const label of SHELL_LABELS) {
    for (const el of all) {
      if (accName(el) !== label) continue
      // 余量传 0：这里问的是「它在不在视口内」，不是「入口还够不够空间」。
      // 传 `MIN_ENTRY_TRAILING_SLACK` 会把「看得见但余量不足」写成「不在视口内」——结论对、措辞错。
      const v = reachVerdict(el, band, 0)
      hits.push(
        `${label}<${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}` : ''}>${v.ok ? '（在视口内）' : `（不在视口内：${v.why.join('；')}）`}`
      )
    }
  }
  const inventory = all.map((el) => accName(el)).filter(Boolean)
  // 顺带把「被横向容器藏在可视区外」的可点击项点名 —— 这正是本页出过事故的机制。
  // 只列这一类：底栏 Tab 落在内容带外是按设计如此（固定覆盖层），把它列进来是假阳性，
  // 会淹掉真正要找的东西。
  const hiddenByOverflow = new Map<string, string[]>()
  for (const el of all) {
    // 只看「有没有东西被裁在外面」，不看余量 ⇒ 传 0（余量在这里答非所问）
    const v = reachVerdict(el, band, 0)
    if (v.hOverflow.ok || !v.hOverflow.container) continue
    const arr = hiddenByOverflow.get(v.hOverflow.container) ?? []
    arr.push(...v.hOverflow.outside)
    hiddenByOverflow.set(v.hOverflow.container, arr)
  }
  const hiddenText =
    hiddenByOverflow.size === 0
      ? '没有被横向容器藏在可视区外的可点击项'
      : [...hiddenByOverflow].map(([c, names]) => `${c} 外面：${[...new Set(names)].join('、')}`).join('；')
  return {
    id: 'A8',
    title: '「我的」页不存在空壳 Tab（安全设置/绑定管理/危险操作 不再作为导航项）',
    pass: hits.length === 0,
    actual: hits.length === 0 ? '三个空壳 Tab 均已不在「我的」页作为可点击导航项出现' : `仍存在 ${hits.length} 个空壳 Tab 导航项：${hits.join('、')}`,
    threshold: '匹配 {安全设置, 绑定管理, 危险操作} 的**已渲染**可点击导航项数 = 0',
    detail:
      `当前「我的」页已渲染可点击元素清单=${JSON.stringify(Array.from(new Set(inventory)).slice(0, 18))}` +
      `；${hiddenText}`
  }
}

/* ───────────────────────── 机制自检：确认 el.click() 真的能驱动 React ───────────────────────── */

/**
 * A6/A7 的判定依赖「用 DOM click 驱动 React 事件」。若合成点击在本 harness 里根本不生效，
 * 两条断言会**假失败**（看起来是功能缺失，其实是量测手段失效）。所以先做一次往返自检：
 * 点底部导航的「我的」→ activePage 变 profile；再点「首页」→ 变回 home。
 */
async function clickMechanismSelfCheck(): Promise<{ ok: boolean; detail: string }> {
  const clickByName = async (name: string, expect: PageName): Promise<boolean> => {
    const cand = visibleClickables().filter((el) => accName(el) === name).pop()
    if (!cand) return false
    cand.click()
    return await waitFor(() => useStore.getState().activePage === expect, 2500)
  }
  await nav('home')
  const targets: Array<[string, PageName, PageName]> = [
    ['我的', 'profile', 'home'],
    ['账单', 'bills', 'home'],
    ['统计', 'stats', 'home']
  ]
  for (const [name, to, back] of targets) {
    if (await clickByName(name, to)) {
      await clickByName('首页', back)
      return { ok: true, detail: `点击「${name}」→ activePage=${to} ✓（合成点击可驱动 React 事件）` }
    }
  }
  return {
    ok: false,
    detail: `底部导航四个 Tab 名（我的/账单/统计）都点不动：合成点击未驱动 React；当前可点击元素=${JSON.stringify(visibleClickables().map((el) => accName(el)).slice(0, 14))}`
  }
}

/* ───────────────────────── 环境证据（供 cjs 侧做「量到的是不是安卓布局」自检） ───────────────────────── */

async function envEvidence(): Promise<Record<string, unknown>> {
  await nav('bills')
  await waitFor(() => findBillRows().length >= 1)
  const rows = findBillRows()
  const frame = document.querySelector<HTMLElement>('[data-testid="page-frame"]')
  const main = document.querySelector<HTMLElement>('[data-testid="app-main"]')
  const anchor: Element = rows[0]?.row ?? frame ?? document.body
  const band = contentBand(anchor)
  return {
    bodyOverscrollY: getComputedStyle(document.body).overscrollBehaviorY,
    mainPaddingBottom: main ? parseFloat(getComputedStyle(main).paddingBottom) : null,
    contentWidth: frame ? Number(frame.getBoundingClientRect().width.toFixed(1)) : null,
    bandHeight: Number(band.height.toFixed(1)),
    scrollContainer: describe(band.sc),
    overlayTops: bottomOverlays().map((o) => Number(o.getBoundingClientRect().top.toFixed(1))),
    docClientWidth: document.documentElement.clientWidth,
    mainClientWidth: main ? main.clientWidth : null,
    mainBorderBoxWidth: main ? Number(main.getBoundingClientRect().width.toFixed(1)) : null,
    shellWidth: document.querySelector('.aurora-shell')
      ? Number((document.querySelector('.aurora-shell') as HTMLElement).getBoundingClientRect().width.toFixed(1))
      : null,
    topbarWidth: document.querySelector<HTMLElement>('.aurora-topbar')
      ? Number((document.querySelector('.aurora-topbar') as HTMLElement).getBoundingClientRect().width.toFixed(1))
      : null,
    mainScrollbarGutter: main ? getComputedStyle(main).scrollbarGutter : null
  }
}

/* ───────────────────────── 入口 ───────────────────────── */

export async function runGate(): Promise<GateReport> {
  const checks: GateCheck[] = []
  thresholds() // 阈值缺失时立刻抛错，避免用 NaN 量出「全 PASS」
  // 等首帧渲染完再读环境：runGate 是在 root.render 之后同步调用的，
  // 立刻读会拿到「还没挂载」的 DOM（例如量不到底部导航栏）。
  await waitFor(() => document.querySelector('[data-testid="app-main"]') !== null, 5000)
  await sleep(200)
  const env: Record<string, unknown> = {
    htmlClass: document.documentElement.className,
    platformAndroid: document.documentElement.classList.contains('platform-android'),
    bodyHeight: Number(document.body.getBoundingClientRect().height.toFixed(1)),
    tabbarVisible: bottomOverlays().length
  }
  // 环境证据要在**任何断言之前**取：A7 会把设置弹窗打开，之后量到的内容带会被模态遮罩污染
  try {
    Object.assign(env, await envEvidence())
  } catch (e) {
    env.envEvidenceError = e instanceof Error ? e.message : String(e)
  }
  // A6/A7 的判定依赖「合成点击驱动 React」，先证明这条链路成立
  try {
    env.clickMechanism = await clickMechanismSelfCheck()
  } catch (e) {
    env.clickMechanism = { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
  const steps: Array<[string, () => Promise<GateCheck>]> = [
    ['A1', checkA1],
    ['A2', checkA2],
    ['A3', checkA3],
    ['A5', checkA5],
    ['A6', checkA6],
    ['A8', checkA8],
    ['A7', checkA7]
  ]
  let a4: GateCheck | null = null
  for (const [id, fn] of steps) {
    try {
      checks.push(await fn())
    } catch (e) {
      checks.push({ id, title: id, pass: false, actual: `量测抛错：${e instanceof Error ? e.message : String(e)}`, threshold: '-' })
    }
  }
  try {
    const r = await checkA4Runtime()
    a4 = r.check
    env.chartAnimation = r.diag
  } catch (e) {
    a4 = { id: 'A4', title: '统计页 3 个图表 animationDuration = 300', pass: false, actual: `量测抛错：${e instanceof Error ? e.message : String(e)}`, threshold: '-' }
  }
  checks.push(a4)
  useStore.getState().setActivePage('home')
  return { viewport: { w: window.innerWidth, h: window.innerHeight }, env, checks }
}
