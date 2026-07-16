/**
 * 分类管理组件。支持 dialog（弹窗）和 page（全页面）两种模式。
 * 左侧为分类列表（支出/收入切换），右侧为编辑器：名称、图标、二级分类的增删。
 * 预设分类的名称不可修改，但图标和子分类可调整。
 */
import { useState } from 'react'
import { X, Plus, Trash2, Settings } from 'lucide-react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { EmojiPicker } from './EmojiPicker'

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
  // 是否处于"新增分类"模式：区分「初始未选中（显示占位符）」与「正在创建新分类（显示表单）」
  const [isCreating, setIsCreating] = useState(false)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState('📦')
  const [editChildren, setEditChildren] = useState<string[]>([])
  const [newChild, setNewChild] = useState('')
  const [saving, setSaving] = useState(false)

  const categories = tab === 'expense' ? expenseCategories : incomeCategories

  // We need categories with IDs for update/delete. Store raw rows separately.
  const [catMeta, setCatMeta] = useState<Array<{ id: number; is_preset: number }>>([])

  /** 点击左侧列表选中一个分类，加载其元数据（id、是否预设）用于后续编辑/删除判断 */
  const selectCategory = async (idx: number) => {
    setSelectedId(idx)
    setIsCreating(false)
    const cat = categories[idx]
    if (!cat) return
    setEditName(cat.name)
    setEditIcon(cat.icon)
    setEditChildren([...cat.children])
    try {
      const rows = await window.electronAPI.getCategories(tab)
      setCatMeta(rows.map(r => ({ id: r.id, is_preset: r.is_preset })))
    } catch (e) {
      console.error('Failed to load category meta:', e)
      addToast('error', t('分类信息加载失败，请刷新后重试'))
    }
  }

  const isPreset = selectedId !== null && catMeta[selectedId]?.is_preset === 1

  /**
   * 保存分类（新增或更新）。
   * 根据 selectedId 和 catMeta 判断是新增还是编辑模式：
   * - 有 selectedId 且 catMeta 中有对应记录 → 更新已有分类
   * - 否则 → 创建新分类
   */
  const handleSave = async () => {
    if (!editName.trim()) {
      addToast('error', t('请输入分类名称'))
      return
    }
    if (editChildren.length === 0) {
      addToast('error', t('请至少添加一个二级分类'))
      return
    }

    setSaving(true)
    try {
      if (selectedId !== null && catMeta[selectedId]) {
        await window.electronAPI.updateCategory(catMeta[selectedId].id, {
          name: editName.trim(),
          icon: editIcon,
          children: editChildren.map(c => c.trim()).filter(Boolean)
        })
        addToast('success', t('已更新分类「{name}」').replace('{name}', editName.trim()))
      } else {
        await window.electronAPI.addCategory({
          name: editName.trim(),
          icon: editIcon,
          children: editChildren.map(c => c.trim()).filter(Boolean),
          type: tab
        })
        addToast('success', t('已新增分类「{name}」').replace('{name}', editName.trim()))
      }
      await refreshCategories()
      setSelectedId(null)
      resetForm()
    } catch (e) {
      console.error('Failed to save category:', e)
      addToast('error', t('保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  /** 删除自定义分类。预设分类受保护，不允许删除（前端 + SQL 双重拦截） */
  const handleDelete = async () => {
    if (selectedId === null || !catMeta[selectedId]) return
    if (isPreset) {
      addToast('error', t('预设分类不可删除'))
      return
    }
    setSaving(true)
    try {
      await window.electronAPI.deleteCategory(catMeta[selectedId].id)
      addToast('success', t('已删除分类「{name}」').replace('{name}', editName))
      await refreshCategories()
      setSelectedId(null)
      resetForm()
    } catch (e) {
      console.error('Failed to delete category:', e)
      addToast('error', t('删除失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  /** 重置编辑器表单到初始空状态 */
  const resetForm = () => {
    setIsCreating(false)
    setEditName('')
    setEditIcon('📦')
    setEditChildren([])
    setNewChild('')
    setCatMeta([])
  }

  /** 向当前编辑的分类添加一个二级分类，自动去重（已存在的名称直接拒绝） */
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

  if (!isOpen && mode === 'dialog') return null

  const isPage = mode === 'page'

  const bodyContent = (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Left: category list */}
      <div className="w-56 border-r border-gray-100 flex flex-col shrink-0">
        {/* Tab toggle */}
        <div className="flex items-center gap-1 p-2 bg-gray-50 border-b border-gray-100">
          <button
            onClick={() => { setTab('expense'); setSelectedId(null); resetForm() }}
            className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors
              ${tab === 'expense'
                ? 'bg-white text-red-500 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            {t('支出分类')}
          </button>
          <button
            onClick={() => { setTab('income'); setSelectedId(null); resetForm() }}
            className={`flex-1 py-1 rounded-md text-xs font-medium transition-colors
              ${tab === 'income'
                ? 'bg-white text-green-500 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            {t('收入分类')}
          </button>
        </div>

        {/* Category list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {categories.map((cat, idx) => (
            <button
              key={`${cat.name}-${idx}`}
              onClick={() => selectCategory(idx)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors
                ${selectedId === idx
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
                }`}
            >
              <span className="text-lg shrink-0">{cat.icon}</span>
              <span className="truncate">{cat.name}</span>
              <span className="text-xs text-gray-400 ml-auto shrink-0">{cat.children.length}</span>
            </button>
          ))}

          {/* Add new button */}
          <button
            onClick={() => {
              // 进入新增模式：清空表单并标记 isCreating，右侧编辑器切换为空白表单
              setSelectedId(null)
              resetForm()
              setIsCreating(true)
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-primary-500 hover:bg-primary-50 transition-colors mt-1"
          >
            <Plus size={14} />
            {t('新增分类')}
          </button>
        </div>
      </div>

      {/* Right: editor */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {selectedId === null && !isCreating ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {categories.length === 0
              ? t('暂无分类，点击"新增分类"开始')
              : t('从左侧选择一个分类进行编辑，或点击"新增分类"')}
          </div>
        ) : (
          <>
            {/* Category name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('分类名称')}
                {isPreset && <span className="text-xs text-amber-500 ml-2">{t('（预设分类）')}</span>}
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={20}
                placeholder={t('输入一级分类名称')}
                className="input-field"
                disabled={isPreset}
              />
              {isPreset && (
                <p className="text-xs text-gray-400 mt-1">{t('预设分类名称不可修改，但可调整图标和子分类')}</p>
              )}
            </div>

            {/* Icon picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('分类图标')}</label>
              <EmojiPicker value={editIcon} onChange={setEditIcon} />
            </div>

            {/* Children editor */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('二级分类')} <span className="text-gray-400 font-normal">{t('({n} 个)').replace('{n}', String(editChildren.length))}</span>
              </label>

              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[32px]">
                {editChildren.length === 0 ? (
                  <span className="text-xs text-gray-400 py-1">{t('暂无二级分类')}</span>
                ) : (
                  editChildren.map((child) => (
                    <span
                      key={child}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-sm text-gray-700 group"
                    >
                      {child}
                      {!isPreset && (
                        <button
                          type="button"
                          onClick={() => removeChild(child)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newChild}
                  onChange={(e) => setNewChild(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChild() } }}
                  maxLength={20}
                  placeholder={t('输入二级分类名称')}
                  className="input-field flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={addChild}
                  disabled={!newChild.trim()}
                  className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-40"
                >
                  <Plus size={14} />
                  {t('添加')}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              {selectedId !== null && !isPreset ? (
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600 font-medium disabled:opacity-40 transition-colors"
                >
                  <Trash2 size={14} />
                  {t('删除此分类')}
                </button>
              ) : (
                <div />
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary text-sm min-w-[80px]"
              >
                {saving ? t('保存中...') : selectedId !== null ? t('保存修改') : t('创建分类')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

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

  if (isPage) {
    return (
      <div className="h-full flex flex-col">
        {headerContent}
        {bodyContent}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col animate-slide-up">
        {headerContent}
        {bodyContent}
      </div>
    </div>
  )
}
