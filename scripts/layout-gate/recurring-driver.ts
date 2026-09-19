/**
 * 周期支出/记一笔 弹窗版式门禁 —— 浏览器侧驱动器。
 *
 * 覆盖的缺陷（全部来自 2026-09-19 的用户截图，不靠肉眼验收）：
 *   R1 周期规则弹窗的**宽度骨架**（缺 width 规则 ⇒ 弹窗按内容塌缩成窄条）
 *   R2/R3 定投「仅在交易日执行」复选框**不能被全局 input 规则撑大**
 *        （`.aurora-shell input{width:100%;min-height:42px}` 命中 checkbox ⇒ 巨型方块 + 标签竖排）
 *   R4/R5 支付平台、资金账户**可自由填写**（且快选芯片点一下能把值填进去）
 *   R6/R7 记一笔弹窗内的周期模块同样成立 + 内容区无横向溢出
 *   R8 **负对照自检**：把 `.recurring-form-dialog` 的宽度规则禁掉后必须复现塌缩
 *      —— 否则说明 R1 是「不可能失败」的假断言
 *
 * 量测纪律：一律用「文本/角色定位 + 计算样式」，不依赖 class 名（class 会漂移）。
 */
import { sleep, waitFor } from './recurring-utils'

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

declare const __GATE_EXPECT__: {
  dialogWidth: number
  minDialogWidth: number
  maxCheckboxPx: number
  minChips: number
}

function thresholds() {
  if (typeof __GATE_EXPECT__ !== 'object' || __GATE_EXPECT__ === null) {
    throw new Error('__GATE_EXPECT__ 未注入：门禁阈值缺失（探针页必须由 verify-recurring-dialog.cjs 构建）')
  }
  return __GATE_EXPECT__
}

/* ───────────────────────── 定位工具 ───────────────────────── */

/** 按标题文本找 dialog（不依赖 class） */
function dialogByTitle(title: string): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
  return dialogs.find((d) => (d.textContent || '').includes(title)) ?? null
}

function rectOf(el: HTMLElement): DOMRect {
  return el.getBoundingClientRect()
}

/** 在给定根节点内，按标签文本找到其后的可输入控件 */
function inputByLabel(root: HTMLElement, labelText: string): HTMLInputElement | null {
  const labels = Array.from(root.querySelectorAll<HTMLLabelElement>('label, span, p'))
  const hit = labels.find((l) => {
    const own = (l.textContent || '').replace(/\s+/g, '')
    return own.includes(labelText.replace(/\s+/g, ''))
  })
  if (!hit) return null
  const container = hit.closest('div') ?? hit.parentElement
  const input = container?.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')
  return input ?? root.querySelector<HTMLInputElement>(`#${hit.getAttribute('for')}`)
}

/** 找到某标签下方的快选芯片（button）。
 *  ⚠ 作用域必须收在**字段自身容器**内：早期版本用 `input.closest('div').parentElement`，
 *  把「类型（订阅/定投）」「周期单位」等同样带 aria-pressed 的按钮一并算进来（实测 21 个），
 *  于是"首个芯片"点到了「订阅」→ 假红。现在只认输入框的同级容器里的 aria-pressed 按钮。 */
function chipsNear(root: HTMLElement, labelText: string): HTMLButtonElement[] {
  const input = inputByLabel(root, labelText)
  if (!input) return []
  const wrapper = input.parentElement
  if (!wrapper) return []
  return Array.from(wrapper.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
}

/** 点击弹窗内文本匹配的按钮（按 trim 后的完整文本） */
async function clickButtonByText(dialog: HTMLElement, text: string): Promise<boolean> {
  const btn = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => (b.textContent || '').trim() === text)
  if (!btn) return false
  btn.click()
  await sleep(180)
  return true
}

/** 用原生 setter 触发 React onChange（模拟用户逐字输入） */
function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 找一个可横向裁剪的祖先（overflowX ≠ visible） */
function overflowOf(el: HTMLElement): { scrollWidth: number; clientWidth: number } {
  const cs = getComputedStyle(el)
  return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth || 1 }
}

