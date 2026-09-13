/**
 * 分类管理「编辑模式」+ 指针拖拽 + 删除二次确认（P2-3）。
 *
 * 为什么必须单测：
 * - Android WebView **基本不支持 HTML5 DnD**，所以触屏排序改用 Pointer Events；
 *   这类实现在 jsdom 里不会自己暴露问题，必须显式驱动 pointerdown/move/up。
 * - 普通模式必须**没有**拖动与删除入口（用户定稿），编辑模式才有 —— 这是产品语义，不是样式。
 * - 删除必须二次确认，且要说明「账单不会被删除，只会变成未分类」。
 *
 * 门控方式：给 `<html>` 加 `platform-android`（`isAndroid()` 的运行时来源）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CategoryManager } from './CategoryManager'
import { useStore } from '@/store'
import { ANDROID_PLATFORM_CLASS } from '@/platform'

const setAndroid = (on: boolean) => {
  document.documentElement.classList.toggle(ANDROID_PLATFORM_CLASS, on)
}

const rows = [
  { id: 11, name: '餐饮食品', icon: '🍜', children: '["午餐"]', type: 'expense', is_preset: 1 },
  { id: 22, name: '交通出行', icon: '🚌', children: '["公交"]', type: 'expense', is_preset: 0 }
]

/** 给每行可命中的几何：索引 i → [i*44, i*44+44]（jsdom 默认全 0，无法体现落位计算） */
const realGetBoundingClientRect = Element.prototype.getBoundingClientRect
const stubRowGeometry = () => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const raw = this.getAttribute?.('data-cat-index')
    const idx = raw === null || raw === undefined ? -1 : Number(raw)
    const top = idx < 0 ? 0 : idx * 44
    return {
      top, bottom: top + 44, height: 44, left: 0, right: 240, width: 240, x: 0, y: top,
      toJSON: () => ({})
    } as DOMRect
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('CategoryManager 编辑模式（P2-3）', () => {
  const reorderCategories = vi.fn().mockResolvedValue(undefined)
  const deleteCategory = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    setAndroid(false)
    stubRowGeometry()
    useStore.setState({
      expenseCategories: [
        { name: '餐饮食品', icon: '🍜', children: ['午餐'] },
        { name: '交通出行', icon: '🚌', children: ['公交'] }
      ],
      incomeCategories: [],
      refreshCategories: vi.fn().mockResolvedValue(undefined)
    })
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      getCategories: vi.fn().mockResolvedValue(rows),
      addCategory: vi.fn().mockResolvedValue(undefined),
      reorderCategories,
      deleteCategory
    }
    vi.clearAllMocks()
  })

  afterEach(() => {
    setAndroid(false)
    Element.prototype.getBoundingClientRect = realGetBoundingClientRect
  })

  /** 渲染分类管理整页，并等待挂载期的 loadMeta（名称→id 映射）完成 */
  const renderPage = async () => {
    render(<CategoryManager isOpen onClose={() => {}} mode="page" />)
    await act(async () => { await sleep(0) })
  }

  it('桌面：不出现编辑模式开关，删除入口始终在 DOM（原行为不变）', async () => {
    await renderPage()
    expect(screen.queryByRole('button', { name: /编辑模式/ })).not.toBeInTheDocument()
    expect(screen.getAllByTitle('删除此分类')).toHaveLength(2)
    // 桌面仍保留 HTML5 拖拽：整行 draggable
    expect(document.querySelectorAll('[data-cat-row="true"][draggable="true"]')).toHaveLength(2)
  })

  it('安卓 · 普通模式：没有拖动把手，也没有删除入口', async () => {
    setAndroid(true)
    await renderPage()
    expect(screen.queryAllByTitle('删除此分类')).toHaveLength(0)
    expect(screen.queryAllByLabelText('拖动排序')).toHaveLength(0)
    // 行不可拖（避免 WebView 上无效的 HTML5 DnD）
    expect(document.querySelectorAll('[data-cat-row="true"][draggable="true"]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: '进入编辑模式' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('安卓 · 进入编辑模式：把手与删除入口出现', async () => {
    setAndroid(true)
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))

    const handles = screen.getAllByLabelText('拖动排序')
    expect(handles).toHaveLength(2)
    expect(handles[0]).toHaveClass('android-drag-handle')
    const del = screen.getAllByTitle('删除此分类')
    expect(del).toHaveLength(2)
    expect(del[0]).toHaveClass('category-delete-btn')
    expect(screen.getByRole('button', { name: '退出编辑模式' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('删除二次确认：显示子类数量，并说明账单不会被删除', async () => {
    setAndroid(true)
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))
    fireEvent.click(screen.getAllByTitle('删除此分类')[0])

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('餐饮食品')
    expect(dialog).toHaveTextContent('1 个二级分类')
    expect(dialog).toHaveTextContent('已使用该分类的账单不会被删除，只会变为「未分类」')
  })

  it('指针拖拽：长按 150ms 激活 + 落位计算 + pointerup 提交正确顺序', async () => {
    setAndroid(true)
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))

    const handle = screen.getAllByLabelText('拖动排序')[0]
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 20 })
    // 长按阈值前不激活（避免与滚动/点击抢手势）
    expect(handle).toHaveAttribute('data-dragging', 'false')

    await act(async () => { await sleep(200) })
    const dragging = screen.getAllByLabelText('拖动排序')[0]
    expect(dragging).toHaveAttribute('data-dragging', 'true')

    // 移到第二行（几何 stub：index 1 = [44, 88]）
    fireEvent.pointerMove(dragging, { pointerId: 1, clientY: 60 })
    fireEvent.pointerUp(dragging, { pointerId: 1, clientY: 60 })

    await waitFor(() => expect(reorderCategories).toHaveBeenCalledWith([22, 11]))
  })

  it('短按（未达长按阈值）不触发排序提交', async () => {
    setAndroid(true)
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: '进入编辑模式' }))

    const handle = screen.getAllByLabelText('拖动排序')[0]
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 20 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 60 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 60 })
    expect(reorderCategories).not.toHaveBeenCalled()
  })
})
