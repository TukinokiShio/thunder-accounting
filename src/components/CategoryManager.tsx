/**
 * 分类管理组件。支持 dialog（弹窗）和 page（全页面）两种模式。
 * 左侧为可拖拽排序的分类列表（支出/收入切换），右侧为编辑器：名称、图标、二级分类的增删。
 * 预设分类的名称不可修改，但图标和子分类可调整。
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Settings, Pencil, ArrowLeft } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { modalPortalScope } from '@/utils/modalScope'
import { isAndroid } from '@/platform'
import { ConfirmDialog } from './ConfirmDialog'
import { CategoryList } from './CategoryManager/CategoryList'
import { CategoryForm } from './CategoryManager/CategoryForm'

interface Props {
  isOpen: boolean
  onClose: () => void
  mode?: 'dialog' | 'page'
}

export function CategoryManager({ isOpen, onClose, mode = 'dialog' }: Props) {
  const expenseCategories = useStore((s) => s.expenseCategories)
  const incomeCategories = useStore((s) => s.incomeCategories)
  const refreshCategories = useStore((s) => s.refreshCategories)
  const addToast = useStore((s) => s.addToast)
  const { t } = useLanguage()

  const [tab, setTab] = useState<'expense' | 'income'>('expense')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState('📦')
  const [editChildren, setEditChildren] = useState<string[]>([])
  const [newChild, setNewChild] = useState('')
  const [saving, setSaving] = useState(false)

  // ─── 拖拽排序 state ─────────────────────────────────────
  const dragOrderRef = useRef<string[]>([])
  const dragIdxRef = useRef<number | null>(null)
  const nameToIdRef = useRef<Map<string, number>>(new Map())

  // ─── 安卓（P2-3）：编辑模式 + Pointer Events 拖拽 state ──
  // 桌面（`touch === false`）完全不走这条路径：仍用 HTML5 DnD + group-hover 删除按钮。
  const touch = isAndroid()
  const [editMode, setEditMode] = useState(false)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null)
  const pressTimerRef = useRef<number | null>(null)
  const pointerActiveRef = useRef(false)
  const dragFromRef = useRef<number | null>(null)
  const dragToRef = useRef<number | null>(null)

  const categories = tab === 'expense' ? expenseCategories : incomeCategories

  const [catMeta, setCatMeta] = useState<Array<{ id: number; is_preset: number }>>([])

  const loadMeta = useCallback(async () => {
    try {
      const rows = await window.electronAPI.getCategories(tab)
      const meta = rows.map(r => ({ id: r.id, is_preset: r.is_preset }))
      setCatMeta(meta)
      nameToIdRef.current = new Map(rows.map(r => [r.name, r.id]))
    } catch (e) {
      console.error('Failed to load category meta:', e)
    }
  }, [tab])

  // 挂载/切换 tab 时预加载 name→id 映射。
  // 此前仅在 selectCategory/handleTabChange/handleDragEnd 中更新：若用户打开分类管理
  // 后未选中任何分类直接点列表项 × 删除，nameToIdRef 为空 → get(name) 返回 undefined
  // → 误报「删除失败，请重试」（分类删除操作失败 bug）。
  useEffect(() => {
    loadMeta()
  }, [loadMeta])

  const selectCategory = async (idx: number) => {
    setSelectedId(idx)
    setIsCreating(false)
    const cat = categories[idx]
    if (!cat) return
    setEditName(cat.name)
    setEditIcon(cat.icon)
    setEditChildren([...cat.children])
    await loadMeta()
  }

  const isPreset = selectedId !== null && catMeta[selectedId]?.is_preset === 1

  /** 收集最终的子分类列表：合并 editChildren + 输入框中未添加的 newChild */
  const collectChildren = (): string[] => {
    const list = [...editChildren]
    const pending = newChild.trim()
    if (pending && !list.includes(pending)) {
      list.push(pending)
    }
    return list.map(c => c.trim()).filter(Boolean)
  }

  const handleSave = async () => {
    if (!editName.trim()) {
      addToast('error', t('请输入分类名称'))
      return
    }
    const children = collectChildren()
    if (children.length === 0) {
      addToast('error', t('请至少添加一个二级分类'))
      return
    }
    setSaving(true)
    try {
      if (isCreating) {
        await window.electronAPI.addCategory({
          name: editName.trim(),
          icon: editIcon,
          children,
          type: tab
        })
        addToast('success', t('已新增分类「{name}」').replace('{name}', editName.trim()))
      } else if (selectedId !== null && catMeta[selectedId]) {
        await window.electronAPI.updateCategory(catMeta[selectedId].id, {
          name: editName.trim(),
          icon: editIcon,
          children
        })
        addToast('success', t('已更新分类「{name}」').replace('{name}', editName.trim()))
      } else {
        addToast('error', t('分类信息加载中，请稍后重试'))
        return
      }
      await refreshCategories()
      setSelectedId(null)
      setIsCreating(false)
      resetForm()
    } catch (e) {
      console.error('Failed to save category:', e)
      addToast('error', t('保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  /** 删除确认弹窗：必须展示将一并删除的二级分类数量，并说明账单不会被删除（P2-3） */
  const [deleteConfirm, setDeleteConfirm] = useState<{ name: string; id: number; children: number } | null>(null)

  const handleDelete = async () => {
    if (!deleteConfirm) return
    const { id, name } = deleteConfirm
    setSaving(true)
    setDeleteConfirm(null)
    try {
      await window.electronAPI.deleteCategory(id)
      addToast('success', t('已删除分类「{name}」').replace('{name}', name))
      await refreshCategories()
      setSelectedId(null)
      setIsCreating(false)
      resetForm()
    } catch (e) {
      console.error('Failed to delete category:', e)
      addToast('error', t('删除失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  /** 列表项 × 点击：按名称查找 ID，弹出确认框 */
  const handleListItemDelete = async (idx: number) => {
    const cat = categories[idx]
    if (!cat) return
    let id = nameToIdRef.current.get(cat.name)
    // 兜底：映射未就绪（首次打开未选中分类直接删除）时重新加载再查一次
    if (id === undefined) {
      await loadMeta()
      id = nameToIdRef.current.get(cat.name)
    }
    if (id === undefined) {
      addToast('error', t('删除失败，请重试'))
      return
    }
    setDeleteConfirm({ name: cat.name, id, children: cat.children.length })
  }

  const resetForm = () => {
    setEditName('')
    setEditIcon('📦')
    setEditChildren([])
    setNewChild('')
    setCatMeta([])
  }

  const addChild = () => {
    const trimmed = newChild.trim()
    if (!trimmed) return
    if (editChildren.includes(trimmed)) {
      addToast('error', t('该二级分类已存在'))
      return
    }
    setEditChildren(prev => [...prev, trimmed])
    setNewChild('')
  }

  const removeChild = (name: string) => {
    setEditChildren(prev => prev.filter(c => c !== name))
  }

  // ─── 拖拽排序 ──────────────────────────────────────────

  const handleDragStart = (idx: number) => {
    dragIdxRef.current = idx
    dragOrderRef.current = categories.map(c => c.name)
  }

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    const from = dragIdxRef.current
    if (from === null || from === idx) return
    const names = [...dragOrderRef.current]
    const [moved] = names.splice(from, 1)
    names.splice(idx, 0, moved)
    dragOrderRef.current = names
    dragIdxRef.current = idx
  }

  /** 把名称顺序落库。桌面 HTML5 DnD 与安卓指针拖拽共用同一条路径（落库行为逐字一致）。 */
  const persistOrder = async (names: string[]) => {
    if (names.length === 0) return
    if (nameToIdRef.current.size === 0) await loadMeta()
    let ids = names.map(n => nameToIdRef.current.get(n)).filter((id): id is number => id !== undefined)
    if (ids.length !== names.length) {
      await loadMeta()
      ids = names.map(n => nameToIdRef.current.get(n)).filter((id): id is number => id !== undefined)
    }
    if (ids.length > 0) {
      try {
        await window.electronAPI.reorderCategories(ids)
        await refreshCategories()
        await loadMeta()
      } catch (e) {
        console.error('Failed to save category order:', e)
        addToast('error', t('保存失败，请重试'))
      }
    }
  }

  const handleDragEnd = async () => {
    const names = dragOrderRef.current
    dragIdxRef.current = null
    dragOrderRef.current = []
    await persistOrder(names)
  }

  // ─── 安卓指针拖拽（HTML5 DnD 在 Android WebView 基本不可用） ───────
  // 交互：把手 pointerdown → 长按约 150ms 激活 → setPointerCapture → pointermove 计算落位
  //      → pointerup 提交。「长按再拖」避免与列表滚动/点击选分类抢手势。

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }

  // 卸载时清掉未触发的长按定时器，避免离开页面后仍 setState
  useEffect(() => () => { clearPressTimer() }, [])

  const handleHandlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, idx: number) => {
    if (!touch || !editMode) return
    e.preventDefault() // 抑制长按选中与系统上下文菜单（把手另有 touch-action: none）
    dragFromRef.current = idx
    dragToRef.current = idx
    pointerActiveRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 部分 WebView 在指针已释放时抛 NotFoundError；触摸场景下浏览器本身已有隐式捕获
    }
    clearPressTimer()
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null
      setDraggingIdx(idx)
      setDropTargetIdx(idx)
    }, 150)
  }

  const handleHandlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerActiveRef.current || draggingIdx === null) return
    e.preventDefault()
    const rows = document.querySelectorAll<HTMLElement>('[data-cat-row="true"]')
    const y = e.clientY
    let target = dragToRef.current ?? draggingIdx
    rows.forEach((row) => {
      const rect = row.getBoundingClientRect()
      if (y >= rect.top && y <= rect.bottom) {
        const parsed = Number(row.getAttribute('data-cat-index'))
        if (Number.isFinite(parsed)) target = parsed
      }
    })
    dragToRef.current = target
    if (target !== dropTargetIdx) setDropTargetIdx(target)
  }

  const handleHandlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearPressTimer()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // 未捕获/已释放：忽略
    }
    const from = dragFromRef.current
    const to = dragToRef.current
    const activated = draggingIdx !== null
    dragFromRef.current = null
    dragToRef.current = null
    setDraggingIdx(null)
    setDropTargetIdx(null)
    if (!activated || from === null || to === null || from === to) return
    const names = categories.map(c => c.name)
    const [moved] = names.splice(from, 1)
    names.splice(to, 0, moved)
    void persistOrder(names)
  }

  const handleTabChange = (newTab: 'expense' | 'income') => {
    setTab(newTab)
    setSelectedId(null)
    setIsCreating(false)
    resetForm()
    loadMeta()
  }

  const handleNew = () => {
    setSelectedId(null)
    resetForm()
    setIsCreating(true)
  }

  if (!isOpen && mode === 'dialog') return null

  const isPage = mode === 'page'

  // 空态文案必须与当前布局一致：桌面是「左列表 + 右编辑器」（"从左侧选择"成立），
  // 安卓窄屏已被 `mobile/android.css` 改成上下堆叠（"从左侧"是错的）。
  const emptyMessage = categories.length === 0
    ? t('暂无分类，点击"新增分类"开始')
    : touch
      ? t('选择一个分类进行编辑，或点击"新增分类"')
      : t('从左侧选择一个分类进行编辑，或点击"新增分类"')

  // 编辑模式可发现性提示：拖动把手与删除按钮是**编辑模式专属**（用户定稿的产品语义），
  // 因此非编辑态必须在页面上说清"去哪里能做什么"，不能只把线索藏在 aria-label 里。
  const editHint = editMode
    ? t('长按左侧把手拖动排序，点 × 删除分类')
    : t('点右上角「编辑」可拖动排序或删除分类')

  const headerContent = (
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
      <div className="flex items-center gap-2">
        {isPage && touch && (
          <button
            type="button"
            className="category-back-btn"
            onClick={onClose}
            aria-label={t('返回')}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            {t('返回')}
          </button>
        )}
        <Settings size={18} className="text-gray-400" />
        <h2 className="text-lg font-bold text-gray-900">{t('分类管理')}</h2>
      </div>
      {isPage && touch && (
        <button
          type="button"
          className="android-edit-toggle"
          aria-pressed={editMode}
          aria-label={editMode ? t('退出编辑模式') : t('进入编辑模式')}
          onClick={() => setEditMode(v => !v)}
        >
          <Pencil size={14} aria-hidden="true" />
          {editMode ? t('完成') : t('编辑')}
        </button>
      )}
      {!isPage && (
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <X size={18} />
        </button>
      )}
    </div>
  )

  const bodyContent = (
    <div className="category-manager-body flex-1 flex min-h-0 overflow-hidden">
      <CategoryList
        categories={categories}
        selectedId={selectedId}
        tab={tab}
        onTabChange={handleTabChange}
        onSelect={selectCategory}
        onNew={handleNew}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDelete={handleListItemDelete}
        tabLabelExpense={t('支出分类')}
        tabLabelIncome={t('收入分类')}
        deleteTitle={t('删除此分类')}
        newLabel={t('新增分类')}
        touch={touch}
        editMode={editMode}
        draggingIdx={draggingIdx}
        dropTargetIdx={dropTargetIdx}
        dragHandleLabel={t('拖动排序')}
        onHandlePointerDown={handleHandlePointerDown}
        onHandlePointerMove={handleHandlePointerMove}
        onHandlePointerUp={handleHandlePointerUp}
      />
      <CategoryForm
        editName={editName}
        editIcon={editIcon}
        editChildren={editChildren}
        newChild={newChild}
        isPreset={isPreset}
        isCreating={isCreating}
        saving={saving}
        hasSelection={selectedId !== null || isCreating}
        emptyMessage={emptyMessage}
        onEditNameChange={setEditName}
        onEditIconChange={setEditIcon}
        onNewChildChange={setNewChild}
        onAddChild={addChild}
        onRemoveChild={removeChild}
        onSave={handleSave}
        nameLabel={t('分类名称')}
        presetLabel={t('（预设分类）')}
        presetHint={t('预设分类名称不可修改，但可调整图标和子分类')}
        iconLabel={t('分类图标')}
        childrenLabel={t('二级分类')}
        childrenCountLabel={t('({n} 个)').replace('{n}', String(editChildren.length))}
        noChildrenLabel={t('暂无二级分类')}
        childPlaceholder={t('输入二级分类名称')}
        addLabel={t('添加')}
        saveLabel={t('保存修改')}
        createLabel={t('创建分类')}
        savingLabel={t('保存中...')}
        namePlaceholder={t('输入一级分类名称')}
      />
    </div>
  )

  const deleteDialog = (
    <ConfirmDialog
      open={deleteConfirm !== null}
      title={t('确认删除')}
      message={deleteConfirm
        ? t('将删除分类「{name}」及其 {n} 个二级分类。已使用该分类的账单不会被删除，只会变为「未分类」。')
          .replace('{name}', deleteConfirm.name)
          .replace('{n}', String(deleteConfirm.children))
        : ''
      }
      confirmLabel={t('删除')}
      danger
      onConfirm={handleDelete}
      onCancel={() => setDeleteConfirm(null)}
    />
  )

  if (isPage) {
    return (
      <div className="h-full flex flex-col">
        {headerContent}
        {touch && <p className="category-edit-hint">{editHint}</p>}
        {bodyContent}
        {deleteDialog}
      </div>
    )
  }

  const portalScope = modalPortalScope()

  return createPortal(
    <div
      className={`${portalScope.className} flex items-center justify-center`}
      data-theme={portalScope['data-theme']}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9000 }}
    >
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col animate-slide-up">
        {headerContent}
        {bodyContent}
        {deleteDialog}
      </div>
    </div>,
    document.body
  )
}
