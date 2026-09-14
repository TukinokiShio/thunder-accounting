/**
 * 「我的」页（安卓本机账本单面板）几何门禁 —— 浏览器侧驱动器。
 *
 * 为什么单独一道：真机反馈的三条里，**两条是纯几何量**（入口被裁在屏幕外 / 页面约 70% 空白），
 * 而 jsdom 没有排版引擎 —— `scrollWidth`、`clientWidth`、`getBoundingClientRect()` 恒为 0，
 * 在 vitest 里写这类断言是**不可能失败的空断言**（本仓库的 `scripts/verify-android-layout.cjs`
 * 文件头已就同一问题立过规矩）。所以几何断言必须跑在真实构建 CSS + 真实排版引擎里。
 *
 * 与 `scripts/layout-gate/android-driver.ts` 的分工（避免重复劳动）：
 *   · 那边的 A6/A7/A8 量的是**整条 App**在四个页面上的可达性（含分类管理返回入口、空壳 Tab 等）；
 *   · 这边只量「我的」页本身的三条真机反馈，且判据更窄、更硬：切换器落在可视内容带内、
 *     整页无横向溢出、内容高度 ≥ 可用内容带 60%。
 * 两侧共享同一套判据口径（元素在视口内 + 最近的可横向裁剪祖先不溢出），不共享代码：
 * 驱动必须能在 `scripts/` 落盘为独立探针，跨目录 import 会被 scratch 拷贝打断。
 *
 * 通则：**任何「看得到 / 点得到」的断言，必须同时断言它在视口内**；
 * 只断言 `click()` 成功，证明的是「元素存在」，不是「用户能找到」。
 */
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
  /** 仅在 `selfCheck` 阈值开启时存在：P6 判据的最小对照（旧漏 / 新抓）。 */
  selfCheck?: GateCheck
  fatal?: string
}

/**
 * 阈值由 `verify-profile-mobile.cjs` 通过 vite `define` 注入（单一事实源，
 * 避免「报告里写的阈值」与「代码里用的阈值」漂移）。
 *
 * `selfCheck`：为 true 时额外跑一次「P6 判据」的最小对照（注入横向容器，
 * 看 class 名判据漏过几个、计算样式判据抓到几个）。默认关闭，不进常规 7 条。
 */
declare const __PROFILE_GATE_EXPECT__: { contentRatio: number; selfCheck?: boolean }

function thresholds(): { contentRatio: number; selfCheck?: boolean } {
  if (typeof __PROFILE_GATE_EXPECT__ !== 'object' || __PROFILE_GATE_EXPECT__ === null) {
    throw new Error('__PROFILE_GATE_EXPECT__ 未注入：门禁阈值缺失（探针页必须由 verify-profile-mobile.cjs 构建）')
  }
  return __PROFILE_GATE_EXPECT__
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function waitFor(fn: () => boolean, timeout = 6000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (fn()) return true
    await sleep(50)
  }
  return fn()
}

/* ───────────────────────── 量测工具 ───────────────────────── */

const px = (v: string): number => {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** 可访问名：`aria-label` 优先，否则取文本（压缩空白）。 */
function accName(el: HTMLElement): string {
  const label = el.getAttribute('aria-label')
  if (label) return label.trim()
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** 是否真的被渲染出来（有盒子、没被 display/visibility/opacity 藏掉）—— 不判在不在视口内。 */
function isRendered(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
  const r = el.getBoundingClientRect()
  return r.width >= 1 && r.height >= 1
}

const describe = (el: HTMLElement): string =>
  `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`

interface Band {
  top: number
  bottom: number
  height: number
  label: string
}

/**
 * 「可用内容带」= 滚动内容区（`[data-testid="app-main"]`）的**内容盒**。
 * 顶栏与底部导航都在它之外，所以它等于「首屏里真正能给页面用掉的高度」。
 */
function contentBand(): Band {
  const main = document.querySelector<HTMLElement>('[data-testid="app-main"]')
  if (!main) return { top: 0, bottom: window.innerHeight, height: window.innerHeight, label: '回退：整视口（未找到 app-main）' }
  const cs = getComputedStyle(main)
  const r = main.getBoundingClientRect()
  const top = r.top + px(cs.borderTopWidth) + px(cs.paddingTop)
  const bottom = r.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom)
  return { top, bottom, height: Math.max(0, bottom - top), label: 'app-main 内容盒' }
}

/** 离元素最近的「可能横向裁剪它」的祖先（`overflow-x ≠ visible`）。 */
function clipAncestorOf(el: Element): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement
  while (p) {
    if (getComputedStyle(p).overflowX !== 'visible') return p
    p = p.parentElement
  }
  return null
}

