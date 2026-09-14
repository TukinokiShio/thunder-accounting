/**
 * 「数据管理」（导出备份 / 导入备份 / 清除所有数据）的**行为实现**。
 *
 * 为什么抽成 hook 而不是留在设置弹窗里：安卓本地模式下「我的」页把数据管理内联在页面上
 * （`src/pages/Profile.tsx` 的 `LocalProfilePanel`），而设置弹窗在桌面仍然存在
 * —— 同一件事因此有**两个渲染位置**。行为（写盘、三阶段清除、toast 文案、刷新账本）
 * 只允许有一份实现：抄第二份的话，任何一次修正（例如新增校验、改 toast 文案、
 * 改清除阶段数）都只会在两个入口中的一个生效，而另一个会安静地保持旧行为。
 * UI 侧同理复用 `./BackupRestore`，两个入口拿到的是同一个组件 + 同一个 hook。
 *
 * 本文件不含任何中文以外的 UI 文案：全部走 `useLanguage().t()`（i18n 源级契约会扫本文件）。
 */
import { useState } from 'react'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import { formatLocalDate } from '@/utils/date'

export interface DataManagement {
  exporting: boolean
  importing: boolean
  clearing: boolean
  /** 0 = 未进入清除流程；1/2 = 两次确认的中间态（第三次点击才真的清除） */
  clearStep: number
  handleExport: () => Promise<void>
  handleImport: () => Promise<void>
  handleClear: () => Promise<void>
  cancelClear: () => void
}

export function useDataManagement(): DataManagement {
  const refreshBills = useStore((s) => s.refreshBills)
  const refreshCategories = useStore((s) => s.refreshCategories)
  const addToast = useStore((s) => s.addToast)
  const notifyChange = useStore((s) => s.notifyChange)
  const { t } = useLanguage()

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearStep, setClearStep] = useState(0)

  const handleExport = async () => {
    setExporting(true)
    try {
      const json = await window.electronAPI.exportBackup()
      const filePath = await window.electronAPI.showSaveDialog(
        `ThunderBooks_Backup_${formatLocalDate()}.json`
      )
      if (filePath) {
        await window.electronAPI.writeFile(filePath, json)
        addToast('success', t('数据备份已导出'))
      } else {
        addToast('info', t('已取消导出'))
      }
    } catch (e) {
      console.error('Export failed:', e)
      addToast('error', t('导出失败，请重试'))
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const result = await window.electronAPI.showOpenDialog()
      if (!result) {
        setImporting(false)
        return
      }

      const { bills, categories } = await window.electronAPI.importBackup(result.content)
      addToast(
        'success',
        t('数据已恢复：{bills} 条账单，{categories} 个自定义分类')
          .replace('{bills}', String(bills))
          .replace('{categories}', String(categories))
      )
      await refreshBills()
      await refreshCategories()
      notifyChange()
    } catch (e) {
      console.error('Import failed:', e)
      addToast(
        'error',
        e instanceof Error ? e.message : t('导入失败，请检查文件格式')
      )
    } finally {
      setImporting(false)
    }
  }

  const handleClear = async () => {
    if (clearStep === 0) {
      setClearStep(1)
      return
    }
    if (clearStep === 1) {
      setClearStep(2)
      return
    }

    setClearing(true)
    try {
      await window.electronAPI.clearAllData()
      addToast('success', t('所有数据已清除'))
      setClearStep(0)
      await refreshBills()
      await refreshCategories()
      notifyChange()
    } catch (e) {
      console.error('Clear failed:', e)
      addToast('error', t('清除失败，请重试'))
    } finally {
      setClearing(false)
    }
  }

  const cancelClear = () => {
    setClearStep(0)
  }

  return { exporting, importing, clearing, clearStep, handleExport, handleImport, handleClear, cancelClear }
}
