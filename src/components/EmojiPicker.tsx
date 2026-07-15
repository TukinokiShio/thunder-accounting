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
  return (
    <div className="space-y-2">
      {/* Current selection */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">当前图标：</span>
        <span className="text-2xl">{value}</span>
      </div>

      {/* Emoji grid */}
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