/** 元素是否「用户不用滚动就看得见、且没被任何横向容器藏起来」。 */
function reachVerdict(el: HTMLElement, band: Band): { ok: boolean; why: string[] } {
  const why: string[] = []
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) why.push(`尺寸为 0（${r.width.toFixed(1)}×${r.height.toFixed(1)}）`)
  if (r.left < -0.5 || r.right > window.innerWidth + 0.5) {
    why.push(`水平越界 left=${r.left.toFixed(1)} right=${r.right.toFixed(1)}（视口宽 ${window.innerWidth}）`)
  }
  if (r.top < band.top - 0.5) why.push(`在内容带上沿之上 top=${r.top.toFixed(1)} < ${band.top.toFixed(1)}`)
  if (r.bottom > band.bottom + 0.5) why.push(`在内容带下沿之下 bottom=${r.bottom.toFixed(1)} > ${band.bottom.toFixed(1)}`)
  const clip = clipAncestorOf(el)
  if (clip && clip.scrollWidth > clip.clientWidth + 1) {
    why.push(`所在横向容器被裁剪 ${describe(clip)} scrollWidth=${clip.scrollWidth} > clientWidth=${clip.clientWidth}`)
  }
  return { ok: why.length === 0, why }
}

interface SwitcherInfo {
  found: boolean
  /** 切换器容器（含「中文」「English」两个按钮的那个盒子） */
  box: HTMLElement | null
  buttons: HTMLElement[]
}

/**
 * 语言切换器：一个已渲染容器内同时含「中文」与「English」两个按钮。
 *
 * ⚠ 必须取**最小的**那个候选：`body` 的 `textContent` 同样同时包含「中文」和「English」
 * （整页都在它里面），用「文档顺序第一个命中」会返回 body/外壳 —— 那样量到的是整页的
 * rect，断言就变成永远为真（或永远为假）的空话。这里用「面积最小 + 只认名字恰为
 * 中文/English 的按钮」两个条件钉死到真正的那个分组上。
 */
function findLanguageSwitcher(): SwitcherInfo {
  const all = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(isRendered)
  let best: { box: HTMLElement; buttons: HTMLElement[] } | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (const el of all) {
    const text = el.textContent ?? ''
    if (!text.includes('中文') || !text.includes('English')) continue
    const named = Array.from(el.querySelectorAll<HTMLElement>('button'))
      .filter(isRendered)
      .filter((b) => {
        const n = accName(b)
        return n === '中文' || n === 'English'
      })
    if (named.length < 2) continue
    const r = el.getBoundingClientRect()
    const area = r.width * r.height
    if (area < bestArea) {
      best = { box: el, buttons: named }
      bestArea = area
    }
  }
  return best ? { found: true, box: best.box, buttons: best.buttons } : { found: false, box: null, buttons: [] }
}

/* ───────────────────────── 断言 ───────────────────────── */

