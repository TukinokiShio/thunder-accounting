import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const themedSources = [
  'src/index.css',
  'src/pages/Home.tsx',
  'src/pages/Bills.tsx',
  'src/pages/Login.tsx',
  'src/pages/Stats.tsx',
  'src/pages/Profile.tsx',
  'src/components/AuthGuard.tsx',
  'src/components/Layout.tsx',
  'src/components/EmojiPicker.tsx',
  'src/components/CategoryManager/CategoryList.tsx',
  'src/components/SettingsDialog.tsx',
  'src/components/SettingsDialog/About.tsx',
  'src/components/SettingsDialog/BackupRestore.tsx',
  'src/components/SettingsDialog/SyncStatus.tsx',
]

describe('semantic theme contract', () => {
  it('does not retain legacy blue or primary utility styling in product sources', () => {
    const source = themedSources
      .map(file => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n')

    expect(source).not.toMatch(/#(?:3b82f6|2563eb|1d4ed8)/i)
    expect(source).not.toMatch(/(?:text|bg|border|ring|hover:border)-blue-/)
    expect(source).not.toMatch(/(?:text|bg|border|ring)-primary-/)
  })

  it('keeps the accent token available in both themes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/--accent:\s*#d59b25/)
    expect(css).toMatch(/\.dark[\s\S]*--accent:\s*#d59b25/)
    expect(readFileSync(resolve(process.cwd(), 'src/pages/Stats.tsx'), 'utf8')).toContain("stroke=\"var(--accent)\"")
    expect(readFileSync(resolve(process.cwd(), 'src/pages/Stats.tsx'), 'utf8')).not.toMatch(/#(?:374151|4b5563|9ca3af|e5e7eb|1f2937|f9fafb)/i)
    expect(css).toMatch(/--chart-grid:/)
    expect(css).toMatch(/--chart-tooltip-bg:/)
  })

  it('uses semantic product classes for the legacy Bills and Stats controls', () => {
    const bills = readFileSync(resolve(process.cwd(), 'src/pages/Bills.tsx'), 'utf8')
    const stats = readFileSync(resolve(process.cwd(), 'src/pages/Stats.tsx'), 'utf8')
    expect(bills).toContain('bill-filter-control')
    expect(bills).not.toContain('dark:bg-gray-700 dark:border-gray-600')
    expect(bills).not.toContain('dark:bg-gray-800 dark:border-gray-700')
    expect(stats).toContain('stats-export')
    expect(stats).not.toContain('dark:bg-gray-700 dark:text-gray-200')
  })

  it('keeps bill card hover limited to the semantic border state', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    expect(css).toMatch(
      /\.aurora-shell \.bill-filter-card:hover,\s*\.aurora-shell \.bill-list-card:hover\s*\{[\s\S]*?transform:\s*none;[\s\S]*?box-shadow:\s*none;/
    )
    expect(css).toContain('.card:hover { border-color: var(--accent);')
  })

  it('keeps bill filter focus and native affordances on the gold accent', () => {
    const bills = readFileSync(resolve(process.cwd(), 'src/pages/Bills.tsx'), 'utf8')
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    expect(bills).toContain('bill-filter-date')
    expect(bills.match(/bill-filter-select/g)).toHaveLength(2)
    expect(bills).not.toContain('bill-filter-select-shell')
    expect(css).toMatch(/\.aurora-shell \.bill-filter-control[\s\S]*accent-color:\s*var\(--accent\)/)
    expect(css).toMatch(/\.aurora-shell \.bill-filter-control:focus, \.aurora-shell \.bill-filter-control:focus-visible[\s\S]*border-color:\s*var\(--accent\)/)
    expect(css).toMatch(/\.aurora-shell \.bill-filters :where\(label, div\):has\(> \.input-field, > \.bill-filter-control\):focus-within \{ outline: none; \}/)
    expect(css).toMatch(/\.aurora-shell \.bill-filter-select option:checked[\s\S]*background:\s*var\(--accent\)/)
    expect(css).not.toMatch(/bill-filter-control[\s\S]{0,500}#(?:2196f3|3b82f6|2563eb)/i)
  })

  it('keeps security tips and dark dashboard cards on semantic surfaces', () => {
    const profile = readFileSync(resolve(process.cwd(), 'src/pages/Profile.tsx'), 'utf8')
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    expect(profile).toContain('profile-security-tip')
    expect(css).toMatch(/\.aurora-shell \.profile-security-tip\s*\{[\s\S]*background:\s*color-mix\([\s\S]*var\(--bg-card\)/)
    expect(css).toMatch(/\.aurora-shell:is\(\.dark, \[data-theme='dark'\]\) \.home-dashboard-card[\s\S]*border-color:\s*var\(--border\)/)
    expect(css).toMatch(/\.aurora-shell:is\(\.dark, \[data-theme='dark'\]\) \.stats-card[\s\S]*border-color:\s*var\(--border\)/)
  })

  it('keeps toast icon styling lightweight and status-aware', () => {
    const toast = readFileSync(resolve(process.cwd(), 'src/components/Toast.tsx'), 'utf8')
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    expect(toast).toContain('aurora-toast-icon')
    expect(toast).toContain('aria-label="关闭通知"')
    expect(css).toMatch(/\.aurora-toast-icon[\s\S]*border-radius:\s*8px[\s\S]*var\(--toast-accent\)/)
    expect(css).toMatch(/\.aurora-toast-success\s*\{\s*--toast-accent:\s*var\(--success\)/)
    expect(css).toMatch(/\.aurora-toast-error\s*\{\s*--toast-accent:\s*var\(--danger\)/)
    expect(css).not.toMatch(/\.aurora-toast-(?:success|error|info)\s*\{\s*border-left:/)
  })

  it('keeps profile binding fields on one focus-within boundary', () => {
    const profile = readFileSync(resolve(process.cwd(), 'src/pages/Profile.tsx'), 'utf8')
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    expect(profile.match(/className="profile-field-shell"/g)).toHaveLength(7)
    expect(profile.match(/className="profile-code-field flex items-center"/g)).toHaveLength(4)
    expect(profile.match(/className="profile-input min-w-0 flex-1 px-3 text-sm"/g)).toHaveLength(4)
    expect(profile).not.toContain('profile-input min-w-0 flex-1 rounded-lg rounded-r-none')
    expect(css).toMatch(/\.profile-field-shell:focus-within\s*, \.profile-code-field:focus-within\s*\{[\s\S]*outline:\s*var\(--focus-width\) solid var\(--accent\)/)
  })
})
