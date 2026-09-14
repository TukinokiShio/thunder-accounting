/**
 * 桌面视口比对门禁 —— 驱动（在 **1280×900 桌面路径** 下量测，供「基线 vs 主树」逐项比对）。
 *
 * 这个门禁要守的不变量：**这一轮安卓重排对桌面零变化**。
 * 为什么不能只靠「源码级检查 + class 枚举」：枚举不完，且表达不了 Tailwind 的层叠语义
 * （实测教训：`sm:leading-normal` 看似复位、实为改值；`min-w-0` 加在 flex 容器上是 no-op）。
 * 所以这里换一种证据：在真排版引擎里把**两棵树的桌面渲染结果**逐节点量成 computed style，
 * 要求**逐项精确相等** —— 不看源码怎么写的，只看渲染出来是什么。
 *
 * 与安卓驱动的三点差异（其余思路一致）：
 *  ① 探针页**不打** `platform-android`（这就是「桌面侧」的定义）；
 *  ② 视口 1280×900（落在 `lg` 断点）；
 *  ③ 环境自检是**反向**的：必须证明「这不是安卓布局」。
 *
 * 本文件不做判定，只负责产出量测快照；比对与判定在 `scripts/verify-desktop-parity.cjs`。
 */

import { useStore } from '@/store'
import { BILLS, nameText, amountText } from './fixture'

type StyleMap = Record<string, string>

interface NodeRec {
  path: string
  s: StyleMap
}

interface PageRec {
  page: string
  nodeCount: number
  captured: number
  truncated: boolean
  /**
   * **同一次运行内连采两次是否逐字相同**。这是「快照里没有混进动画中间帧 / 异步竞态」的
   * 直接证据 —— 把「门禁偶发变红」变成一次响亮的、可定位的失败，而不是间歇性 flaky。
   */
  stable: boolean
  unstablePaths: string[]
  nodes: NodeRec[]
}

interface ProbeRec {
  found: boolean
  text?: string
  /**
   * **未截断**原串的摘要（FNV-1a 32 位）。跨侧文本判据用它，`text` 只用于打印。
   *
   * 为什么必须分开（gp-18 指出的有损判据）：`text` 有 60/300 字符上限，而跨侧比对
   * 若用 `text`，则**超过上限的部分两侧会被同样砍掉 ⇒ 判为相等**。截断是砍尾巴，
   * 所以「清单最尾部那几张卡变了」这类差异会被静默吞掉。原则：
   * **呈现可以有损，判据必须无损。**
   */
  textHash?: number
  /**
   * 聚合量观测到的样本数（元素级 vacuity 之外的第二类空过）。
   *
   * 为什么需要：探针的 `find` 只保证「元素在」，`keys: []` 的聚合探针对自己的样式零贡献，
   * 全部信号都在 metric 上。若聚合的标记结构变了（如 svg 外层多包一层），metric 会输出
   * 「0 个……配色 0 种：」—— **两侧完全一致 ⇒ PASS，且不触发任何元素级护栏**。
   * 即：元素找到了，但探针什么都没看见。`observed === 0` 必须按空过处理。
   */
  observed?: number
  s: StyleMap
}

interface Dump {
  viewport: { w: number; h: number }
  env: Record<string, unknown>
  pages: PageRec[]
  probes: Record<string, ProbeRec>
  counts: Record<string, Record<string, number>>
}

/**
 * 被比对的 computed style 属性（**固定清单**：增删即改门禁口径，必须同步报告）。
 * 覆盖几何 / 排版 / 层叠 / 颜色 / flex & grid —— 桌面回归通常先从这几类里露头。
 */
const PROPS = [
  'display', 'position', 'box-sizing', 'z-index', 'transform',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-bottom-width', 'border-radius', 'border-top-color',
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'color', 'background-color', 'opacity', 'visibility', 'cursor',
  'overflow-x', 'overflow-y', 'text-overflow', 'white-space',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'align-items', 'justify-content', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns'
].join('|').split('|')