function checkP1(band: Band): GateCheck {
  const sw = findLanguageSwitcher()
  const threshold = '切换器存在、两个按钮都在内容带内（水平完全可见 + 竖直落在内容带内 + 最近的可横向裁剪祖先不溢出）'
  if (!sw.found || !sw.box) {
    return {
      id: 'P1',
      title: '「我的」页直接存在语言切换器，且渲染后无需任何点击就在首屏可视区内',
      pass: false,
      actual: '页面上找不到「中文 + English」同框的切换器（入口根本没渲染）',
      threshold,
      detail: `已渲染的可点击元素=${JSON.stringify(Array.from(document.querySelectorAll<HTMLElement>('button')).filter(isRendered).map(accName).slice(0, 16))}`
    }
  }
  const reaches = sw.buttons.map((b) => reachVerdict(b, band))
  const ok = reaches.every((v) => v.ok)
  const fmt = (b: HTMLElement, v: { ok: boolean; why: string[] }) => {
    const r = b.getBoundingClientRect()
    return `「${accName(b)}」rect=(${r.left.toFixed(1)},${r.top.toFixed(1)},${r.right.toFixed(1)},${r.bottom.toFixed(1)}) ${v.ok ? '在内容带内' : v.why.join('；')}`
  }
  const boxRect = sw.box.getBoundingClientRect()
  return {
    id: 'P1',
    title: '「我的」页直接存在语言切换器，且渲染后无需任何点击就在首屏可视区内',
    pass: ok,
    actual: `切换器容器 rect=(${boxRect.left.toFixed(1)},${boxRect.top.toFixed(1)},${boxRect.right.toFixed(1)},${boxRect.bottom.toFixed(1)})；按钮 ${sw.buttons.map((b, i) => fmt(b, reaches[i])).join(' / ')}`,
    threshold,
    detail: `内容带=[${band.top.toFixed(1)}, ${band.bottom.toFixed(1)}]（高 ${band.height.toFixed(1)}px，口径：${band.label}）`
  }
}

function horizontalOverflowViolations(): string[] {
  const out: string[] = []
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    if (!isRendered(el)) continue
    const cs = getComputedStyle(el)
    // ① 有横向裁剪能力的容器里，内容比盒子宽 —— 这就是「藏起入口」的机制本身
    if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) {
      out.push(`${describe(el)}[裁剪容器] scrollWidth=${el.scrollWidth} > clientWidth=${el.clientWidth}`)
      continue
    }
    // ② 元素自己伸到视口外面（无论祖先是否裁剪）
    const r = el.getBoundingClientRect()
    if (r.left < -0.5 || r.right > window.innerWidth + 0.5) {
      out.push(`${describe(el)}[越出视口] left=${r.left.toFixed(1)} right=${r.right.toFixed(1)} vw=${window.innerWidth}`)
    }
  }
  return out
}

function checkP2(): GateCheck {
  const violations = horizontalOverflowViolations()
  return {
    id: 'P2',
    title: '整页无横向溢出（真机事故的机制：入口被横向滚动容器裁在屏幕外）',
    pass: violations.length === 0,
    actual: violations.length === 0
      ? '全页每个元素都满足 scrollWidth ≤ clientWidth + 1，且没有一个元素伸到视口外'
      : `${violations.length} 处横向溢出：${violations.slice(0, 6).join(' | ')}`,
    threshold: '所有已渲染元素：scrollWidth ≤ clientWidth + 1 且 left ≥ 0 且 right ≤ innerWidth',
    detail: `扫描范围=${document.querySelectorAll('body *').length} 个元素（含顶栏/底部导航，全页）`
  }
}

