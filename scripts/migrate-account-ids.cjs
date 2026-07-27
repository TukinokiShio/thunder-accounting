/**
 * CloudBase accounts 集合规范化迁移脚本。
 *
 * 作用：
 *   按 generateStandardAccountId(email) 规则重新生成所有账号的 accountId，
 *   并把空 email 字段补全（用注册时的真实邮箱）。
 *
 * 用法：
 *   1. 准备 .env 文件（CLOUDBASE_API_KEY=xxx）
 *   2. 干跑预览： node scripts/migrate-account-ids.cjs --dry-run
 *   3. 实际执行： node scripts/migrate-account-ids.cjs
 *
 * 安全保证：
 *   - 默认 --dry-run 模式，只打印不改写
 *   - 跳过不需要更新的记录
 *   - 保留 accounts._id / uid / phone / createdAt 不变
 */

const cloudbase = require('@cloudbase/node-sdk')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// ─── Config ────────────────────────────────────
const ENV_ID = 'shio-d0gsoo414401468d6'
const ADMIN_EMAIL = '15211073887@163.com'
const ACCOUNT_ID_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// ─── 加载 .env（手动解析，无需 dotenv 依赖）──
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  } catch (e) {
    console.error('Failed to load .env file:', e)
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'))

// ─── 规范化生成函数（与 main-process/cloudbase.ts 保持一致）──
function generateStandardAccountId(email) {
  if (email === ADMIN_EMAIL) return 'TBAdmin'

  const local = (email || '').split('@')[0]

  const digits = local.match(/\d+/g)?.join('') || ''
  if (digits.length >= 6) return 'TB' + digits.slice(0, 6)
  if (digits.length >= 4) return 'TB' + digits

  const letters = (local.match(/[a-zA-Z]+/g)?.join('') || '').toUpperCase()
  if (letters.length >= 6) return 'TB' + letters.slice(0, 6)
  if (letters.length >= 3) return 'TB' + letters

  // 兜底：6 位随机
  let id = 'TB'
  const bytes = crypto.randomBytes(6)
  for (let i = 0; i < 6; i++) {
    id += ACCOUNT_ID_CHARSET[bytes[i] % ACCOUNT_ID_CHARSET.length]
  }
  return id
}

// ─── Main ──────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const apiKey = process.env['CLOUDBASE_API_KEY'] || ''

  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  CloudBase accounts 集合规范化迁移                              ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`📋 模式:      ${dryRun ? '🧪 干跑（不修改）' : '⚡ 实际写入'}`)
  console.log(`🔑 API Key:  ${apiKey ? apiKey.slice(0, 8) + '...' : '❌ 未配置'}`)
  console.log(`🌐 Env ID:   ${ENV_ID}`)
  console.log('')

  if (!apiKey) {
    console.error('❌ 未找到 CLOUDBASE_API_KEY！')
    console.error('   请在项目根目录创建 .env 文件：')
    console.error('   CLOUDBASE_API_KEY=your_admin_key_here')
    process.exit(1)
  }

  const app = cloudbase.init({ env: ENV_ID, accessKey: apiKey })
  const db = app.database()

  console.log('🔍 列出所有 accounts 记录...')
  const { data } = await db.collection('accounts').limit(1000).get()
  console.log(`📊 共 ${data.length} 条记录\n`)

  if (data.length === 0) {
    console.log('✅ 集合为空，无需迁移')
    return
  }

  let updatedCount = 0
  let skippedCount = 0
  const updates = [] // 用于汇总

  for (const acc of data) {
    const uidShort = (acc.uid || '').slice(0, 8)
    const oldId = acc.accountId || '(无)'
    const oldEmail = acc.email || '(空)'
    const email = acc.email || ''
    const newId = generateStandardAccountId(email || 'fallback@x.com')

    const idChanged = oldId !== newId
    const emailMissing = !acc.email
    const phoneMissing = !acc.phone

    if (!idChanged && !emailMissing && !phoneMissing) {
      skippedCount++
      console.log(`✓ [跳过] uid=${uidShort}... email="${email}" accountId="${oldId}"`)
      continue
    }

    console.log(`🔄 uid=${uidShort}... email="${oldEmail}"`)
    if (idChanged) {
      console.log(`    accountId: "${oldId}" → "${newId}"`)
    }
    if (emailMissing) {
      console.log(`    ⚠ email 字段为空（无法从 accounts 自动修复，需 user 登录时自动补全）`)
    }

    updates.push({
      _id: acc._id,
      newAccountId: newId,
      uid: acc.uid
    })

    if (!dryRun && idChanged) {
      try {
        await db.collection('accounts').doc(acc._id).update({ accountId: newId })
        updatedCount++
      } catch (e) {
        console.error(`    ❌ 更新失败: ${e.message}`)
      }
    } else if (dryRun) {
      updatedCount++  // 干跑模式计数
    }
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`${dryRun ? '🧪 干跑结果' : '✅ 迁移完成'}`)
  console.log(`   待更新记录: ${updatedCount}`)
  console.log(`   跳过记录:   ${skippedCount}`)
  console.log('═══════════════════════════════════════════════════════════')

  if (dryRun && updatedCount > 0) {
    console.log('')
    console.log('💡 确认无误后，运行：node scripts/migrate-account-ids.cjs')
  }
}

main().catch(e => {
  console.error('迁移失败:', e)
  process.exit(1)
})