/** 结构统计（易读的附加证据；主证据是逐节点指纹）。 */
const COUNT_SELECTORS = [
  '[data-testid="page-frame"]',
  '.aurora-sidebar',
  '.aurora-topbar',
  '.android-tabbar',
  '.home-dashboard-card',
  '.stats-card',
  '.recharts-responsive-container',
  '.recharts-surface',
  '.profile-nav nav > button'
]

const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'title', 'noscript', 'template'])

/** 单页节点上限：超限即视为「比对不完整」，由 .cjs 侧按环境未就绪处理（不允许静默截断）。 */
const MAX_NODES_PER_PAGE = 6000

const PAGES = ['home', 'bills', 'stats', 'profile', 'categories'] as const
type PageName = (typeof PAGES)[number]

/* ── 小工具 ─────────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 等待条件成立。
 * **按「轮次」而不是按墙钟计时**：本门禁跑在 `--virtual-time-budget` 下，`Date.now()` 会随虚拟时钟
 * 跳进（实测会被提前判超时），用轮次计数才能拿到稳定的等待语义。cycles × ms 即最坏等待量。
 */
async function waitCycles(fn: () => boolean, cycles: number, ms = 50): Promise<boolean> {
  for (let i = 0; i < cycles; i++) {
    try {
      if (fn()) return true
    } catch {
      /* 渲染中途的读取异常忽略 */
    }
    await sleep(ms)
  }
  try {
    return fn()
  } catch {
    return false
  }
}

/** 记录运行时错误（否则「没挂载」只能靠猜）。 */
const runtimeErrors: string[] = []
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => runtimeErrors.push(`error: ${e.message}`))
  window.addEventListener('unhandledrejection', (e) =>
    runtimeErrors.push(`rejection: ${String((e as PromiseRejectionEvent).reason)}`)
  )
}

/**
 * 快照稳定性由 `captureStable()`（连采两次逐字比对）负责，这里不再用 WAAPI 的 playState 判定：
 * 实测在 `--virtual-time-budget` + `--force-prefers-reduced-motion` 下会有 8 个
 * `CSSTransition@button[running]` **永远不结束**（时长已被压到 .01ms，但 headless 不产帧，
 * 过渡状态机停在 running），拿它当门只会让门禁永久退 2；而它本来也只是**代理指标**。
 * 直接比两次快照既覆盖动画中间帧、也覆盖异步数据未落地，且与判定口径完全同源。
 */

function depthOf(el: Element): number {
  let d = 0
  let cur: Element | null = el
  while (cur && cur.parentElement) {
    d++
    cur = cur.parentElement
  }
  return d
}

/** 找出 textContent 恰好等于 text 的**最深**元素（避开会把整页文本都当成匹配的祖先）。 */
function deepByText(text: string): HTMLElement | null {
  const all = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
  let best: HTMLElement | null = null
  for (const el of all) {
    if (el.children.length > 0) continue
    if ((el.textContent || '').trim() === text) {
      if (!best || depthOf(el) > depthOf(best)) best = el
    }
  }
  return best
}

/** 最小公共祖先。 */
function lca(a: Element | null, b: Element | null): HTMLElement | null {
  if (!a || !b) return null
  const chain: Element[] = []
  let cur: Element | null = a
  while (cur) {
    chain.push(cur)
    cur = cur.parentElement
  }
  cur = b
  while (cur) {
    if (chain.indexOf(cur) >= 0) return cur as HTMLElement
    cur = cur.parentElement
  }
  return null
}

/** 结构路径：`html>body[1]>div[2]>svg[1]`，同一父节点下按**同标签**序号计数（插入别的标签不会平移）。 */
function pathOf(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.documentElement) {
    const parent = cur.parentElement
    if (!parent) break
    const tag = cur.tagName
    let ord = 0
    for (const sib of Array.from(parent.children)) {
      if (sib.tagName === tag) {
        ord++
        if (sib === cur) break
      }
    }
    parts.unshift(`${tag.toLowerCase()}[${ord}]`)
    cur = parent
  }
  return `html>${parts.join('>')}`
}

function styleOf(el: Element, props: string[]): StyleMap {
  const cs = getComputedStyle(el as HTMLElement)
  const out: StyleMap = {}
  for (const p of props) out[p] = cs.getPropertyValue(p)
  return out
}

function q<T extends Element = HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel)
}