async function checkP3(): Promise<GateCheck> {
  const threshold = '点 English 后：aria-pressed 翻转 **且** 页面文案真的变英文；再点中文恢复'
  const sw = findLanguageSwitcher()
  if (!sw.found) {
    return { id: 'P3', title: '语言切换真的生效（页面文案随点击变化）', pass: false, actual: '找不到语言切换器', threshold }
  }
  const enBtn = sw.buttons.find((b) => accName(b) === 'English')
  if (!enBtn) {
    return { id: 'P3', title: '语言切换真的生效（页面文案随点击变化）', pass: false, actual: `切换器里没有「English」按钮：${JSON.stringify(sw.buttons.map(accName))}`, threshold }
  }
  const zhBefore = document.body.textContent ?? ''
  const markerZh = '数据管理'
  const markerEn = 'Data Management'
  const beforeOk = zhBefore.includes(markerZh)

  enBtn.click()
  const switched = await waitFor(() => (document.body.textContent ?? '').includes(markerEn), 3000)
  const enText = document.body.textContent ?? ''
  const pressedOk = enBtn.getAttribute('aria-pressed') === 'true'
  const zhGone = !enText.includes(markerZh)

  // 还原成中文，避免污染后续量测
  const zhBtn = Array.from(document.querySelectorAll<HTMLElement>('button')).filter((b) => isRendered(b) && accName(b) === '中文')[0]
  let restored = false
  if (zhBtn) {
    zhBtn.click()
    restored = await waitFor(() => (document.body.textContent ?? '').includes(markerZh), 3000)
  }

  return {
    id: 'P3',
    title: '语言切换真的生效（页面文案随点击变化）',
    pass: beforeOk && switched && pressedOk && zhGone && restored,
    actual: `点击前含「${markerZh}」=${beforeOk}；点 English 后含「${markerEn}」=${switched}、aria-pressed=true=${pressedOk}、中文文案已消失=${zhGone}；再点中文已还原=${restored}`,
    threshold,
    detail: `英文态文案抽样=${JSON.stringify((enText.match(/[A-Za-z][A-Za-z ]{3,30}/g) ?? []).slice(0, 8))}`
  }
}

function checkP4(): GateCheck {
  const text = document.body.textContent ?? ''
  const hits: string[] = []
  if (text.includes('未知用户')) hits.push('未知用户')
  if (text.includes('Unknown user')) hits.push('Unknown user')
  return {
    id: 'P4',
    title: '不编造用户身份（本机模式没有账号，不应出现「未知用户 / Unknown user」）',
    pass: hits.length === 0,
    actual: hits.length === 0 ? '两种语言下都没有出现占位用户名' : `出现占位用户名：${hits.join('、')}`,
    threshold: 'body 文本不含「未知用户」也不含「Unknown user」',
    detail: `本机身份表述=${JSON.stringify((text.match(/(本地模式|Local mode)/g) ?? []).join(','))}`
  }
}

function checkP5(band: Band): GateCheck {
  const ratio = thresholds().contentRatio
  const threshold = `内容高度 ≥ 可用内容带的 ${(ratio * 100).toFixed(0)}%（${(band.height * ratio).toFixed(0)}px）`
  const panel = document.querySelector<HTMLElement>('[data-testid="local-profile"]')
  const col = panel?.firstElementChild
  if (!panel || !(col instanceof HTMLElement)) {
    return { id: 'P5', title: `本机账本面板的内容高度 ≥ 可用内容带 ${(ratio * 100).toFixed(0)}%（修「约 70% 空白」）`, pass: false, actual: '找不到 [data-testid="local-profile"] 或其内容列', threshold }
  }
  const kids = Array.from(col.children).filter(isRendered)
  if (kids.length === 0) {
    return { id: 'P5', title: `本机账本面板的内容高度 ≥ 可用内容带 ${(ratio * 100).toFixed(0)}%（修「约 70% 空白」）`, pass: false, actual: '内容列没有任何已渲染子块（页面是空的）', threshold }
  }
  const rects = kids.map((k) => k.getBoundingClientRect())
  const top = Math.min(...rects.map((r) => r.top))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const contentHeight = bottom - top
  const ratioActual = band.height > 0 ? contentHeight / band.height : 0
  return {
    id: 'P5',
    title: `本机账本面板的内容高度 ≥ 可用内容带 ${(ratio * 100).toFixed(0)}%（修「约 70% 空白」）`,
    pass: contentHeight >= band.height * ratio,
    actual: `内容高度 ${contentHeight.toFixed(1)}px / 可用内容带 ${band.height.toFixed(1)}px = ${(ratioActual * 100).toFixed(1)}%`,
    threshold,
    detail: `内容块数=${kids.length} 并集 top=${top.toFixed(1)} bottom=${bottom.toFixed(1)}；逐块高=${rects.map((r) => r.height.toFixed(0)).join('/')}；口径=${band.label}`
  }
}

