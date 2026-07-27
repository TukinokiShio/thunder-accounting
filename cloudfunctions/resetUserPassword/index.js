// resetUserPassword — CloudBase HTTP 云函数
// 由 雷霆记账 APP POST JSON 调用
// Body: { uid: string, newPassword: string }

exports.main = async (event) => {
  const uid = event.uid
  const newPassword = event.newPassword

  if (!uid || !newPassword) {
    return { code: 400, message: 'Missing uid or newPassword' }
  }

  // 使用 CloudBase Admin API 修改密码
  // 云函数运行环境自动拥有管理员权限
  try {
    // 使用 SCF 环境注入的临时凭据 + SCF SDK 调用 Admin API
    const { secretId, secretKey, token } = await getCredentials()
    
    // 调用 TCB ModifyUser API
    const result = await callTCBApi('ModifyUser', {
      EnvId: 'shio-d0gsoo414401468d6',
      Uid: uid,
      Password: newPassword
    }, secretId, secretKey, token)

    if (result.success) {
      return { code: 0, message: 'Password reset OK', uid }
    }
    return { code: 500, message: result.error || 'Unknown error' }
  } catch (e) {
    return { code: 500, message: e.message }
  }
}

// 获取 SCF 环境的临时凭证
async function getCredentials() {
  // SCF 环境自动注入的超时临时凭证通过 HTTP 可获取
  try {
    // 在 SCF 环境中，credentials 通过环境变量获取
    return {
      secretId: process.env.TENCENTCLOUD_SECRETID || '',
      secretKey: process.env.TENCENTCLOUD_SECRETKEY || '',
      token: process.env.TENCENTCLOUD_SESSIONTOKEN || ''
    }
  } catch (e) {
    return { secretId: '', secretKey: '', token: '' }
  }
}

// TC3-HMAC-SHA256 签名 + call
const crypto = require('crypto')
const http = require('http')

function sha256(data, key) {
  return key
    ? crypto.createHmac('sha256', key).update(data).digest()
    : crypto.createHash('sha256').update(data).digest()
}

function callTCBApi(action, params, secretId, secretKey, token) {
  return new Promise((resolve) => {
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
      hostname: host, port: 443, path: '/', method: 'POST',
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

    const req = require('https').request(opts, (res) => {
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
    req.on('error', e => resolve({ success: false, error: e.message }))
    req.write(reqBody)
    req.end()
  })
}