/* ───────────────────────── 断言 ───────────────────────── */

async function checkRecurringDialog(EXPECT: ReturnType<typeof thresholds>): Promise<GateCheck[]> {
  const checks: GateCheck[] = []
  window.__gate?.setRecurringOpen(true)
  const dialog = await waitFor(() => dialogByTitle('新增周期支出'), 4000)
  if (!dialog) {
    checks.push({ id: 'R1', title: '周期规则弹窗可渲染', pass: false, actual: '未找到标题含「新增周期支出」的 [role=dialog]', threshold: '存在' })
    return checks
  }

  const w = rectOf(dialog).width
  checks.push({
    id: 'R1',
    title: '周期规则弹窗宽度 = 30rem 骨架（不随内容塌缩）',
    pass: Math.abs(w - EXPECT.dialogWidth) <= 2,
    actual: `实测宽度 ${w.toFixed(1)}px`,
    threshold: `${EXPECT.dialogWidth}±2px（30rem @ rootFont 16px）`
  })

  // R8 负对照：禁掉宽度规则后必须塌缩（证明 R1 能失败）
  const style = document.createElement('style')
  style.textContent = '.aurora-shell .recurring-form-dialog { width: auto !important; max-width: none !important; }'
  document.head.appendChild(style)
  await sleep(60)
  const collapsed = rectOf(dialog).width
  style.remove()
  await sleep(60)
  const restored = rectOf(dialog).width
  checks.push({
    id: 'R8',
    title: '负对照：禁掉宽度规则必须复现塌缩（否则 R1 是不可能失败的假断言）',
    pass: collapsed < EXPECT.minDialogWidth && Math.abs(restored - EXPECT.dialogWidth) <= 2,
    actual: `禁用后 ${collapsed.toFixed(1)}px → 移除后 ${restored.toFixed(1)}px`,
    threshold: `禁用后 < ${EXPECT.minDialogWidth}px，移除后回到 ${EXPECT.dialogWidth}±2px`
  })

  // R2 复选框尺寸（全局 input 规则回归的哨兵）。
  // ⚠ 必须先切到「定投」：交易日期选项只对定投渲染（订阅类型下本就不该有这个复选框）。
  const switchedToDca = await clickButtonByText(dialog, '定投')
  const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!switchedToDca) {
    checks.push({ id: 'R2', title: '周期规则弹窗：切到「定投」', pass: false, actual: '未找到文本为「定投」的类型按钮', threshold: '存在' })
  } else if (!checkbox) {
    checks.push({ id: 'R2', title: '定投复选框存在', pass: false, actual: '切到定投后仍未找到 input[type=checkbox]', threshold: '存在' })
  } else {
    const r = rectOf(checkbox)
    checks.push({
      id: 'R2',
      title: '「仅在交易日执行」复选框尺寸正常（不被全局 input 规则撑大）',
      pass: r.width <= EXPECT.maxCheckboxPx && r.height <= EXPECT.maxCheckboxPx,
      actual: `复选框 ${r.width.toFixed(1)}×${r.height.toFixed(1)}px`,
      threshold: `宽高均 ≤ ${EXPECT.maxCheckboxPx}px`
    })
  }

  // R4 支付平台可输入
  const platformInput = inputByLabel(dialog, '支付平台')
  if (!platformInput) {
    checks.push({ id: 'R4', title: '支付平台可自由输入', pass: false, actual: '未找到支付平台输入框', threshold: '存在 type=text 的输入框' })
  } else {
    typeInto(platformInput, '某银行联名卡')
    await sleep(50)
    checks.push({
      id: 'R4',
      title: '支付平台可自由输入（非只读/非只能选）',
      pass: platformInput.value === '某银行联名卡' && !platformInput.readOnly && !platformInput.disabled,
      actual: `输入后 value=${JSON.stringify(platformInput.value)}，readOnly=${platformInput.readOnly}`,
      threshold: '输入的回显与输入一致、且非只读'
    })
  }

  // R5 资金账户：快选芯片点一下要能填进去
  const accountChips = chipsNear(dialog, '资金账户')
  const accountInput = inputByLabel(dialog, '资金账户')
  let chipOk = false
  let chipDetail = '未找到芯片'
  if (accountInput && accountChips.length > 0) {
    const chip = accountChips[0]
    chip.click()
    await sleep(60)
    chipOk = accountInput.value === (chip.textContent || '').trim()
    chipDetail = `点击芯片「${(chip.textContent || '').trim()}」→ value=${JSON.stringify(accountInput.value)}`
  }
  checks.push({
    id: 'R5',
    title: '资金账户：快选芯片可一键填入（且输入框本身可写）',
    pass: accountChips.length >= EXPECT.minChips && chipOk,
    actual: `芯片数 ${accountChips.length}；${chipDetail}`,
    threshold: `芯片 ≥ ${EXPECT.minChips} 个，点击首个后输入框值 = 芯片文本`
  })

  // R7 无横向溢出（内容区不得被裁）
  const content = dialog.querySelector<HTMLElement>('div.space-y-4') ?? dialog
  const ov = overflowOf(content)
  checks.push({
    id: 'R7',
    title: '周期规则弹窗内容区无横向溢出',
    pass: ov.scrollWidth <= ov.clientWidth + 1,
    actual: `scrollWidth ${ov.scrollWidth} / clientWidth ${ov.clientWidth}`,
    threshold: 'scrollWidth ≤ clientWidth + 1'
  })

  return checks
}