/* ───────────────── 横向裁剪容器：判据必须绑「机制」，不能绑「写法」 ───────────────── */

/**
 * 旧判据（**已不作为 pass 依据，只保留为报告里的对照项**）：只认 Tailwind 的
 * `overflow-x-(auto|scroll|hidden)` 这三个工具类名字符串。
 *
 * 为什么它是一条**会静默变成空话**的判据：事故的机制是「`overflow-x ≠ visible` 的盒子把超宽
 * 子项裁掉」，而这个机制有无穷多种写法 —— 内联 `style`、任意类名 + 自己的 CSS 规则、
 * 组件库类名，甚至同样是 Tailwind 的 `overflow-auto` / `overflow-hidden`（两者都会把
 * `overflow-x` 展开成 auto/hidden）。把判据绑在这三个字符串上，等于绑在**一种写法**上：
 * 换一种写法，它照样报绿，但已经不再看机制了。
 */
const LEGACY_OVERFLOW_X_CLASS = /(^|\s)overflow-x-(auto|scroll|hidden)\b/

/** 只会被旧判据命中的元素（保留为对照；**不参与 pass/fail**）。 */
function legacyClassContainers(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('*')).filter(
    (el) => isRendered(el) && LEGACY_OVERFLOW_X_CLASS.test(el.className)
  )
}

/** 可横向滚动（潜在机制本身：能不能滚，而不是此刻有没有溢出）。 */
const X_SCROLL = new Set(['auto', 'scroll'])
/** 静默裁剪（真的把东西藏出可视区时才算，见 `silentlyClipped`）。 */
const X_CLIP = new Set(['hidden', 'clip'])

interface ClipScan {
  /** 可横向滚动的容器 —— 即使当前没溢出也记入。 */
  scrollable: HTMLElement[]
  /** 静默裁剪且**确实**裁掉了东西的容器。 */
  silentlyClipped: HTMLElement[]
}

/**
 * 扫描横向裁剪容器 —— **读计算样式**（`getComputedStyle().overflowX`），不读 class 名。
 *
 * 分两类表达，是为了不把「装饰性 `overflow-hidden` 但没裁掉任何东西」这种无害写法判红
 * （本页 `Preferences` 的语言切换分组就用了 `overflow-hidden` 做圆角裁边，它既不滚动、
 * 也没有东西超出，不是藏入口的机制）：
 *   ① `overflowX ∈ {auto, scroll}` → 判红。**即使当前没溢出也判红**，理由见 gp-21 的对照：
 *      「不溢出」是随时会失效的状态，不是安全状态；一个可横向滚动的容器就是
 *      「塞不下就用滚动兜底」这个形态本身，下一个更长的文案就会重演事故。
 *   ② `overflowX ∈ {hidden, clip}` 且 `scrollWidth > clientWidth + 1` → 判红（此刻真有内容
 *      被藏在可视区外）。这类与「实际溢出」这个状态绑定，所以只在真的裁剪时才算。
 */
function scanHorizontalClip(scope: HTMLElement): ClipScan {
  const scrollable: HTMLElement[] = []
  const silentlyClipped: HTMLElement[] = []
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
    if (!isRendered(el)) continue
    const ox = getComputedStyle(el).overflowX
    if (X_SCROLL.has(ox)) scrollable.push(el)
    else if (X_CLIP.has(ox) && el.scrollWidth > el.clientWidth + 1) silentlyClipped.push(el)
  }
  return { scrollable, silentlyClipped }
}

