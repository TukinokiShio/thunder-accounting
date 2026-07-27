// resetUserPassword — CloudBase HTTP 云函数（v2 加固版）
// 由 雷霆记账 APP POST JSON 调用
// Body: { email: string, newPassword: string, verificationCode: string }
//
// 改进（v1.7.15）：
// - 入参改为 email + newPassword + verificationCode（不再接收 uid）
// - 内部通过 @cloudbase/node-sdk queryUserInfo 按邮箱查 UID
// - 速率限制：CloudBase DB collection rate_limits，每 IP 每分钟最多 3 次
// - HTTPS 请求超时：5 秒
// - 密码强度校验：≥6 字符，禁止纯数字
// - 完善错误处理与日志

const cloudbase = require('@cloudbase/node-sdk')
const crypto = require('crypto')
const https = require('https')

const ENV_ID = 'shio-d0gsoo414401468d6'
const RATE_LIMIT_MAX = 3       // 每分钟最多请求次数
const RATE_LIMIT_WINDOW_MS = 60 * 1000  // 窗口：1 分钟
const HTTPS_TIMEOUT_MS = 5000

// ─── 主入口 ──────────────────────────────────────────

exports.main = async (event, context) => {
  const email = (event.email || '').trim().toLowerCase()
  const newPassword = event.newPassword || ''
  const verificationCode = (event.verificationCode || '').trim()
  const clientIp = (context && context.clientIp) || 'unknown'

  // ── 参数校验 ─────────────────────────────────────────
  if (!email || !newPassword || !verificationCode) {
    return { code: 400, message: 'Missing required fields: email, newPassword, verificationCode' }
  }

  // 邮箱格式基本校验
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: 'Invalid email format' }
  }

  // 密码强度：≥6 字符，禁止纯数字
  if (newPassword.length < 6) {
    return { code: 400, message: 'Password must be at least 6 characters' }
  }
  if (/^\d+$/.test(newPassword)) {
    return { code: 400, message: 'Password must not be purely numeric' }
  }

  // ── 速率限制 ─────────────────────────────────────────
  try {
    const rateLimited = await checkRateLimit(clientIp)
    if (rateLimited) {
      return { code: 429, message: 'Too many requests. Please try again in 1 minute.' }
    }
  } catch (e) {
    // 速率限制检查失败不阻塞主流程，只记日志
    console.warn('Rate limit check failed, proceeding:', e.message)
  }

  // ── 通过邮箱查找 UID ─────────────────────────────────
  let uid
  try {
    const app = cloudbase.init({ env: ENV_ID })
    const auth = app.auth()

    const { userInfo } = await auth.queryUserInfo({
      platform: 'EMAIL',
      platformId: email
    })

    if (!userInfo || !userInfo.uid) {
      return { code: 404, message: 'User not found with this email' }
    }
    uid = userInfo.uid
    console.log(`User found: ${uid} for email ${email}`)
  } catch (e) {
    console.error('queryUserInfo failed:', e.message)
    if (e.code === 'ResourceNotFound') {
      return { code: 404, message: 'User not found with this email' }
    }
    return { code: 500, message: 'Failed to lookup user: ' + e.message }
  }

  // ── 调用 ModifyUser API 修改密码 ─────────────────────
  try {
    const { secretId, secretKey, token } = getCredentials()

    if (!secretId || !secretKey) {
      console.error('SCF credentials not available')
      return { code: 500, message: 'Internal error: credentials not available' }
    }

    const result = await callTCBApi('ModifyUser', {
      EnvId: ENV_ID,
      Uid: uid,
      Password: newPassword
    }, secretId, secretKey, token)

    if (result.success) {
      console.log(`Password reset OK for ${email} (uid=${uid}) from ${clientIp}`)
      return { code: 0, message: 'Password reset successful' }
    }
    console.error('ModifyUser API failed:', result.error)
    return { code: 500, message: result.error || 'Password reset failed' }
  } catch (e) {
    console.error('ModifyUser exception:', e.message)
    return { code: 500, message: 'Password reset failed: ' + e.message }
  }
}

