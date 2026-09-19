/**
 * i18n 契约测试（源级）。
 *
 * 背景：`LanguageContext.t(key)` 的契约是「zh 原样返回 key，其它语言查词典」。
 * 因此**任何没有经过 `t()` 的中文字面量，在非 zh 语言下都会原样显示中文**
 * —— 真机表现就是「标题英文、按钮中文」的中英混排（安卓首版实测）。
 *
 * 本契约对 `src/` 与 `mobile/` 下的全部非测试源码逐字符扫描，命中下列任一即 fail：
 *   1. 代码位置出现裸中日韩字符（典型：JSX 文本 `>个人中心<`、未包 t() 的字符串）
 *   2. 字符串/模板文本包含中日韩字符，但该字面量不属于 `t()` / `T()` / `tr()` 的实参
 * 并打印 `文件:行号: 片段` 清单。
 *
 * 豁免：注释（含 JSX 注释）与正则字面量（不是用户可见文案）、`console.*` 的实参（开发者日志）、
 * 以及 `WHITELIST_FILES` 中逐条写明理由的例外文件。
 *
 * 防止「零约束但全绿」：清单非空 + 白名单文件真实存在 + 词典覆盖所有 `t()` 字面 key。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..', '..')

/** 中日韩字符（含假名、全角标点）：出现即代表该片段面向中文用户 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/

/** 语言解析函数名：这些调用的中文实参由语言层处理 */
const ROUTED_CALLS = new Set(['t', 'T', 'tr'])

/**
 * `/` 前出现这些字符时按正则字面量处理（而非除号）。
 * 刻意不含 `>` `}` `<`：JSX 的 `</div>` 与 `<Icon size={16} />` 会让 `/` 紧跟在这些字符之后，
 * 误判成正则会把后续整段源码「吞掉」，导致引号配对错位（本门禁第一版即踩此坑）。
 */
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?'])
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'instanceof', 'new', 'do', 'else', 'yield', 'await'])

/**
 * 允许长期保留中文的例外清单（每条都必须给出理由）。
 * 其余任何文件出现未路由中文一律 fail —— 不要为了「让它绿」往这里加文件。
 */
const WHITELIST_FILES: Record<string, string> = {
  'src/i18n/translations.ts': '词典本体：中文原文就是 key',
  'src/utils/errorMessages.ts': '错误关键字表，自带 zh/en 双语文案（KEYWORD_MAP）',
  'src/data/categories.ts': '预设分类名是持久化在 SQLite 里的数据，不是 UI 文案',
  'src/data/incomeCategories.ts': '同上',
  'src/data/recurringOptions.ts': '周期支出快选选项与默认分类是持久化在 SQLite 里的数据（与预设分类同理），展示层经 t() 翻译',
  'src/utils/settings.ts': 'TIMEZONE_OPTIONS.label 即词典 key，渲染处由 SettingsDialog 的 t(opt.label) 解析',
  'mobile/bridge/android-storage.ts': '内部诊断错误（StoragePort 一致性守卫），经 friendlyError 收敛，不直接上屏',
  'mobile/bridge/android-adapter.ts': '同上；createShortcut 的降级返回在 src/ 内零调用'
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const toRel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/')

/** 从文件系统派生待检清单：新增源码文件自动纳入约束 */
const FILES = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'mobile'))]
  .map(toRel)
  .filter((rel) => !(rel in WHITELIST_FILES))
  .sort()

interface Frame {
  type: 'code' | 'tpl' | 'lineComment' | 'blockComment'
  /** 模板字面量：进入时其所属调用是否已路由 / 是否属于 console 日志 */
  routed: boolean
  isConsole: boolean
  /** 代码帧状态：花括号深度、是否为 `${}` 插值帧、括号深度、活动调用栈、标识符 token 与成员链 */
  braces: number
  interp: boolean
  depth: number
  calls: Array<{ name: string; depth: number }>
  token: string
  lastToken: string
  chain: string
  prevSig: string
}