interface P6Counts {
  profileNavs: number
  navsInsidePanel: number
  scrollable: HTMLElement[]
  silentlyClipped: HTMLElement[]
  legacy: HTMLElement[]
  panel: HTMLElement | null
}

/**
 * 量测 P6 的四个计数（纯量测，不判定）—— 判据抽出来才能对**同一个页面**
 * 量两次（干净态 / 注入态）做最小对照。
 *
 * 范围界定：只看「我的」页自己的分区导航。
 *  · `.profile-nav`（旧版左侧 Tab 导航栏）必须不存在；
 *  · 面板内部不得有 nav；
 *  · 面板内不得有横向裁剪容器。
 * **不包括**底部 Tab 栏（`AndroidTabBar` 的 `<nav class="android-tabbar">`）：
 * 那是整机导航，是本页之外的既定结构，它的 4 个 Tab 也不在本页做横向滚动。
 */
function evaluateP6(): P6Counts {
  const panel = document.querySelector<HTMLElement>('[data-testid="local-profile"]')
  const profileNavs = Array.from(document.querySelectorAll<HTMLElement>('.profile-nav'))
  const navsInsidePanel = panel ? Array.from(panel.querySelectorAll<HTMLElement>('nav')).filter(isRendered) : []
  const scan = panel ? scanHorizontalClip(panel) : { scrollable: [], silentlyClipped: [] }
  const legacy = panel ? legacyClassContainers(panel) : []
  return {
    profileNavs: profileNavs.length,
    navsInsidePanel: navsInsidePanel.length,
    scrollable: scan.scrollable,
    silentlyClipped: scan.silentlyClipped,
    legacy,
    panel
  }
}

const P6_TITLE = '「我的」页没有分区导航（横向滚动导航容器从结构上不存在）'
const P6_THRESHOLD =
  '.profile-nav 数 = 0 且 面板内已渲染 nav 数 = 0 且 面板内横向裁剪容器 = 0（口径：getComputedStyle().overflowX；可横滚 auto/scroll 一律计数，静默裁剪 hidden/clip 仅在真的裁掉了东西时计数）'

function makeP6(c: P6Counts): GateCheck {
  const offending = [...c.scrollable, ...c.silentlyClipped]
  const ok = c.profileNavs === 0 && c.navsInsidePanel === 0 && offending.length === 0
  return {
    id: 'P6',
    title: P6_TITLE,
    pass: ok,
    actual: `.profile-nav 数=${c.profileNavs}，面板内 nav=${c.navsInsidePanel}，面板内横向裁剪容器=${offending.length}（可横滚 ${c.scrollable.length} + 静默裁剪 ${c.silentlyClipped.length}）`,
    threshold: P6_THRESHOLD,
    detail:
      offending.length > 0
        ? `横向裁剪容器=${offending.map(describe).join(', ')}；判据对照（class 名判据=${c.legacy.length}，计算样式判据=${offending.length}）`
        : `判据对照（class 名判据=${c.legacy.length}，计算样式判据=0）；面板标题序列=${JSON.stringify(
            Array.from(c.panel?.querySelectorAll('h2, h3') ?? []).map((h) => h.textContent)
          )}`
  }
}

/* ───────────────────── P6 判据的最小对照（旧漏 / 新抓） ───────────────────── */

/** 判据对照：把横向容器用**不含 `overflow-x-*` 工具类名**的写法注入面板，两个判据各抓到几个。 */
const CONTRAST_STYLE = '.profile-gate-arbitrary-rail{overflow-x:auto;}'