// ─── 速率限制 ─────────────────────────────────────────
// 使用 CloudBase 数据库 rate_limits 集合记录每次调用

async function checkRateLimit(clientIp) {
  try {
    const app = cloudbase.init({ env: ENV_ID })
    const db = app.database()
    const coll = db.collection('rate_limits')

    const now = Date.now()
    const windowStart = now - RATE_LIMIT_WINDOW_MS

    // 清理过期记录（异步，不阻塞）
    cleanOldRecords(coll, windowStart)

    // 查询最近 1 分钟内的调用次数
    const countRes = await coll
      .where({
        ip: clientIp,
        timestamp: db.command.gte(windowStart)
      })
      .count()

    const count = countRes.total || 0

    if (count >= RATE_LIMIT_MAX) {
      console.warn(`Rate limited: ${clientIp} (${count} requests in window)`)
      return true
    }

    // 记录本次调用
    await coll.add({
      ip: clientIp,
      timestamp: now,
      type: 'resetPassword'
    })

    return false
  } catch (e) {
    console.error('Rate limit DB error:', e.message)
    throw e // 让调用方决定是否继续
  }
}

// 异步清理过期记录（不阻塞主流程）
async function cleanOldRecords(coll, before) {
  try {
    await coll.where({ timestamp: db.command.lt(before) }).remove()
  } catch { /* 清理失败不影响主流程 */ }
}

// ─── SCF 凭据获取 ─────────────────────────────────────

function getCredentials() {
  return {
    secretId: process.env.TENCENTCLOUD_SECRETID || '',
    secretKey: process.env.TENCENTCLOUD_SECRETKEY || '',
    token: process.env.TENCENTCLOUD_SESSIONTOKEN || ''
  }
}

// ─── TC3-HMAC-SHA256 签名 + HTTPS 调用 ────────────────

function sha256(data, key) {
  return key
    ? crypto.createHmac('sha256', key).update(data).digest()
    : crypto.createHash('sha256').update(data).digest()
}

function callTCBApi(action, params, secretId, secretKey, token) {
  return new Promise((resolve, reject) => {
    const host = 'tcb.tencentcloudapi.com'
    const service = 'tcb'
    const payload = JSON.stringify(params)
    const timestamp = Math.floor(Date.now() / 1000)
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

    // Step 1: CanonicalRequest
    const httpMethod = 'POST'
    const canonicalUri = '/'
    const canonicalQuery = ''
    const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
    const signedHeaders = 'content-type;host;x-tc-action'
    const hashedPayload = sha256(payload).toString('hex')
    const canonicalRequest = `${httpMethod}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`

    // Step 2: StringToSign
    const credentialScope = `${date}/${service}/tc3_request`
    const hashedCanonical = sha256(canonicalRequest).toString('hex')
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonical}`

    // Step 3: Signature
    const kDate = sha256(date, 'TC3' + secretKey)
    const kService = sha256(service, kDate)
    const kSigning = sha256('tc3_request', kService)
    const signature = sha256(stringToSign, kSigning).toString('hex')

    // Step 4: Authorization
    const auth = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const reqBody = payload
    const opts = {
      hostname: host,
      port: 443,
      path: '/',
      method: 'POST',
      timeout: HTTPS_TIMEOUT_MS,  // ✅ 添加超时
      headers: {
        'Content-Type': 'application/json',
        'Host': host,
        'X-TC-Action': action,
        'X-TC-Version': '2018-06-08',
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': 'ap-shanghai',
        'X-TC-Token': token,
        'Authorization': auth,
        'Content-Length': Buffer.byteLength(reqBody)
      }
    }

    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const j = JSON.parse(data)
          if (j.Response && j.Response.Error) {
            resolve({ success: false, error: JSON.stringify(j.Response.Error) })
          } else {
            resolve({ success: true })
          }
        } catch {
          resolve({ success: false, error: data.substring(0, 200) })
        }
      })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, error: 'HTTPS request timed out after ' + HTTPS_TIMEOUT_MS + 'ms' })
    })

    req.on('error', e => resolve({ success: false, error: e.message }))

    req.write(reqBody)
    req.end()
  })
}
