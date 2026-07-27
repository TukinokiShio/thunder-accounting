/**
 * 二级分类联动选择器（v1.7.21 — react-select 重写版）。
 *
 * 历史：
 * - v1.7.20: 改用 createPortal + position:fixed，但 Chromium 130+ 中
 *   即使 Portal 到 body，position:fixed 在 transform 祖先下仍可能失效。
 * - v1.7.21: 直接采用 react-select —— 它的 menuPortalTarget API
 *   是为 Dialog/Modal 场景设计的生产级方案（10 年验证、28K+ stars）。
 *
 * License: MIT（react-select 本身为 MIT License）。
 */
import Select from 'react-select'
import { useStore } from '@/store'
import { useLanguage } from '@/i18n/LanguageContext'
import type { Category } from '@/types'

interface Props {
  category1: string
  category2: string
  type: 'expense' | 'income'
  onCategory1Change: (cat: string) => void
  onCategory2Change: (cat: string) => void
}

/* react-select 选项类型（label 字符串，value 即分类名） */
interface Option {
  readonly value: string
  readonly label: string
}

/* 单选共享样式 — Portal + fixed 定位 + 高 z-index */
const PORTAL_STYLES = {
  menuPortal: (base: any) => ({ ...base, zIndex: 10000 }),
  menu: (base: any) => ({ ...base, zIndex: 10000 }),
}

export function CategorySelect({ category1, category2, type, onCategory1Change, onCategory2Change }: Props) {
  const expenseCategories = useStore((s) => s.expenseCategories)
  const incomeCategories = useStore((s) => s.incomeCategories)
  const cats: Category[] = type === 'income' ? incomeCategories : expenseCategories
  const { t } = useLanguage()

  const cat1Options: Option[] = cats.map((c) => ({ value: c.name, label: `${c.icon} ${c.name}` }))
  const selectedCat1: Option | null = cat1Options.find((o) => o.value === category1) || null

  const cat2Options: Option[] = (selectedCat1
    ? cats.find((c) => c.name === selectedCat1.value)?.children ?? []
    : []
  ).map((s) => ({ value: s, label: s }))
  const selectedCat2: Option | null = cat2Options.find((o) => o.value === category2) || null

  return (
    <div className="flex gap-2">
      {/* ── 一级分类 ── */}
      <Select<Option>
        options={cat1Options}
        value={selectedCat1}
        onChange={(opt) => onCategory1Change(opt?.value || '')}
        placeholder={t('选择一级分类')}
        isClearable={false}
        menuPortalTarget={document.body}
        menuPosition="fixed"
        styles={PORTAL_STYLES}
        className="flex-1"
        classNamePrefix="rs"
      />

      {/* ── 二级分类 ── */}
      <Select<Option>
        options={cat2Options}
        value={selectedCat2}
        onChange={(opt) => onCategory2Change(opt?.value || '')}
        placeholder={t('选择二级分类')}
        isClearable={false}
        isDisabled={!category1}
        menuPortalTarget={document.body}
        menuPosition="fixed"
        styles={PORTAL_STYLES}
        className="flex-1"
        classNamePrefix="rs"
        noOptionsMessage={() => t('先选择一级分类')}
      />
    </div>
  )
}