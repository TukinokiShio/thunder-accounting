/**
 * Bills 错误态端到端测试（**故意不 mock `@/store`**）。
 *
 * 为什么单独一个文件：`Bills.test.tsx` 把 `@/store` 整体替身成 `(selector) => selector(storeState)`，
 * 因此它只能证明「UI 会跟随某个 state 字段变化」，证明不了「`getBills` 抛错 → store 记录失败 →
 * UI 呈现错误态」这条链 —— 而这条链正是本次修复的对象。这里用**真实 store**（只 mock 宿主
 * `electronAPI` 与平台判定）把链走完。
 *
 * 覆盖：
 * 1. 窄屏：`getBills` 抛错时必须渲染错误态 + 重试入口，且**不得**把「读取失败」伪装成「还没有账单记录」。
 * 2. 窄屏：恢复后点「重试」应渲染真实数据，并清空失败记录（否则一次失败会永久停在错误态）。
 * 3. 桌面：同一失败条件下渲染路径不变（错误态只在窄屏分支渲染）—— 锁住「桌面零变化」。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Bills } from './Bills'
import { useStore } from '@/store'
import type { Bill } from '@/types'

let androidLayout = true

vi.mock('@/platform', () => ({
  isAndroid: () => androidLayout,
}))

vi.mock('@/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'zh',
    setLanguage: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const BILL: Bill = {
  id: 1,
  date: '2026-07-27',
  type: 'expense',
  amount: 58.5,
  category1: '餐饮',
  category2: '午餐',
  note: '',
  created_at: '2026-07-27',
}

/** 只替身宿主 API；store 用真实的 */
function stubGetBills(impl: () => Promise<Bill[]>) {
  ;(window as any).electronAPI = {
    getBills: vi.fn(impl),
    deleteBill: vi.fn().mockResolvedValue(undefined),
  }
}

const FAILING = () => Promise.reject(new Error('db read failed'))

let errorSpy: MockInstance

beforeEach(() => {
  androidLayout = true
  // store 的 catch 会 console.error（这是设计的一部分，下面会断言它确实被调用）；
  // 这里静音以免污染测试输出。
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useStore.setState({
    bills: [],
    billsError: null,
    filterCategory1: '',
    filterMonth: '',
    filterDateRange: null,
    filterType: '',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Bills 错误态（真实 store，全链路）', () => {
  it('窄屏：getBills 抛错时必须渲染错误态与重试入口，而不是「还没有账单记录」', async () => {
    stubGetBills(FAILING)
    render(<Bills />)

    // 核心断言：错误态 UI 真的渲染出来（不是断言 store 里有错误字符串）
    expect(await screen.findByText('加载失败，请重试')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()

    // 且不能把「读取失败」伪装成「没有数据」
    expect(screen.queryByText('还没有账单记录')).toBeNull()
    expect(screen.queryByText('点击右上角"记一笔"开始记账')).toBeNull()

    // 同时 store 确实记录了失败原因（供上层/诊断使用），且失败没有被静默吞掉
    expect(useStore.getState().billsError).toBe('db read failed')
    expect(errorSpy).toHaveBeenCalledWith('Failed to refresh bills:', expect.any(Error))
  })

  it('窄屏：恢复后点「重试」渲染真实数据，并清空失败记录', async () => {
    stubGetBills(FAILING)
    render(<Bills />)
    await screen.findByText('加载失败，请重试')

    // 第二次拉取成功
    ;(window as any).electronAPI.getBills = vi.fn().mockResolvedValue([BILL])
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('餐饮 · 午餐')).toBeInTheDocument()
    expect(screen.queryByText('加载失败，请重试')).toBeNull()
    expect(useStore.getState().billsError).toBeNull()
    expect((window as any).electronAPI.getBills).toHaveBeenCalledTimes(1)
  })

  it('桌面：同样的失败条件下渲染路径不变（错误态只在窄屏分支渲染）', async () => {
    androidLayout = false
    stubGetBills(FAILING)
    render(<Bills />)
    await act(async () => {})

    expect(screen.getByText('还没有账单记录')).toBeInTheDocument()
    expect(screen.queryByText('加载失败，请重试')).toBeNull()
  })
})
