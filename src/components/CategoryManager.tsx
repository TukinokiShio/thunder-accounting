/**
 * 分类管理组件。支持 dialog（弹窗）和 page（全页面）两种模式。
 * 左侧为可拖拽排序的分类列表（支出/收入切换），右侧为编辑器：名称、图标、二级分类的增删。
 * 预设分类的名称不可修改，但图标和子分类可调整。
 */
import { useState, useRef, useCallback } from 'react'
import { X, Settings } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
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

  /** 删除确认弹窗 */
  const [deleteConfirm, setDeleteConfirm] = useState<{ name: string; id: number } | null>(null)

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
  const handleListItemDelete = (idx: number) => {
    const cat = categories[idx]
    if (!cat) return
    const id = nameToIdRef.current.get(cat.name)
    if (!id) {
      addToast('error', t('删除失败，请重试'))
      return
    }
    setDeleteConfirm({ name: cat.name, id })
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

  const handleDragEnd = async () => {
    const names = dragOrderRef.current
    dragIdxRef.current = null
    dragOrderRef.current = []
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

  const emptyMessage = categories.length === 0
    ? t('暂无分类，点击"新增分类"开始')
    : t('从左侧选择一个分类进行编辑，或点击"新增分类"')

  const headerContent = (
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
      <div className="flex items-center gap-2">
        <Settings size={18} className="text-gray-400" />
        <h2 className="text-lg font-bold text-gray-900">{t('分类管理')}</h2>
      </div>
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
    <div className="flex-1 flex min-h-0 overflow-hidden">
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
      message={deleteConfirm ? `「${deleteConfirm.name}」` : ''}
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
        {bodyContent}
        {deleteDialog}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col animate-slide-up">
        {headerContent}
        {bodyContent}
        {deleteDialog}
      </div>
    </div>
  )
}
