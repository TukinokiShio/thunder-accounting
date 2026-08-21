import { Download, Upload, Trash2 } from 'lucide-react'

interface Props {
  exporting: boolean
  importing: boolean
  clearing: boolean
  clearStep: number
  onExport: () => void
  onImport: () => void
  onClear: () => void
  onCancelClear: () => void
  t: (key: string) => string
}

export function BackupRestore({
  exporting,
  importing,
  clearing,
  clearStep,
  onExport,
  onImport,
  onClear,
  onCancelClear,
  t,
}: Props) {
  return (
    <section className="border-t border-gray-100 pt-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('数据管理')}</h3>
      <div className="space-y-2">
        {/* Export */}
        <button
          onClick={onExport}
          disabled={exporting}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <Download size={16} className="text-[var(--accent)] shrink-0" />
          <div className="flex-1">
            <div className="font-medium">{t('导出备份')}</div>
            <div className="text-xs text-gray-400">{t('将所有账单和分类导出为 JSON 文件')}</div>
          </div>
        </button>

        {/* Import */}
        <button
          onClick={onImport}
          disabled={importing}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <Upload size={16} className="text-green-500 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">{t('导入备份')}</div>
            <div className="text-xs text-gray-400">{t('从 JSON 备份文件恢复数据（会覆盖现有数据）')}</div>
          </div>
        </button>

        {/* Clear */}
        <div>
          <button
            onClick={onClear}
            disabled={clearing}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors disabled:opacity-50
              ${
                clearStep > 0
                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
          >
            <Trash2 size={16} className={`shrink-0 ${clearStep > 0 ? 'text-red-500' : 'text-red-400'}`} />
            <div className="flex-1">
              <div className="font-medium">
                {clearStep === 0 && t('清除所有数据')}
                {clearStep === 1 && t('⚠️ 再次确认：清除所有数据？')}
                {clearStep === 2 && t('🚨 最后确认：此操作不可恢复！')}
              </div>
              <div className="text-xs text-gray-400">
                {clearStep === 0 && t('删除所有账单和自定义分类（预设分类保留）')}
                {clearStep === 1 && t('所有账单将被永久删除')}
                {clearStep === 2 && t('点击第三次将执行清除')}
              </div>
            </div>
          </button>
          {clearStep > 0 && (
            <button
              onClick={onCancelClear}
              className="mt-1 ml-11 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {t('取消清除')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