/**
 * 注入三种「旧判据看不见、新判据说得清」的横向容器写法：
 *   ① 内联样式 `overflow-x:auto`（`className` 为空 —— 判据读 class 就永远看不到它）
 *   ② 任意类名 + 自己的 CSS 规则（`overflow-x:auto`）—— 证明「换一种写法」就等于换掉判据
 *   ③ 内联 `overflow-x:hidden` + 900px 子项 —— 属于「静默裁剪」，且此刻**真的**裁掉了内容
 * 三种写法都能把内容藏出可视区，且都**不含** `overflow-x-(auto|scroll|hidden)` 这个类名字符串。
 *
 * ⚠ 为什么不用 Tailwind 的 `overflow-auto` 类做第 4 种写法（它同样能骗过旧判据）：
 * 探针构建时 Tailwind 只扫描它的 content 范围，`scripts/**` 里的类名不保证被生成 ——
 * 那样注入会「悄悄不生效」，让对照的结论取决于构建而不是判据。内联样式与自建规则不依赖构建。
 */
function injectHorizontalContainers(panel: HTMLElement): { nodes: HTMLElement[]; style: HTMLStyleElement } {
  const style = document.createElement('style')
  style.textContent = CONTRAST_STYLE
  document.head.appendChild(style)

  const make = (form: string): HTMLElement => {
    const box = document.createElement('div')
    box.setAttribute('data-gate-inject', form)
    const wide = document.createElement('div')
    wide.style.width = '900px'
    wide.textContent = 'contrast'
    box.appendChild(wide)
    return box
  }

  const inlineAuto = make('inline-style')
  inlineAuto.style.overflowX = 'auto' // ①
  const arbitraryClass = make('arbitrary-class')
  arbitraryClass.className = 'profile-gate-arbitrary-rail' // ②
  const inlineHidden = make('inline-hidden')
  inlineHidden.style.overflowX = 'hidden' // ③

  const nodes = [inlineAuto, arbitraryClass, inlineHidden]
  const host = panel.firstElementChild ?? panel
  for (const n of nodes) host.appendChild(n)
  return { nodes, style }
}

function removeInjected(ref: { nodes: HTMLElement[]; style: HTMLStyleElement }): void {
  for (const n of ref.nodes) n.remove()
  ref.style.remove()
}

const offendingOf = (c: P6Counts): HTMLElement[] => [...c.scrollable, ...c.silentlyClipped]

const SELF_CHECK_THRESHOLD =
  '干净态：无横向裁剪容器（否则是假红）；注入态：class 名判据 = 0（三种写法全部漏过）且 计算样式判据 = 3（全部抓到）；移除注入后计数回到 0'

/**
 * P6 判据的最小对照 —— 把「旧判据漏过、新判据抓到」变成一条**可失败**的断言：
 * 若把 P6 的判据改回读 class 名，`injected.legacy` 仍是 0、而「抓到数 = 3」这个要求就没人满足
 * （两种判据都会是 0），本断言随即变红。也就是说它不可能在判据退化后还保持绿色。
 */
function makeSelfCheck(clean: P6Counts, injected: P6Counts, restored: P6Counts): GateCheck {
  const cleanOffending = offendingOf(clean).length
  const injectedOffending = offendingOf(injected)
  const restoredOffending = offendingOf(restored)
  const cleanPass = clean.profileNavs === 0 && clean.navsInsidePanel === 0 && cleanOffending === 0
  const injectedPass = injected.profileNavs === 0 && injected.navsInsidePanel === 0 && injectedOffending.length === 0
  const restoredOk = restoredOffending.length === 0 && restored.legacy.length === 0
  const pass =
    cleanPass && // 不假红
    injected.legacy.length === 0 && // 旧判据漏过全部
    injectedOffending.length === 3 && // 新判据抓到全部
    !injectedPass && // 注入态下 P6 必须真的变红（否则判据是空转）
    restoredOk // 注入已清理干净
  return {
    id: 'P6s',
    title: 'P6 判据最小对照：class 名判据漏过全部注入写法，计算样式判据全部抓到',
    pass,
    actual:
      `干净态：class=${clean.legacy.length} 计算样式=${cleanOffending}（P6=${cleanPass ? 'PASS' : 'FAIL'}）；` +
      `注入态：class=${injected.legacy.length} 计算样式=${injectedOffending.length}（可横滚 ${injected.scrollable.length} + 静默裁剪 ${injected.silentlyClipped.length}）→ P6=${injectedPass ? 'PASS' : 'FAIL'}；` +
      `移除后：class=${restored.legacy.length} 计算样式=${restoredOffending.length}`,
    threshold: SELF_CHECK_THRESHOLD,
    detail: `注入的三种写法=${JSON.stringify(
      injectedOffending.map((el) => el.getAttribute('data-gate-inject') ?? describe(el))
    )}`
  }
}


