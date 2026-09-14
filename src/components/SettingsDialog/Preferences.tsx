/**
 * 「偏好设置」（语言 / 时区）区块 —— 设置弹窗与安卓「我的」页共用**同一份实现**。
 *
 * 为什么抽出来：安卓本地模式下「我的」页把偏好设置内联在页面上（语言必须**不经过任何弹窗**
 * 就能直接点到），而设置弹窗在桌面仍然存在 → 同一组控件有两个渲染位置。
 * 语言切换器的可用性判据（可访问名恰为「中文」/「English」、`role="group"` +
 * `aria-labelledby`、`aria-pressed` 反映当前语言）是**布局门禁 A7 与单测都在依赖的东西**，
 * 抄第二份必然在某一侧漂移，所以只留一份。
 *
 * 与弹窗的 DOM 关系：本组件只渲染「标题 + 两行控件」，**不含外层 `<section>`**
 * —— 外层由调用方提供（弹窗用无边框的 `<section>`，"我的"页用带 `border-t` 的
 * `<section>`）。因此弹窗侧传入 `idPrefix="settings"` 时，输出的 DOM 与抽取前逐位相同。
 *
 * `idPrefix` 不是可选的美化项：本区块含 3 个**全局** id（分组标签 / 标题 / 时区控件），
 * 而同一页面在安卓上会同时挂载「我的」页内联区块与（可被 store 打开的）设置弹窗，
 * 不加前缀就会出现重复 id —— 重复 id 会让 `aria-labelledby` 与 `<label for>` 指向第一个匹配项，
 * 屏幕阅读器读到的是另一个区块的文案。
 */
import { useState } from 'react'
import { Globe, Clock } from 'lucide-react'
import { useLanguage } from '@/i18n/LanguageContext'
import { loadSettings, saveSettings, TIMEZONE_OPTIONS } from '@/utils/settings'

interface Props {
  /** 本区块内 3 个 id 的前缀，见文件头说明 */
  idPrefix: string
}

export function Preferences({ idPrefix }: Props) {
  const { t, language, setLanguage } = useLanguage()
  const [timezone, setTimezone] = useState(() => loadSettings().timezone)

  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz)
    saveSettings({ timezone: tz })
  }

  const languageLabelId = `${idPrefix}-language-label`
  const timezoneId = `${idPrefix}-timezone`

  return (
    <>
      <h3 id={`${idPrefix}-preferences-title`} className="text-sm font-semibold text-gray-900 mb-3">{t('偏好设置')}</h3>
      <div className="space-y-3">
        {/* Language */}
        <div className="flex items-center justify-between">
          <div id={languageLabelId} className="flex items-center gap-2 text-sm text-gray-700">
            <Globe size={16} className="text-[var(--accent)]" />
            <span>{t('语言')}</span>
          </div>
          <div role="group" aria-labelledby={languageLabelId} className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              type="button"
              aria-pressed={language === 'zh'}
              onClick={() => setLanguage('zh')}
              className={`px-3 py-1.5 transition-colors ${
                language === 'zh'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t('中文')}
            </button>
            <button
              type="button"
              aria-pressed={language === 'en'}
              onClick={() => setLanguage('en')}
              className={`px-3 py-1.5 transition-colors ${
                language === 'en'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t('English')}
            </button>
          </div>
        </div>

        {/* Timezone */}
        <div className="flex items-center justify-between">
          <label htmlFor={timezoneId} className="flex items-center gap-2 text-sm text-gray-700">
            <Clock size={16} className="text-[var(--accent)]" />
            <span>{t('时区')}</span>
          </label>
          <select
            id={timezoneId}
            value={timezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
            className="text-sm border border-[var(--border)] rounded-lg px-2 py-1.5 bg-[var(--bg-card)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] max-w-[180px]"
          >
            {TIMEZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.label)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}
