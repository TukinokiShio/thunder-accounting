/**
 * Emoji 图标选择器组件。
 * 展示 60 个常用 Emoji 的网格面板，点击选中后高亮显示。
 */
import { useLanguage } from '@/i18n/LanguageContext'

/** 可选的 Emoji 列表（60 个常用图标） */
const EMOJI_LIST = [
  '🍽️', '🚗', '🛒', '🏠', '💊', '📚', '🎮', '🎁', '💰', '📦',
  '✈️', '🧳', '🏨', '🎫', '🚌', '🛍️', '💻', '📱', '👗', '💄',
  '🐾', '🍎', '🍿', '🎂', '☕', '🍺', '⚽', '🎣', '🎤', '💇',
  '🛠️', '📷', '🔧', '💡', '❤️', '🎵', '🎨', '🌿', '🏋️', '🎓',
  '💼', '📈', '↩️', '🏦', '🚲', '⛽', '🚿', '🧹', '📞', '🔑',
  '🌟', '🔥', '💧', '⚡', '🌈', '🎯', '🏆', '💎', '🎪', '🎭'
]

interface Props {
  value: string
  onChange: (emoji: string) => void
}

export function EmojiPicker({ value, onChange }: Props) {
  const { t } = useLanguage()

  return (
    <div className="space-y-2">
      {/* 当前选中的 Emoji 预览 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">{t('当前图标：')}</span>
        <span className="text-2xl">{value}</span>
      </div>

      {/* Emoji 网格面板 */}
      <div className="grid grid-cols-10 gap-1 max-h-[200px] overflow-y-auto p-2 bg-gray-50 rounded-lg border border-gray-200">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onChange(emoji)}
            className={`w-8 h-8 flex items-center justify-center text-lg rounded-md transition-colors
              ${emoji === value
                ? 'bg-primary-100 ring-2 ring-primary-400 scale-110'
                : 'hover:bg-gray-100 hover:scale-105'
              }`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