const newCodeFrame = (interp = false): Frame => ({
  type: 'code',
  routed: false,
  isConsole: false,
  braces: 0,
  interp,
  depth: 0,
  calls: [],
  token: '',
  lastToken: '',
  chain: '',
  prevSig: ''
})

interface ScanResult {
  /** 未路由的中文位置（`行号: 片段`） */
  violations: string[]
  /** 经 t() 路由的字面中文 key（用于词典完整性校验） */
  routedKeys: Set<string>
}

/** 逐字符扫描一个源文件：注释/正则跳过，字符串与裸字符分别判定 */
function scanSource(text: string): ScanResult {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  const lineText = text.split(/\r?\n/)
  const lineOf = (pos: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  const violations: string[] = []
  const routedKeys = new Set<string>()
  const stack: Frame[] = [newCodeFrame()]

  const reported = new Set<number>()
  const report = (pos: number) => {
    const line = lineOf(pos)
    if (reported.has(line)) return // 同一行多处漏翻只报一次
    reported.add(line)
    violations.push(`${line}: ${lineText[line - 1].trim().slice(0, 110)}`)
  }
  const innermostCall = (frame: Frame) => frame.calls[frame.calls.length - 1]?.name

  const readStringEnd = (start: number, quote: string) => {
    let i = start + 1
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === quote) return i + 1
      if (text[i] === '\n') return i
      i++
    }
    return text.length
  }

  const readRegexEnd = (start: number) => {
    let i = start + 1
    let inClass = false
    while (i < text.length) {
      const c = text[i]
      if (c === '\\') { i += 2; continue }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) { i++; break }
      else if (c === '\n') break
      i++
    }
    while (i < text.length && /[a-z]/.test(text[i])) i++
    return i
  }

  let i = 0
  while (i < text.length) {
    const frame = stack[stack.length - 1]
    const c = text[i]

    if (frame.type === 'lineComment') {
      if (c === '\n') stack.pop()
      i++
      continue
    }
    if (frame.type === 'blockComment') {
      if (c === '*' && text[i + 1] === '/') { stack.pop(); i += 2; continue }
      i++
      continue
    }
    if (frame.type === 'tpl') {
      if (c === '\\') { i += 2; continue }
      if (c === '`') { stack.pop(); i++; continue }
      if (c === '$' && text[i + 1] === '{') { stack.push(newCodeFrame(true)); i += 2; continue }
      if (CJK.test(c) && !frame.routed && !frame.isConsole) report(i)
      i++
      continue
    }

    // ── code 帧 ──
    if (c === '/' && text[i + 1] === '/') { stack.push({ ...newCodeFrame(), type: 'lineComment' }); i += 2; continue }
    if (c === '/' && text[i + 1] === '*') { stack.push({ ...newCodeFrame(), type: 'blockComment' }); i += 2; continue }

    if (c === "'" || c === '"') {
      const end = readStringEnd(i, c)
      const body = text.slice(i + 1, end - 1)
      const callee = innermostCall(frame)
      if (CJK.test(body)) {
        // console.* 是开发者日志，豁免；其余必须命中 t()/T()/tr()
        if (callee === undefined || (!ROUTED_CALLS.has(callee) && !callee.startsWith('console.'))) report(i)
        else if (callee === 't') routedKeys.add(body)
      }
      i = end
      frame.token = ''
      frame.prevSig = c
      continue
    }

    if (c === '`') {
      const callee = innermostCall(frame)
      stack.push({
        ...newCodeFrame(),
        type: 'tpl',
        routed: callee !== undefined && ROUTED_CALLS.has(callee),
        isConsole: callee !== undefined && callee.startsWith('console.')
      })
      i++
      frame.prevSig = c
      continue
    }

    if (c === '/' && (REGEX_PREV.has(frame.prevSig) || REGEX_KEYWORDS.has(frame.lastToken))) {
      i = readRegexEnd(i)
      frame.prevSig = ')'
      continue
    }

    if (c === '{') {
      frame.braces++
      frame.token = ''
      frame.prevSig = c
      i++
      continue
    }
    if (c === '}') {
      if (frame.braces > 0) frame.braces--
      else if (frame.interp) { stack.pop(); i++; continue }
      frame.token = ''
      frame.prevSig = c
      i++
      continue
    }

    if (c === '(') {
      frame.depth++
      frame.calls.push({ name: frame.chain + (frame.token || frame.lastToken), depth: frame.depth })
      frame.chain = ''
      frame.token = ''
      frame.prevSig = c
      i++
      continue
    }
    if (c === ')') {
      for (let k = frame.calls.length - 1; k >= 0; k--) {
        if (frame.calls[k].depth === frame.depth) frame.calls.splice(k, 1)
      }
      frame.depth--
      frame.token = ''
      frame.prevSig = c
      i++
      continue
    }
    if (c === '.') {
      if (frame.token) { frame.chain += `${frame.token}.`; frame.lastToken = frame.token; frame.token = '' }
      frame.prevSig = c
      i++
      continue
    }

    if (/[A-Za-z0-9_$]/.test(c)) { frame.token += c; frame.prevSig = c; i++; continue }

    if (CJK.test(c)) report(i) // 裸中文出现在代码位置（典型：JSX 文本节点）

    if (!/\s/.test(c)) frame.prevSig = c
    if (frame.token) frame.lastToken = frame.token
    frame.token = ''
    frame.chain = ''
    i++
  }

  return { violations, routedKeys }
}