/** FNV-1a 32 位：给「未截断原串」算摘要，用作无损文本判据。 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** 聚合量：既给打印用的截断串，也给判据用无损摘要，并可声明「我看见了几个样本」。 */
interface MetricOut {
  text: string
  observed?: number
}

function probeEl(
  name: string,
  el: Element | null | undefined,
  keys: string[],
  metric?: () => MetricOut
): ProbeRec {
  if (!el) return { found: false, s: {} }
  const m = metric ? metric() : null
  const raw = (m ? m.text : el.textContent || '').trim()
  // 元素文本沿用原来的 60 字符上限（既有探针的输出不受影响）；
  // metric 是**派生的聚合量**，需要放下完整清单，给更宽的上限。
  // 注意：上限只影响打印，判据一律用 textHash（无损）。
  const cap = metric ? 300 : 60
  const rec: ProbeRec = {
    found: true,
    text: raw.length > cap ? `${raw.slice(0, cap - 3)}...` : raw,
    textHash: fnv1a(raw),
    s: styleOf(el, keys)
  }
  if (m && typeof m.observed === 'number') rec.observed = m.observed
  return rec
}

/* ── 页面导航 ───────────────────────────────────────────────────────────── */

async function nav(page: PageName): Promise<void> {
  useStore.getState().setActivePage(page)
  billsAnchorCache = undefined
  await sleep(250)
  // 页面数据是异步取的；等到「该页的特征节点」真的出现再量，避免量到空壳
  if (page === 'home') {
    await waitCycles(() => q('.home-stats-grid')?.firstElementChild != null, 80)
  } else if (page === 'bills') {
    await waitCycles(() => deepByText(nameText(BILLS[0])) !== null, 120)
  } else if (page === 'stats') {
    await waitCycles(() => q('.recharts-responsive-container') !== null, 120)
  } else if (page === 'profile') {
    await waitCycles(() => q('.profile-nav nav')?.querySelector('button') != null, 80)
  } else if (page === 'categories') {
    await waitCycles(() => q('[data-testid="page-frame"]')?.firstElementChild != null, 80)
  }
  await sleep(120)
}

/* ── 采集 ───────────────────────────────────────────────────────────────── */

/**
 * 连采两次并要求逐字相同（不相等就说明这次快照不可信）。
 * 返回第二次的结果，避免把两次数据都写进报告。
 */
async function captureStable(page: PageName): Promise<PageRec> {
  const first = collectPage(page)
  await sleep(150)
  const second = collectPage(page)
  const unstablePaths: string[] = []
  if (first.nodeCount !== second.nodeCount || first.captured !== second.captured) {
    unstablePaths.push(`nodeCount ${first.nodeCount}→${second.nodeCount}`)
  }
  const secondMap = new Map(second.nodes.map((n) => [n.path, n.s]))
  for (const n of first.nodes) {
    const s2 = secondMap.get(n.path)
    if (!s2) {
      unstablePaths.push(`${n.path} (missing)`)
      continue
    }
    for (const k of Object.keys(n.s)) {
      if (n.s[k] !== s2[k] && unstablePaths.length < 12) {
        unstablePaths.push(`${n.path} ${k}: ${n.s[k]} → ${s2[k]}`)
      }
    }
    if (unstablePaths.length >= 12) break
  }
  return { ...second, stable: unstablePaths.length === 0, unstablePaths }
}

function collectPage(page: PageName): PageRec {
  const all = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter((el) => {
    const tag = el.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag)) return false
    if (el.id === 'out') return false
    return true
  })
  const list: HTMLElement[] = [document.body, ...all]
  const truncated = list.length > MAX_NODES_PER_PAGE
  const use = truncated ? list.slice(0, MAX_NODES_PER_PAGE) : list
  return {
    page,
    nodeCount: list.length,
    captured: use.length,
    truncated,
    stable: true,
    unstablePaths: [],
    nodes: use.map((el) => ({ path: pathOf(el), s: styleOf(el, PROPS) }))
  }
}