async function checkAddBillDialog(EXPECT: ReturnType<typeof thresholds>): Promise<GateCheck[]> {
  const checks: GateCheck[] = []
  window.__gate?.setRecurringOpen(false)
  await sleep(120)
  window.__gate?.openAddBill()

  const dialog = await waitFor(() => dialogByTitle('记一笔'), 4000)
  if (!dialog) {
    checks.push({ id: 'R3', title: '记一笔弹窗可渲染', pass: false, actual: '未找到标题含「记一笔」的 [role=dialog]', threshold: '存在' })
    return checks
  }

  // 切到「周期支出」模块（支出为默认类型，模块切换可见）
  const moduleBtn = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => (b.textContent || '').trim() === '周期支出')
  if (!moduleBtn) {
    checks.push({ id: 'R3', title: '记一笔 → 周期支出模块入口存在', pass: false, actual: '未找到文本为「周期支出」的按钮', threshold: '存在' })
    return checks
  }
  moduleBtn.click()
  await sleep(200)

  // 同样先切到「定投」：交易日复选框只对定投渲染
  const dcaOk = await clickButtonByText(dialog, '定投')
  const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!dcaOk) {
    checks.push({ id: 'R3', title: '记一笔（周期模块）：切到「定投」', pass: false, actual: '未找到「定投」类型按钮', threshold: '存在' })
  } else if (!checkbox) {
    checks.push({ id: 'R3', title: '记一笔（周期模块）复选框存在', pass: false, actual: '切到定投后仍未找到 input[type=checkbox]', threshold: '存在' })
  } else {
    const r = rectOf(checkbox)
    const labelText = (checkbox.closest('div')?.textContent || '').replace(/\s+/g, '')
    // 竖排文字的判据：承载标签文字的那个容器宽度必须够（≥ 120px），否则说明被挤成竖排
    const labelHost = Array.from(dialog.querySelectorAll<HTMLElement>('label'))
      .find((l) => (l.textContent || '').includes('交易日'))
    const hostWidth = labelHost ? rectOf(labelHost).width : 0
    checks.push({
      id: 'R3',
      title: '记一笔（周期模块）复选框尺寸正常 + 标签未被挤成竖排',
      pass: r.width <= EXPECT.maxCheckboxPx && r.height <= EXPECT.maxCheckboxPx && hostWidth >= 120,
      actual: `复选框 ${r.width.toFixed(1)}×${r.height.toFixed(1)}px；标签宽 ${hostWidth.toFixed(1)}px（文本 ${labelText.slice(0, 20)}…）`,
      threshold: `复选框 ≤ ${EXPECT.maxCheckboxPx}px；标签宽 ≥ 120px`
    })
  }

  const body = dialog.querySelector<HTMLElement>('div.space-y-4') ?? dialog
  const ov = overflowOf(body)
  checks.push({
    id: 'R6',
    title: '记一笔（周期模块）内容区无横向溢出',
    pass: ov.scrollWidth <= ov.clientWidth + 1,
    actual: `scrollWidth ${ov.scrollWidth} / clientWidth ${ov.clientWidth}`,
    threshold: 'scrollWidth ≤ clientWidth + 1'
  })

  // R9 校验反馈可见性（v2.0.4 缺陷：保存不了但没有任何提示）
  // 判据按「可达性」标准：提示不仅要在 DOM 里，还要**在视口内**（用户没滚到底也得看见）
  const nameInput = dialog.querySelector<HTMLInputElement>('#add-bill-rec-name')
  const submitBtn = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (nameInput) typeInto(nameInput, '')
  await sleep(50)
  submitBtn?.click()
  await sleep(300)
  const summary = dialog.querySelector<HTMLElement>('#add-bill-dialog-error')
  const sr = summary?.getBoundingClientRect() ?? null
  const summaryInViewport =
    !!sr && sr.width >= 1 && sr.height >= 1 && sr.top >= 0 && sr.bottom <= window.innerHeight && sr.left >= 0 && sr.right <= window.innerWidth
  const nameInvalid = nameInput?.getAttribute('aria-invalid') === 'true'
  const fieldLevel = !!dialog.querySelector('#add-bill-rec-name-error')
  checks.push({
    id: 'R9',
    title: '漏填时校验反馈可见：汇总提示在视口内 + 字段级红字 + aria-invalid',
    pass: summaryInViewport && nameInvalid && fieldLevel,
    actual: `汇总区在视口内=${summaryInViewport}（rect=${sr ? `${sr.top.toFixed(0)}~${sr.bottom.toFixed(0)}px` : 'null'}）、aria-invalid=${nameInvalid}、字段级提示=${fieldLevel}`,
    threshold: '三者同时成立（只看"存在"会漏掉"藏在滚动区底部看不见"）'
  })

  // R10 定投标的代码字段（v2.0.4）：可自由输入
  const symbolInput = dialog.querySelector<HTMLInputElement>('#add-bill-rec-symbol')
  let symbolOk = false
  if (symbolInput) {
    typeInto(symbolInput, '040046')
    await sleep(50)
    symbolOk = symbolInput.value === '040046'
  }
  checks.push({
    id: 'R10',
    title: '定投「代码」字段存在且可自由输入',
    pass: !!symbolInput && symbolOk,
    actual: symbolInput ? `输入 040046 后 value=${JSON.stringify(symbolInput.value)}` : '未找到 #add-bill-rec-symbol',
    threshold: '存在该输入框且输入回显一致'
  })

  return checks
}

/* ───────────────────────── 入口 ───────────────────────── */

export async function runGate(): Promise<GateReport> {
  const EXPECT = thresholds()
  await sleep(300) // 等首屏渲染与字体

  const checks: GateCheck[] = []
  try {
    checks.push(...(await checkRecurringDialog(EXPECT)))
    checks.push(...(await checkAddBillDialog(EXPECT)))
  } catch (e) {
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      env: {},
      checks,
      fatal: e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }
  }

  const env = {
    rootFontPx: getComputedStyle(document.documentElement).fontSize,
    htmlClass: document.documentElement.className,
    bodyClass: document.body.className
  }

  return { viewport: { w: window.innerWidth, h: window.innerHeight }, env, checks }
}
