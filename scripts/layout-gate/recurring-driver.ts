/**
 * 周期支出/记一笔 弹窗版式门禁 —— 浏览器侧驱动器。
 *
 * 覆盖的缺陷（全部来自 2026-09-19 的用户截图，不靠肉眼验收）：
 *   R1 周期规则弹窗的**宽度骨架**（缺 width 规则 ⇒ 弹窗按内容塌缩成窄条）
 *   R2/R3 周期支出表单只呈现订阅字段，不包含定投入口，并提供完整两级支出分类
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

  // R2：周期规则只保留订阅服务字段，分类使用与单笔支出相同的两级选择器。
  const dcaUi = /定投|交易日/.test(dialog.textContent || '')
  const recurringCategories = ['#recurring-form-category1', '#recurring-form-category2']
    .map((selector) => dialog.querySelector(selector))
  checks.push({
    id: 'R2',
    title: '周期规则仅呈现订阅，并包含两级分类选择器',
    pass: !dcaUi && recurringCategories.every(Boolean),
    actual: `定投/交易日界面=${dcaUi}；一级分类=${!!recurringCategories[0]}；二级分类=${!!recurringCategories[1]}`,
    threshold: '无定投/交易日 UI；存在一级与二级分类输入'
  })

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

  // R3：记一笔中的周期模块复用相同订阅表单和两级支出分类。
  const addBillDcaUi = /定投|交易日/.test(dialog.textContent || '')
  const addBillCategories = ['#add-bill-rec-category1', '#add-bill-rec-category2']
    .map((selector) => dialog.querySelector(selector))
  checks.push({
    id: 'R3',
    title: '记一笔周期模块仅呈现订阅，并包含两级分类选择器',
    pass: !addBillDcaUi && addBillCategories.every(Boolean),
    actual: `定投/交易日界面=${addBillDcaUi}；一级分类=${!!addBillCategories[0]}；二级分类=${!!addBillCategories[1]}`,
    threshold: '无定投/交易日 UI；存在一级与二级分类输入'
  })

  const body = dialog.querySelector<HTMLElement>('div.space-y-4') ?? dialog
  const ov = overflowOf(body)
  checks.push({
    id: 'R6',
    title: '记一笔（周期模块）内容区无横向溢出',
    pass: ov.scrollWidth <= ov.clientWidth + 1,
    actual: `scrollWidth ${ov.scrollWidth} / clientWidth ${ov.clientWidth}`,
    threshold: 'scrollWidth ≤ clientWidth + 1'
  })

  // R9 校验反馈（v2.0.5 口径：**只**要字段级红字 + toast，不要底部汇总条；用户明确要求去掉它）
  const nameInput = dialog.querySelector<HTMLInputElement>('#add-bill-rec-name')
  const submitBtn = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (nameInput) typeInto(nameInput, '')
  await sleep(50)
  submitBtn?.click()
  await sleep(350)
  const nameInvalid = nameInput?.getAttribute('aria-invalid') === 'true'
  const fieldLevel = !!dialog.querySelector('#add-bill-rec-name-error')
  const toastShown = !!document.querySelector('[data-testid="toast-container"], .toast-container')
    || Array.from(document.querySelectorAll('div')).some((d) => (d.textContent || '').trim() === '请填写名称' && d.closest('[class*="toast"], [data-testid]') !== null)
  const summaryAbsent = !dialog.querySelector('#add-bill-dialog-error')
  checks.push({
    id: 'R9',
    title: '漏填时：字段级红字 + aria-invalid + toast，且**不存在**底部汇总条',
    pass: nameInvalid && fieldLevel && summaryAbsent,
    actual: `aria-invalid=${nameInvalid}、字段级提示=${fieldLevel}、底部汇总条存在=${!summaryAbsent}（toast=${toastShown}）`,
    threshold: '前两者成立且底部汇总条不存在（v2.0.5 用户要求：字段下方有红字就够了）'
  })

  // R10：投资定投专用字段必须退出周期支出表单。
  const symbolInput = dialog.querySelector<HTMLInputElement>('#add-bill-rec-symbol')
  checks.push({
    id: 'R10',
    title: '周期支出表单不包含投资标的代码字段',
    pass: !symbolInput && !addBillDcaUi,
    actual: `标的代码字段=${!!symbolInput}；定投/交易日界面=${addBillDcaUi}`,
    threshold: '投资定投字段与入口均不存在'
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