/** 账单页：定位「第一笔渲染出来的账单」的分类名文字节点（文本定位，不看 class）。 */
function billsAnchorImpl(): { nameEl: HTMLElement; amountEl: HTMLElement | null; label: string } | null {
  const order = new Map<Element, number>()
  Array.from(document.body.querySelectorAll('*')).forEach((el, i) => order.set(el, i))
  let best: { nameEl: HTMLElement; amountEl: HTMLElement | null; label: string; idx: number } | null = null
  for (const b of BILLS) {
    const nameEl = deepByText(nameText(b))
    if (!nameEl) continue
    const amountEl = deepByText(amountText(b))
    const idx = order.get(nameEl) ?? Number.MAX_SAFE_INTEGER
    if (!best || idx < best.idx) best = { nameEl, amountEl, label: nameText(b), idx }
  }
  return best ? { nameEl: best.nameEl, amountEl: best.amountEl, label: best.label } : null
}

/** 同一页里三个账单探针共用一次定位（每次定位都要全 DOM 扫描，不缓存会白扫 3 遍）。 */
let billsAnchorCache: ReturnType<typeof billsAnchorImpl> | undefined
function billsAnchor(): ReturnType<typeof billsAnchorImpl> {
  if (billsAnchorCache === undefined) billsAnchorCache = billsAnchorImpl()
  return billsAnchorCache
}

interface ProbeSpec {
  page: PageName
  name: string
  keys: string[]
  find: () => Element | null | undefined
  /** 可选的**派生聚合量**：替代元素的 textContent 参与跨侧文本比对（见 home.iconColorSet）。 */
  metric?: () => MetricOut
}

