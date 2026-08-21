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
})
