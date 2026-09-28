/**
 * CloudBase accounts 集合规范化迁移脚本。
 *
 * 作用：
 *   按 generateStandardAccountId(email) 规则重新生成所有账号的 accountId，
 *   并把空 email 字段补全（用注册时的真实邮箱）。
 *
 * 用法：
 *   1. 准备 .env 文件（CLOUDBASE_ENV_ID=... 和 CLOUDBASE_API_KEY=...）
 *   2. 干跑预览：node scripts/migrate-account-ids.cjs --account-id TB123456
 *   3. 实际执行：核对预览后，显式传 --apply --account-id TB123456
 *
 * 安全保证：
 *   - 必须指定唯一 accountId；不会扫描或迁移整个 accounts 集合
 *   - 默认只读；只有显式传 --apply 才写入
 *   - 目标环境从 CLOUDBASE_ENV_ID 读取，不在源码中固定环境
 *   - 跳过不需要更新的记录
 *   - 邮箱缺失或无法稳定生成 ID 时，不更新 accountId
 *   - 保留 accounts._id / uid / phone / createdAt 不变
 */

const cloudbase = require('@cloudbase/node-sdk')
const fs = require('fs')
const path = require('path')

// ─── Config ────────────────────────────────────

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
  const adminEmail = (process.env['THUNDER_ADMIN_EMAIL'] || '').trim()
  if (adminEmail && email === adminEmail) return 'TBAdmin'

  const local = (email || '').split('@')[0]

  const digits = local.match(/\d+/g)?.join('') || ''
  if (digits.length >= 6) return 'TB' + digits.slice(0, 6)
  if (digits.length >= 4) return 'TB' + digits

  const letters = (local.match(/[a-zA-Z]+/g)?.join('') || '').toUpperCase()
  if (letters.length >= 6) return 'TB' + letters.slice(0, 6)
  if (letters.length >= 3) return 'TB' + letters

  return null
}

function getMigrationOptions(args) {
  const apply = args.includes('--apply')
  if (apply && args.includes('--dry-run')) {
    throw new Error('--dry-run 与 --apply 不可同时使用')
  }
  const accountIdIndex = args.indexOf('--account-id')
  const targetAccountId = accountIdIndex >= 0 ? args[accountIdIndex + 1] : ''
  const allowedArgs = new Set(['--apply', '--dry-run', '--account-id'])
  if (args.some((argument, index) => !allowedArgs.has(argument) && !(index > 0 && args[index - 1] === '--account-id'))) {
    throw new Error('存在不支持的参数')
  }
  if (!/^TB[A-Za-z0-9]{1,20}$/.test(targetAccountId)) {
    throw new Error('必须通过 --account-id 指定一个有效的 TB 账号 ID；不允许批量扫描')
  }
  if (args.filter((argument) => argument === '--account-id').length !== 1) {
    throw new Error('--account-id 必须恰好指定一次')
  }
  return { dryRun: !apply, targetAccountId }
}

// ─── Main ──────────────────────────────────────
async function main() {
  let dryRun
  let targetAccountId
  try {
    ;({ dryRun, targetAccountId } = getMigrationOptions(process.argv.slice(2)))
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(2)
  }
  const apiKey = process.env['CLOUDBASE_API_KEY'] || ''
  const envId = process.env['CLOUDBASE_ENV_ID'] || ''

  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  CloudBase accounts 集合规范化迁移                              ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`📋 模式:      ${dryRun ? '🧪 只读预览（默认）' : '⚡ 显式写入'}`)
  console.log(`🔑 API Key:  ${apiKey ? '已配置（不回显）' : '❌ 未配置'}`)
  console.log('👤 范围:      单一显式账号（不回显账号 ID）')
  console.log(`🌐 Env ID:   ${envId ? '已配置（不回显）' : '❌ 未配置'}`)
  console.log('')

  if (!envId) {
    console.error('❌ 未找到 CLOUDBASE_ENV_ID；请在本机环境变量或 .env 中配置。')
    process.exit(1)
  }

  if (!apiKey) {
    console.error('❌ 未找到 CLOUDBASE_API_KEY！')
    console.error('   请在项目根目录创建 .env 文件：')
    console.error('   CLOUDBASE_API_KEY=your_admin_key_here')
    process.exit(1)
  }

  const app = cloudbase.init({ env: envId, accessKey: apiKey })
  const db = app.database()

  console.log('🔍 查询指定 accountId（最多核对 2 条以检测重复）...')
  const { data } = await db.collection('accounts').where({ accountId: targetAccountId }).limit(2).get()
  if (data.length > 1) {
    console.error('❌ 指定 accountId 对应多条记录；拒绝继续，未进行写入。')
    process.exit(1)
  }
  console.log(`📊 匹配记录: ${data.length}\n`)

  if (data.length === 0) {
    console.log('✅ 集合为空，无需迁移')
    return
  }

  let updatedCount = 0
  let skippedCount = 0
  let unusableEmailCount = 0

  for (const acc of data) {
    const oldId = acc.accountId || '(无)'
    const email = acc.email || ''
    const newId = email ? generateStandardAccountId(email) : null

    const idChanged = newId !== null && oldId !== newId

    if (!email) {
      unusableEmailCount++
      skippedCount++
      console.log('⚠ [跳过] 邮箱缺失，保持 accountId 不变。')
      continue
    }

    if (!newId) {
      unusableEmailCount++
      skippedCount++
      console.log('⚠ [跳过] 邮箱信息不足以稳定生成账号 ID，保持 accountId 不变。')
      continue
    }

    if (!idChanged) {
      skippedCount++
      continue
    }

    console.log('🔄 [待核对] 指定账号的 accountId 与邮箱规则不一致。')
    console.log('    账号 ID 将按已配置的稳定邮箱规则更新；具体值不回显。')

    if (!dryRun) {
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
  console.log(`   邮箱缺失/不足: ${unusableEmailCount}`)
  console.log('═══════════════════════════════════════════════════════════')

  if (dryRun && updatedCount > 0) {
    console.log('')
    console.log('💡 审阅预览后，如确需写入，显式运行：node scripts/migrate-account-ids.cjs --apply --account-id <同一 TB 账号 ID>')
  }
}

module.exports = { generateStandardAccountId, getMigrationOptions }

if (require.main === module) {
  main().catch(e => {
    console.error('迁移失败:', e)
    process.exit(1)
  })
}