const PROBE_SPECS: ProbeSpec[] = [
  /* ── 首页统计卡 ── */
  {
    page: 'home',
    name: 'home.statsGrid',
    keys: ['display', 'grid-template-columns', 'column-gap', 'row-gap', 'width'],
    find: () => q('.home-stats-grid')
  },
  {
    page: 'home',
    name: 'home.card',
    keys: ['width', 'height', 'padding-top', 'padding-left', 'border-radius'],
    find: () => q('.home-stats-grid')?.firstElementChild ?? null
  },
  {
    // 「首页统计卡图标盒统一强调色」这条不变量是**聚合**性质的：`src/index.css:510` 的
    // `.aurora-shell .home-stats-grid .w-8.h-8 { … !important }` 让网格里**所有**图标盒
    // 统一取强调色。所以这里报**去重后的配色种数**，而不是某一张卡的色值。
    //
    // 为什么不能用单卡探针（这是实测踩出来的，不是设计偏好）：把改动「`w-8 h-8` 拆成
    // `w-7 h-7 sm:w-8 sm:h-8`」注回对照树后，**盯第 1 张卡的探针竟然 PASS**
    // ——因为 `Home.tsx:97` 里第 1 张卡的 `card.color` 本身就是
    // `text-[var(--accent)] bg-[var(--accent-dim)]`，是全网格里**唯一**在选择器失配时
    // 外观不变的那张。选它等于选了一个必然看不见缺陷的目标。
    //
    // 也不能用 `.w-8.h-8` 选：那正是失配的那个字面量，失配后探针会「找不到元素」，
    // 把「语义丢失」误报成「DOM 变了」。
    page: 'home',
    name: 'home.iconColorSet',
    keys: [],
    find: () => q('.home-stats-grid'),
    metric: () => {
      const boxes = Array.from(document.querySelectorAll<HTMLElement>('.home-stats-grid *')).filter(
        (el) => el.children.length === 1 && el.firstElementChild?.tagName.toLowerCase() === 'svg'
      )
      const pairs = boxes.map((el) => {
        const s = getComputedStyle(el)
        return `${s.color} / ${s.backgroundColor}`
      })
      const uniq = Array.from(new Set(pairs))
      // 文件头的 6 张卡是已知契约；`observed` 把「我看见了几个图标盒」交给比对层，
      // 于是「聚合量为空」不再能和「两侧真的一样」混淆（见 ProbeRec.observed）。
      return {
        text: `${boxes.length} 个图标盒（尺寸 ${boxes.map((b) => getComputedStyle(b).width).join(',')}），配色 ${uniq.length} 种：${uniq.join(' | ')}`,
        observed: boxes.length
      }
    }
  },
  {
    page: 'home',
    name: 'home.card.label',
    keys: ['font-size', 'line-height', 'white-space', 'overflow-x', 'text-overflow', 'min-width'],
    find: () => q('.home-stats-grid')?.firstElementChild?.querySelector('span') ?? null
  },
  {
    page: 'home',
    name: 'home.card.value',
    keys: ['font-size', 'line-height', 'font-weight', 'margin-top'],
    find: () => q('.home-stats-grid')?.firstElementChild?.querySelector('p') ?? null
  },
  /* ── 账单行文字列 ── */
  {
    page: 'bills',
    name: 'bills.nameText',
    keys: ['width', 'min-width', 'overflow-x', 'overflow-y', 'text-overflow', 'white-space', 'font-size', 'line-height'],
    find: () => billsAnchor()?.nameEl ?? null
  },
  {
    page: 'bills',
    name: 'bills.nameText.p1',
    keys: ['display', 'width', 'min-width', 'flex-grow', 'flex-shrink', 'flex-basis', 'overflow-x', 'text-overflow', 'white-space'],
    find: () => billsAnchor()?.nameEl.parentElement ?? null
  },
  {
    page: 'bills',
    name: 'bills.row',
    keys: ['display', 'align-items', 'gap', 'padding-top', 'padding-left', 'min-height', 'width'],
    find: () => {
      const a = billsAnchor()
      return a ? lca(a.nameEl, a.amountEl) : null
    }
  },
  /* ── 统计页 ── */
  {
    page: 'stats',
    name: 'stats.card0',
    keys: ['width', 'height', 'padding-top', 'padding-left', 'line-height', 'border-radius'],
    find: () => q('.stats-card')
  },
  {
    page: 'stats',
    name: 'stats.chart0',
    keys: ['width', 'height', 'display', 'overflow-x', 'overflow-y'],
    find: () => q('.recharts-responsive-container')
  },
  {
    page: 'stats',
    name: 'stats.chartSvg0',
    keys: ['width', 'height'],
    find: () => q('.recharts-surface')
  },
  {
    // recharts 图例容器（类名出处：`node_modules/recharts/lib/component/Legend.js:176`
    // 的 `recharts-legend-wrapper`，不是推断出来的）。
    // 补它的原因：上一轮实测里「桌面删掉 Legend」这条改动，**唯一**能直接点名的锚点就是
    // 这个容器（`width: 386px → 0px` / `height: 44px → 0px` / `visibility: visible → hidden`）。
    // 既有 `stats.chart0` 盯的是 `.recharts-responsive-container`（395.812px 两侧相同）、
    // `stats.chartSvg0` 盯 `.recharts-surface`（也是两侧相同）—— 只看既有探针会得出
    // 「桌面没变」的错误结论。
    page: 'stats',
    name: 'stats.legend0',
    keys: ['width', 'height', 'display', 'visibility', 'position'],
    find: () => q('.recharts-legend-wrapper')
  },
  /* ── 个人中心 ── */
  {
    page: 'profile',
    name: 'profile.nav',
    keys: ['display', 'flex-wrap', 'gap', 'row-gap', 'column-gap', 'padding-top', 'padding-bottom', 'overflow-x', 'grid-template-columns'],
    find: () => q('.profile-nav nav')
  },
  {
    page: 'profile',
    name: 'profile.navBtn0',
    keys: ['width', 'min-height', 'padding-top', 'padding-left', 'padding-right', 'font-size', 'white-space', 'margin-top'],
    find: () => q('.profile-nav nav')?.querySelector('button') ?? null
  },
  /* ── 分类管理页头 ── */
  {
    page: 'categories',
    name: 'categories.root',
    keys: ['display', 'flex-direction', 'height', 'width'],
    find: () => q('[data-testid="page-frame"]')?.firstElementChild ?? null
  },
  {
    page: 'categories',
    name: 'categories.header',
    keys: ['display', 'align-items', 'justify-content', 'gap', 'padding-top', 'padding-left', 'padding-right', 'border-bottom-width', 'height'],
    find: () => q('[data-testid="page-frame"]')?.firstElementChild?.firstElementChild ?? null
  },
  /* ── 应用外壳（首页时采集）── */
  {
    page: 'home',
    name: 'app.shell',
    keys: ['display', 'width', 'height', 'min-width'],
    find: () => q('[data-testid="app-shell"]')
  },
  {
    page: 'home',
    name: 'app.sidebar',
    keys: ['display', 'width', 'padding-top', 'padding-left', 'border-right-width'],
    find: () => q('.aurora-sidebar')
  },
  {
    page: 'home',
    name: 'app.main',
    keys: ['display', 'width', 'min-width', 'padding-top', 'padding-left', 'padding-right', 'padding-bottom', 'overflow-y'],
    find: () => q('[data-testid="app-main"]')
  },
  {
    page: 'home',
    name: 'app.topbar',
    keys: ['display', 'height', 'padding-top', 'padding-left', 'padding-right', 'gap'],
    find: () => q('.aurora-topbar')
  }
]

