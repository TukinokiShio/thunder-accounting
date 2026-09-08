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
import type { StylesConfig } from 'react-select'
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

/* 单选共享样式 — 使用项目语义 token，保留 Portal + fixed 定位 + 高 z-index。 */
const SELECT_STYLES: StylesConfig<Option, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 42,
    borderColor: state.isDisabled
      ? 'var(--border)'
      : state.isFocused
        ? 'var(--accent)'
        : 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: state.isDisabled ? 'var(--bg2)' : 'var(--bg-card)',
    boxShadow: 'none',
    cursor: state.isDisabled ? 'not-allowed' : 'default',
    transition: 'border-color .18s ease, background-color .18s ease',
    '&:hover': {
      borderColor: state.isDisabled
        ? 'var(--border)'
        : state.isFocused
          ? 'var(--accent)'
          : 'var(--border-h)'
    }
  }),
  valueContainer: (base) => ({ ...base, padding: '0 .75rem' }),
  placeholder: (base, state) => ({
    ...base,
    color: state.isDisabled ? 'var(--text3)' : 'var(--text2)',
    cursor: state.isDisabled ? 'not-allowed' : 'text'
  }),
  singleValue: (base, state) => ({
    ...base,
    color: state.isDisabled ? 'var(--text3)' : 'var(--text)',
    cursor: state.isDisabled ? 'not-allowed' : 'default'
  }),
  input: (base, state) => ({
    ...base,
    color: state.isDisabled ? 'var(--text3)' : 'var(--text)',
    cursor: state.isDisabled ? 'not-allowed' : 'text'
  }),
  menu: (base) => ({
    ...base,
    zIndex: 10000,
    marginTop: 4,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-card)',
    boxShadow: 'none'
  }),
  menuList: (base) => ({ ...base, padding: 4 }),
  option: (base, state) => ({
    ...base,
    borderRadius: 'calc(var(--radius-sm) - 2px)',
    color: state.isSelected ? 'var(--accent-ink)' : 'var(--text)',
    backgroundColor: state.isSelected
      ? 'var(--accent)'
      : state.isFocused
        ? 'var(--accent-dim)'
        : 'transparent',
    '&:active': { backgroundColor: 'var(--accent-dim)' }
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isDisabled
      ? 'var(--text3)'
      : state.isFocused
        ? 'var(--accent)'
        : 'var(--text2)',
    cursor: state.isDisabled ? 'not-allowed' : 'pointer',
    '&:hover': { color: state.isDisabled ? 'var(--text3)' : 'var(--accent)' }
  }),
  indicatorSeparator: (base) => ({ ...base, backgroundColor: 'var(--border)' }),
  noOptionsMessage: (base) => ({ ...base, color: 'var(--text3)' }),
  menuPortal: (base: any) => ({ ...base, zIndex: 10000 }),
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
  const menuPlacement = typeof window !== 'undefined' && window.innerHeight <= 600 ? 'top' : 'bottom'

  return (
    <div className="flex flex-col gap-2 sm:flex-row add-bill-category-select">
      {/* ── 一级分类 ── */}
      <Select<Option>
        options={cat1Options}
        value={selectedCat1}
        onChange={(opt) => onCategory1Change(opt?.value || '')}
        placeholder={t('选择一级分类')}
        isClearable={false}
        menuPortalTarget={document.body}
        menuPosition="fixed"
        menuPlacement={menuPlacement}
        styles={SELECT_STYLES}
        className="flex-1"
        classNamePrefix="rs"
        aria-label={t('一级分类')}
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
        menuPlacement={menuPlacement}
        styles={SELECT_STYLES}
        className="flex-1"
        classNamePrefix="rs"
        aria-label={t('二级分类')}
        noOptionsMessage={() => t('先选择一级分类')}
      />
    </div>
  )
}
