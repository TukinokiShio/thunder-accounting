// resetUserPassword — CloudBase HTTP 云函数（v3 手机号支持版）
// 由 雷霆记账 APP POST JSON 调用
// Body: { email?: string, phone?: string, newPassword: string, verification_id: string, verification_code: string }
//
// v3 改进：支持手机号重置密码（通过 accounts 集合查找 UID）

const cloudbase = require('@cloudbase/node-sdk')
const crypto = require('crypto')
const https = require('https')

const ENV_ID = 'shio-d0gsoo414401468d6'
const AUTH_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`
const RATE_LIMIT_MAX = 3
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const HTTPS_TIMEOUT_MS = 5000

// ─── 主入口 ──────────────────────────────────────────

exports.main = async (event, context) => {
  const email = (event.email || '').trim().toLowerCase()
  const phone = (event.phone || '').trim()
  const newPassword = event.newPassword || ''
  const verificationId = String(event.verification_id || '').trim()
  const verificationCode = String(event.verification_code || '').trim()
  const clientIp = String(
    (context && context.clientIp) || event.clientIp || 'unknown'
  ).trim() || 'unknown'

  // ── 参数校验 ─────────────────────────────────────────
  if ((!email && !phone) || !newPassword || !verificationId || !verificationCode) {
    return { code: 400, message: 'Missing required fields: email or phone, newPassword, verification_id, verification_code' }
  }

  // 邮箱格式校验（仅当有 email 时）
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: 'Invalid email format' }
  }

  // 手机号格式校验（仅当有 phone 时）
  if (phone && !/^\d{11}$/.test(phone)) {
    return { code: 400, message: 'Invalid phone format' }
  }

  // 密码强度与 CloudBase ModifyUser API 对齐：8-32 位，至少满足四类字符中的三类。
  if (newPassword.length < 8 || newPassword.length > 32) {
    return { code: 400, message: 'Password must be 8-32 characters' }
  }
  const passwordClasses = [/[a-z]/, /[A-Z]/, /\d/, /[()!@#$%^&*|?><_\-]/]
  if (passwordClasses.filter(pattern => pattern.test(newPassword)).length < 3) {
    return { code: 400, message: 'Password must contain at least three of lowercase, uppercase, number, and special character' }
  }

  // ── 速率限制 ─────────────────────────────────────────
  try {
    const rateLimited = await checkRateLimit(clientIp)
    if (rateLimited) {
      return { code: 429, message: 'Too many requests. Please try again in 1 minute.' }
    }
  } catch (e) {
    // 限流存储不可用时拒绝敏感操作，避免 fail-open 被绕过。
    console.error('Rate limit check failed, refusing password reset:', e.message)
    return { code: 503, message: 'Password reset temporarily unavailable. Please try again later.' }
  }

  // ── 服务端验证验证码并绑定目标身份 ───────────────────
  // 不能只相信桌面客户端提交的 verification_token：公开云函数必须自己验证
  // verification_id + verification_code，并用 signin 确认 token 与目标账号一致。
  let uid
  try {
    uid = await verifyIdentity(email || phone, !!phone, verificationId, verificationCode)
    if (!uid) return { code: 401, message: 'Verification failed' }

    const app = cloudbase.init({ env: ENV_ID })

    if (email) {
      // 邮箱查找
      const auth = app.auth()
      const { userInfo } = await auth.queryUserInfo({
        platform: 'EMAIL',
        platformId: email
      })
      if (!userInfo || !userInfo.uid) {
        return { code: 404, message: 'User not found with this email' }
      }
      if (userInfo.uid !== uid) return { code: 401, message: 'Verification target does not match user' }
      console.log(`User found by email: ${uid}`)
    } else if (phone) {
      // 手机号查找：通过 accounts 集合
      const db = app.database()
      const result = await db.collection('accounts').where({ phone }).limit(1).get()
      if (!result.data || !result.data.length) {
        return { code: 404, message: 'User not found with this phone' }
      }
      const account = result.data[0]
      if (account.uid !== uid) return { code: 401, message: 'Verification target does not match user' }
      console.log(`User found by phone: ${uid}`)
    }
  } catch (e) {
    console.error('queryUserInfo failed:', e.message)
    if (e.code === 'ResourceNotFound') {
      return { code: 404, message: 'User not found' }
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

/**
 * 在云函数侧完成验证码验证，并通过 signin 确认验证码对应的账号。
 * signin 只用于身份确认，返回的 access token 不会向调用方暴露。
 */
async function verifyIdentity(identifier, isPhone, verificationId, verificationCode) {
  const verifyRes = await fetch(`${AUTH_BASE}/auth/v1/verification/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verification_id: verificationId, verification_code: verificationCode })
  })
  const verifyData = responsePayload(await verifyRes.json().catch(() => ({})))
  if (!verifyRes.ok || !verifyData.verification_token) {
    throw new Error(verifyData.error_description || verifyData.error || 'invalid_verification_code')
  }

  const signinRes = await fetch(`${AUTH_BASE}/auth/v1/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: isPhone ? '+86 ' + identifier : identifier,
      verification_token: verifyData.verification_token
    })
  })
  const signinData = responsePayload(await signinRes.json().catch(() => ({})))
  if (!signinRes.ok || !signinData.sub) {
    throw new Error(signinData.error_description || signinData.error || 'verification_target_mismatch')
  }
  return signinData.sub
}

function responsePayload(data) {
  return data && data.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? data.data
    : data || {}
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
    // 清理使用同一个 db 实例的 command，避免异步清理函数引用作用域外变量。
    cleanOldRecords(coll, db, windowStart)

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
async function cleanOldRecords(coll, db, before) {
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
          } else if (!j.Response || !j.Response.Data || j.Response.Data.Success !== true) {
            resolve({ success: false, error: 'ModifyUser returned an unsuccessful response' })
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