function envEvidence(): Record<string, unknown> {
  const main = q('[data-testid="app-main"]')
  const sidebar = q('.aurora-sidebar')
  const root = q('#root')
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    htmlClass: document.documentElement.className,
    platformAndroid: document.documentElement.classList.contains('platform-android'),
    bodyOverscrollY: getComputedStyle(document.body).overscrollBehaviorY,
    mainPaddingBottom: main ? getComputedStyle(main).paddingBottom : null,
    sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : null,
    androidTabbarPresent: q('.android-tabbar') !== null,
    pageFramePresent: q('[data-testid="page-frame"]') !== null,
    activePage: useStore.getState().activePage,
    /* 诊断（只在异常时有用）：为什么没挂载 / 挂载了什么 */
    rootChildCount: root ? root.children.length : null,
    rootTextHead: root ? (root.textContent || '').replace(/\s+/g, ' ').slice(0, 160) : null,
    runtimeErrors: runtimeErrors.slice(0, 5)
  }
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

const shellPresent = () =>
  q('[data-testid="app-main"]') !== null && q('[data-testid="page-frame"]') !== null

export async function runGate(onProgress?: (payload: unknown) => void): Promise<Dump> {
  // 先给挂载留时间再判定；不在这里早退 —— 早退过一次实测会把「还没挂载」误报成「没有快照」
  await sleep(400)
  await waitCycles(shellPresent, 200)
  if (!shellPresent()) {
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      env: { renderTimedOut: true, ...envEvidence() },
      pages: [],
      probes: {},
      counts: {}
    } as Dump
  }
  await sleep(200)

  // env 在任何交互/翻页**之前**采集（避免被后续状态污染）；动画落定情况只有在跑完所有页后才有意义
  const env = envEvidence()
  const pages: PageRec[] = []
  const probes: Record<string, ProbeRec> = {}
  const counts: Record<string, Record<string, number>> = {}

  for (const page of PAGES) {
    await nav(page)
    pages.push(await captureStable(page))
    const pageCounts: Record<string, number> = {}
    for (const sel of COUNT_SELECTORS) pageCounts[sel] = document.querySelectorAll(sel).length
    counts[page] = pageCounts
    for (const spec of PROBE_SPECS) {
      if (spec.page !== page) continue
      probes[spec.name] = probeEl(spec.name, spec.find(), spec.keys, spec.metric)
    }
    // 逐页回写进度：若虚拟时间预算被耗尽、--dump-dom 提前取走 DOM，<pre> 里仍留有**部分**结果，
    // 而不是一片空白（否则「空 JSON」既看不出跑到哪一步，也分不清是探针崩了还是被截断）
    if (onProgress) {
      onProgress({
        partial: true,
        stage: page,
        donePages: pages.length,
        totalPages: PAGES.length,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        env,
        pages,
        probes,
        counts
      })
    }
  }

  // 快照稳定性的汇总：任一一页「连采两次不一致」⇒ 该页数据不可信（见 captureStable）
  env.pagesStable = pages.every((p) => p.stable)
  env.pagesUnstableDetail = pages
    .filter((p) => !p.stable)
    .map((p) => ({ page: p.page, unstablePaths: p.unstablePaths.slice(0, 8) }))
  return { viewport: { w: window.innerWidth, h: window.innerHeight }, env, pages, probes, counts }
}
