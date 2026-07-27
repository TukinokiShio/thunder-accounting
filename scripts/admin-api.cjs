/**
 * CloudBase Admin API helper
 *
 * ⚠️ 当前实现方式: 限制
 *   - CloudBase Admin API (tcb/ModifyUser) 需要 SecretId/SecretKey 进行 TC3-HMAC-SHA256 签名
 *   - @cloudbase/node-sdk 不包含修改用户密码的方法
 *   - REST API `/auth/v1/user/password` 当前返回 501 Not Implemented
 *   - @cloudbase/cloudbase-mcp 只能通过 MCP 协议调用，不是 CLI
 *
 * 所以这个脚本目前只能 throw 提示用户通过 AI 助手手动改密码。
 * 当用户调用"忘记密码"功能时，应用层会收到此错误并显示提示。
 */

function callCloudApi(action, params) {
  // TODO: 实现真正的管理员 API 调用方式
  // 选项 A: 使用 @tencentcloud/tencentcloud-sdk-nodejs-tcb + SecretId/SecretKey
  // 选项 B: 实现 Web 端 OAuth 流程获取 admin token 后调用 REST API
  throw new Error('CloudBase 管理员 API 暂未集成到客户端。请通过 WorkBuddy AI 助手调用 MCP 修改密码。')
}

function changeUserPassword(uid, newPassword) {
  return callCloudApi('ModifyUser', { Uid: uid, Password: newPassword })
}

module.exports = { callCloudApi, changeUserPassword }

if (require.main === module) {
  const [uid, password] = process.argv.slice(2)
  if (!uid || !password) {
    console.error('用法: node admin-api.cjs <uid> <newPassword>')
    process.exit(1)
  }
  try {
    const result = changeUserPassword(uid, password)
    console.log(JSON.stringify(result))
  } catch (e) {
    console.error('Failed:', e.message)
    process.exit(1)
  }
}