const ALL_VIOLATIONS: string[] = []
const ALL_ROUTED_KEYS = new Set<string>()

for (const file of FILES) {
  const { violations, routedKeys } = scanSource(readFileSync(path.join(ROOT, file), 'utf8'))
  for (const v of violations) ALL_VIOLATIONS.push(`${file}:${v}`)
  for (const k of routedKeys) ALL_ROUTED_KEYS.add(k)
}

/** translations.ts 中已登记的 key */
const DICT_KEYS = (() => {
  const src = readFileSync(path.join(ROOT, 'src/i18n/translations.ts'), 'utf8')
  const keys = new Set<string>()
  for (const m of src.matchAll(/^\s{2}(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*:/gm)) {
    keys.add(m[1] ?? m[2])
  }
  return keys
})()

describe('i18n 契约派生保底', () => {
  it('待检清单应非空且覆盖关键页面', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(30)
    expect(FILES).toContain('src/pages/Profile.tsx')
    expect(FILES).toContain('src/components/Layout.tsx')
    expect(FILES).toContain('mobile/main.tsx')
  })

  it('白名单文件应真实存在（避免改名后豁免静默失效）', () => {
    for (const rel of Object.keys(WHITELIST_FILES)) {
      expect(statSync(path.join(ROOT, rel)).isFile(), rel).toBe(true)
    }
  })
})

describe('i18n 契约：用户可见中文必须经 t() 路由', () => {
  it('src/ 与 mobile/ 下不存在未路由的中文（清单为空）', () => {
    expect(ALL_VIOLATIONS).toEqual([])
  })
})

describe('i18n 契约：词典覆盖全部 t() 字面 key', () => {
  it("每次 t('中文') 都能在 translations.ts 命中，不回退成中文", () => {
    const missing = [...ALL_ROUTED_KEYS].filter((k) => !DICT_KEYS.has(k)).sort()
    expect(missing).toEqual([])
  })

  it('词典与调用点均非空（防止扫描失效导致「零约束但全绿」）', () => {
    expect(DICT_KEYS.size).toBeGreaterThanOrEqual(300)
    expect(ALL_ROUTED_KEYS.size).toBeGreaterThanOrEqual(150)
  })
})