/* ───────────────────────── 入口 ───────────────────────── */

export async function runGate(): Promise<GateReport> {
  // ⚠ 顺序：`createRoot().render()` 是异步的，`runGate()` 在 render 之后**同步**被调用，
  // 所以此刻 DOM 还不存在 —— 必须先等到页面真的渲染出来，再量内容带。
  // （实测踩到：在 waitFor 之前量内容带，`[data-testid="app-main"]` 为 null，
  //  内容带回退成「整视口 915px」，于是 P1/P5 的判据全部失真。）
  await waitFor(() => document.querySelector('[data-testid="local-profile"]') !== null, 8000)
  // 等本页的本地聚合（getUserStats）落地：数据概览块的高度是内容高度的一部分
  await waitFor(
    () => (document.body.textContent ?? '').includes('账单总数') || (document.body.textContent ?? '').includes('暂无数据概览'),
    6000
  )
  await sleep(150)
  // 页面必须从头量（否则「在内容带内」会被滚动位置污染）
  const main = document.querySelector<HTMLElement>('[data-testid="app-main"]')
  if (main) main.scrollTop = 0
  await sleep(80)

  const band = contentBand()

  const checks: GateCheck[] = []
  checks.push(checkP1(band))
  checks.push(checkP2())
  checks.push(await checkP3())
  checks.push(checkP4())
  checks.push(checkP5(band))
  const cleanP6 = evaluateP6()
  checks.push(makeP6(cleanP6))

  const sw = findLanguageSwitcher()
  const boxRect = sw.box?.getBoundingClientRect() ?? null
  const activePageText = (document.body.textContent ?? '').slice(0, 80)

  // 最小对照（仅 `--self-check`）：对**同一个页面**再量一次 P6 ——
  // 注入横向容器后旧判据应当一个都看不见、新判据应当全部看见。
  let selfCheck: GateCheck | undefined
  if (thresholds().selfCheck === true && cleanP6.panel) {
    const injected = injectHorizontalContainers(cleanP6.panel)
    const injectedCounts = evaluateP6()
    removeInjected(injected)
    const restoredCounts = evaluateP6()
    selfCheck = makeSelfCheck(cleanP6, injectedCounts, restoredCounts)
  }

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    env: {
      htmlClass: document.documentElement.className,
      platformAndroid: document.documentElement.classList.contains('platform-android'),
      bodyOverscrollY: getComputedStyle(document.body).overscrollBehaviorY,
      mainPaddingBottom: main ? px(getComputedStyle(main).paddingBottom) : null,
      band: { top: Number(band.top.toFixed(1)), bottom: Number(band.bottom.toFixed(1)), height: Number(band.height.toFixed(1)), label: band.label },
      switcherRect: boxRect ? { left: Number(boxRect.left.toFixed(1)), top: Number(boxRect.top.toFixed(1)), right: Number(boxRect.right.toFixed(1)), bottom: Number(boxRect.bottom.toFixed(1)) } : null,
      hasLocalProfilePanel: document.querySelector('[data-testid="local-profile"]') !== null,
      mainScrollTop: main ? main.scrollTop : null,
      textSample: activePageText
    },
    checks,
    selfCheck
  }
}
