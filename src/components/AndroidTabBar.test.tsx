/**
 * 安卓底部导航（P2-1 方案 B：4 Tab + 中央凸起「记一笔」）。
 *
 * 该组件只在 `isAndroid()` 为真时由 Layout 挂载，所以这里直接单测组件本身：
 * 4 个 Tab 的导航语义、当前页指示（顶部金棕线 + aria-current）、FAB 走 `openAddDialog()`。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AndroidTabBar } from './AndroidTabBar'
import { useStore } from '@/store'

describe('AndroidTabBar', () => {
  beforeEach(() => {
    useStore.setState({ activePage: 'home', toasts: [] })
  })

  it('渲染 4 个 Tab + 1 个中央 FAB', () => {
    render(<AndroidTabBar />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
    for (const label of ['首页', '账单', '统计', '我的']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('是底部导航语义（nav + 可访问名称）', () => {
    render(<AndroidTabBar />)
    expect(screen.getByRole('navigation', { name: '底部导航' })).toHaveClass('android-tabbar')
  })

  it('点击 Tab 切换页面', () => {
    const spy = vi.spyOn(useStore.getState(), 'setActivePage')
    render(<AndroidTabBar />)
    fireEvent.click(screen.getByRole('button', { name: '账单' }))
    expect(spy).toHaveBeenCalledWith('bills')
    spy.mockRestore()
  })

  it('FAB 触发 openAddDialog（不新增宿主能力）', () => {
    const spy = vi.spyOn(useStore.getState(), 'openAddDialog')
    render(<AndroidTabBar />)
    fireEvent.click(screen.getByRole('button', { name: '记一笔' }))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('当前页指示：仅当前 Tab 带 android-tab-active + aria-current', () => {
    useStore.setState({ activePage: 'bills' })
    render(<AndroidTabBar />)
    const bills = screen.getByRole('button', { name: '账单' })
    expect(bills).toHaveClass('android-tab-active')
    expect(bills).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '统计' })).not.toHaveClass('android-tab-active')
    expect(screen.getByRole('button', { name: '统计' })).not.toHaveAttribute('aria-current')
  })

  it('「分类管理」归入「我的」：activePage=categories 时高亮我的', () => {
    useStore.setState({ activePage: 'categories' })
    render(<AndroidTabBar />)
    expect(screen.getByRole('button', { name: '我的' })).toHaveClass('android-tab-active')
  })

  it('FAB 不渲染「记一笔」文本节点（避免与顶栏按钮重名，破坏桌面测试选择器）', () => {
    render(<AndroidTabBar />)
    // 文本只出现在 Tab 标签上；FAB 仅有 aria-label
    expect(screen.queryByText('记一笔')).not.toBeInTheDocument()
  })
})
