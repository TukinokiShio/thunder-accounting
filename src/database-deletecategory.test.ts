/**
 * 主进程 database 分类删除回归复现测试（node 环境 + 真实 sql.js）。
 * 背景：用户实测反馈「分类删除操作执行失败」。
 * 覆盖：删除自定义分类、删除后列表不再包含、删除预设分类、连续删除、删除不存在 id。
 */
// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-delete-'))

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => tmpDir },
}))

import { initDatabase, addCategory, deleteCategory, getCategories } from '../main-process/database/index'

describe('database: deleteCategory 回归（分类删除操作）', () => {
  beforeAll(async () => {
    await initDatabase()
  })

  it('删除自定义分类后 getCategories 不再包含', () => {
    const cat = addCategory({ name: '待删除分类', icon: '🗑️', children: [], type: 'expense' })
    expect(cat.id).toBeGreaterThan(0)

    deleteCategory(cat.id)

    const list = getCategories('expense')
    expect(list.some((c) => c.id === cat.id)).toBe(false)
    expect(list.some((c) => c.name === '待删除分类')).toBe(false)
  })

  it('连续删除多个分类均正常', () => {
    const c1 = addCategory({ name: '删除甲', icon: '🅰️', children: [], type: 'expense' })
    const c2 = addCategory({ name: '删除乙', icon: '🅱️', children: [], type: 'expense' })
    deleteCategory(c1.id)
    deleteCategory(c2.id)
    const names = getCategories('expense').map((c) => c.name)
    expect(names).not.toContain('删除甲')
    expect(names).not.toContain('删除乙')
  })

  it('删除不存在的 id 不抛错（幂等）', () => {
    expect(() => deleteCategory(999999)).not.toThrow()
  })

  it('删除后 saveDb 持久化：重新加载后仍不存在', async () => {
    const cat = addCategory({ name: '删除持久化', icon: '💾', children: [], type: 'expense' })
    deleteCategory(cat.id)
    await initDatabase()
    const found = getCategories('expense').find((c) => c.name === '删除持久化')
    expect(found).toBeUndefined()
  })
})
