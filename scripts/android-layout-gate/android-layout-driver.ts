/**
 * 安卓布局门禁 —— 浏览器侧驱动器（在真实排版引擎里量测 8 条断言）。
 *
 * 只依赖 DOM + 真实计算样式；不依赖任何 class 名（worker 正在重排 DOM，class 会漂移），
 * 一律用「文本定位 + 祖先关系 + 计算样式」表达，使同一条断言能同时表达新旧两种 DOM。
 *
 * 返回值由 `verify-android-layout.cjs` 序列化后打印；本文件不 console.log。
 */
import { useStore } from '@/store'
import { BILLS, nameText, amountText } from './android-layout-fixture'

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
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
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

/* ───────────────────────── 账单页行结构 ───────────────────────── */

interface RowProbe {
  id: number
  nameEl: HTMLElement
  amountEl: HTMLElement
  row: HTMLElement
  rect: DOMRect
}

function findBillRows(): RowProbe[] {
  const out: RowProbe[] = []
  for (const bill of BILLS) {
    const amountEl = deepByText(amountText(bill))
    const nameEl = deepByText(nameText(bill))
    if (!amountEl || !nameEl) continue
    const row = lca(nameEl, amountEl)
    out.push({ id: bill.id, nameEl, amountEl, row, rect: row.getBoundingClientRect() })
  }
  return out
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

/** A4 统计页 3 个图表 animationDuration 均为 300（运行时读 recharts 实例 props） */
async function checkA4Runtime(): Promise<{ check: GateCheck; diag: unknown }> {
  await nav('stats')
  await waitFor(() => document.querySelectorAll('.recharts-wrapper').length >= 1)
  await sleep(300)
  const scan = scanChartFibers()
  const wrappers = document.querySelectorAll('.recharts-wrapper').length
  const with300 = scan.candidates.filter((c) => c.animationDuration === thresholds().chartAnimationDuration).length
  const values = scan.candidates.map((c) => String(c.animationDuration))
  const pass = scan.rootFound && scan.candidates.length >= thresholds().chartCount && with300 >= thresholds().chartCount
  return {
    check: {
      id: 'A4',
      title: `统计页 ${thresholds().chartCount} 个图表 animationDuration = ${thresholds().chartAnimationDuration}`,
      pass,
      actual: `recharts 容器 ${wrappers} 个；实例 props 中 animationDuration=300 的 ${with300}/${scan.candidates.length} 个`,
      threshold: `≥ ${thresholds().chartCount} 个图表 animationDuration === ${thresholds().chartAnimationDuration}`,
      detail: `fiber 扫描：rootFound=${scan.rootFound} visited=${scan.visited} 值集=${JSON.stringify(values.slice(0, 12))}`
    },
    diag: { wrappers, values, visited: scan.visited, rootFound: scan.rootFound, with300 }
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
      const parent = el.parentElement
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

/** A6 分类管理页存在可见返回入口，点击后 activePage === 'profile' */
async function checkA6(): Promise<GateCheck> {
  await nav('categories')
  await waitFor(() => Boolean(deepByText('分类管理')) || visibleClickables().length > 0)
  await sleep(200)
  const cands = visibleClickables().filter((el) => /返回|back/i.test(accName(el)))
  if (cands.length === 0) {
    const inventory = visibleClickables().map((el) => accName(el)).filter(Boolean).slice(0, 12)
    return {
      id: 'A6',
      title: '分类管理页有可见返回入口且点击后回到「我的」',
      pass: false,
      actual: '未找到任何可见的返回入口（可点击元素的可访问名无一匹配 /返回|back/i）',
      threshold: '存在可见返回入口，点击后 activePage === "profile"',
      detail: `当前可点击元素清单=${JSON.stringify(inventory)}`
    }
  }
  const target = cands[0]
  target.click()
  const ok = await waitFor(() => useStore.getState().activePage === 'profile', 3000)
  return {
    id: 'A6',
    title: '分类管理页有可见返回入口且点击后回到「我的」',
    pass: ok,
    actual: `找到 ${cands.length} 个候选返回入口（如「${accName(target)}」）；点击后 activePage = "${useStore.getState().activePage}"`,
    threshold: '点击后 activePage === "profile"',
    detail: ok ? undefined : '点击后未回到「我的」页'
  }
}

interface SwitcherInfo { found: boolean; rect?: DOMRect; buttons: string[] }

/** 语言切换器：一个可见容器内同时含「中文」与「English」两个按钮 */
function findLanguageSwitcher(): SwitcherInfo {
  const els = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(isVisible)
  for (const el of els) {
    if ((el.textContent ?? '').includes('中文') && (el.textContent ?? '').includes('English')) {
      const btns = Array.from(el.querySelectorAll<HTMLElement>('button')).filter(isVisible)
      if (btns.length >= 2) return { found: true, rect: el.getBoundingClientRect(), buttons: btns.map((b) => accName(b)) }
    }
  }
  return { found: false, buttons: [] }
}

/** A7 「我的」页可点击到设置入口，点击后出现语言切换器（且切换器真的可用） */
async function checkA7(): Promise<GateCheck> {
  const attempts: string[] = []
  {
    await nav('profile')
    await waitFor(() => visibleClickables().length > 0)
    await sleep(150)
    const cands = visibleClickables().filter((el) => /设置|settings/i.test(accName(el)))
    if (cands.length === 0) {
      const inventory = visibleClickables().map((el) => accName(el)).filter(Boolean).slice(0, 14)
      return {
        id: 'A7',
        title: '「我的」页可点开设置入口并出现语言切换器',
        pass: false,
        actual: '「我的」页没有任何可见的可点击元素其可访问名匹配 /设置|settings/i',
        threshold: '存在设置入口 → 点击后出现语言切换器',
        detail: `当前可点击元素清单=${JSON.stringify(inventory)}`
      }
    }
    for (const el of cands) {
      const name = accName(el)
      el.click()
      const appeared = await waitFor(() => findLanguageSwitcher().found, 1500)
      if (!appeared) { attempts.push(`「${name}」→ 未出现语言切换器`); continue }
      const sw = findLanguageSwitcher()
      // 行为级：切换器的按钮必须真的能切换
      const btns = Array.from(document.querySelectorAll<HTMLElement>('button')).filter(
        (b) => isVisible(b) && (accName(b) === 'English' || accName(b) === '中文')
      )
      const target = btns.find((b) => accName(b) === 'English') ?? btns.find((b) => b.getAttribute('aria-pressed') !== 'true')
      let toggled = false
      if (target) {
        const label = accName(target)
        target.click()
        toggled = await waitFor(() => {
          const again = Array.from(document.querySelectorAll<HTMLElement>('button')).filter(
            (b) => isVisible(b) && accName(b) === label
          )
          return again.some((b) => b.getAttribute('aria-pressed') === 'true')
        }, 1500)
        // 还原成中文，避免污染后续断言
        const zh = Array.from(document.querySelectorAll<HTMLElement>('button')).filter((b) => isVisible(b) && accName(b) === '中文')
        if (toggled && zh.length > 0) { zh[0].click(); await sleep(150) }
      }
      attempts.push(`「${name}」→ 出现语言切换器（${JSON.stringify(sw.buttons)}），切换可交互=${toggled}`)
      return {
        id: 'A7',
        title: '「我的」页可点开设置入口并出现语言切换器',
        pass: toggled,
        actual: `设置入口「${name}」点击后出现语言切换器，按钮=${JSON.stringify(sw.buttons)}`,
        threshold: '出现语言切换器且切换按钮可交互（aria-pressed 随点击翻转）',
        detail: toggled ? attempts.join(' | ') : `${attempts.join(' | ')}；切换器存在但点击未改变 aria-pressed`
      }
    }
  }
  return {
    id: 'A7',
    title: '「我的」页可点开设置入口并出现语言切换器',
    pass: false,
    actual: attempts.join(' | ') || '未找到可用的设置入口',
    threshold: '出现语言切换器且切换按钮可交互'
  }
}
/** A8 安卓端「我的」页不存在「空壳 Tab」 */
async function checkA8(): Promise<GateCheck> {
  await nav('profile')
  await waitFor(() => visibleClickables().length > 0)
  await sleep(150)
  const SHELL_LABELS = ['安全设置', '绑定管理', '危险操作']
  const hits: string[] = []
  for (const label of SHELL_LABELS) {
    for (const el of visibleClickables()) {
      if (accName(el) !== label) continue
      hits.push(`${label}<${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}` : ''}>`)
    }
  }
  const inventory = visibleClickables().map((el) => accName(el)).filter(Boolean)
  return {
    id: 'A8',
    title: '「我的」页不存在空壳 Tab（安全设置/绑定管理/危险操作 不再作为导航项）',
    pass: hits.length === 0,
    actual: hits.length === 0 ? '三个空壳 Tab 均已不在「我的」页作为可点击导航项出现' : `仍存在 ${hits.length} 个空壳 Tab 导航项：${hits.join('、')}`,
    threshold: '匹配 {安全设置, 绑定管理, 危险操作} 的可见可点击导航项数 = 0',
    detail: `当前「我的」页可见可点击元素清单=${JSON.stringify(Array.from(new Set(inventory)).slice(0, 18))}`
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
  try {
    env.clickMechanism = await clickMechanismSelfCheck()
  } catch (e) {
    env.clickMechanism = { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
  try {
    Object.assign(env, await envEvidence())
  } catch (e) {
    env.envEvidenceError = e instanceof Error ? e.message : String(e)
  }
  useStore.getState().setActivePage('home')
  return { viewport: { w: window.innerWidth, h: window.innerHeight }, env, checks }
}
