import { Plus, X } from 'lucide-react'
import { EmojiPicker } from '@/components/EmojiPicker'

interface Props {
  editName: string
  editIcon: string
  editChildren: string[]
  newChild: string
  isPreset: boolean
  isCreating: boolean
  saving: boolean
  hasSelection: boolean
  emptyMessage: string
  onEditNameChange: (name: string) => void
  onEditIconChange: (icon: string) => void
  onNewChildChange: (child: string) => void
  onAddChild: () => void
  onRemoveChild: (name: string) => void
  onSave: () => void
  nameLabel: string
  presetLabel: string
  presetHint: string
  iconLabel: string
  childrenLabel: string
  childrenCountLabel: string
  noChildrenLabel: string
  childPlaceholder: string
  addLabel: string
  saveLabel: string
  createLabel: string
  savingLabel: string
  namePlaceholder: string
}

export function CategoryForm({
  editName,
  editIcon,
  editChildren,
  newChild,
  isPreset,
  isCreating,
  saving,
  hasSelection,
  emptyMessage,
  onEditNameChange,
  onEditIconChange,
  onNewChildChange,
  onAddChild,
  onRemoveChild,
  onSave,
  nameLabel,
  presetLabel,
  presetHint,
  iconLabel,
  childrenLabel,
  childrenCountLabel,
  noChildrenLabel,
  childPlaceholder,
  addLabel,
  saveLabel,
  createLabel,
  savingLabel,
  namePlaceholder,
}: Props) {
  return (
    <div className="category-editor flex-1 overflow-y-auto p-5 space-y-4">
      {!hasSelection ? (
        <div className="flex items-center justify-center h-full text-sm text-gray-400">
          {emptyMessage}
        </div>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {nameLabel}
              {isPreset && <span className="text-xs text-amber-500 ml-2">{presetLabel}</span>}
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              maxLength={20}
              placeholder={namePlaceholder}
              className="input-field"
              disabled={isPreset}
            />
            {isPreset && (
              <p className="text-xs text-gray-400 mt-1">{presetHint}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{iconLabel}</label>
            <EmojiPicker value={editIcon} onChange={onEditIconChange} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {childrenLabel} <span className="text-gray-400 font-normal">{childrenCountLabel}</span>
            </label>

            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[32px]">
              {editChildren.length === 0 ? (
                <span className="text-xs text-gray-400 py-1">{noChildrenLabel}</span>
              ) : (
                editChildren.map((child) => (
                  <span
                    key={child}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 text-sm text-gray-700 group"
                  >
                    {child}
                    <button
                      type="button"
                      onClick={() => onRemoveChild(child)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newChild}
                onChange={(e) => onNewChildChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddChild() } }}
                maxLength={20}
                placeholder={childPlaceholder}
                className="input-field flex-1 text-sm"
              />
              <button
                type="button"
                onClick={onAddChild}
                disabled={!newChild.trim()}
                className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-40"
              >
                <Plus size={14} />
                {addLabel}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div />
            <button
              onClick={onSave}
              disabled={saving}
              className="btn-primary text-sm min-w-[80px]"
            >
              {saving ? savingLabel : isCreating ? createLabel : saveLabel}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
