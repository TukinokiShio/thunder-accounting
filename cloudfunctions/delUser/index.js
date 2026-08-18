// Account-deletion saga: accepts only current Auth token + reauthentication code.
const cloudbase = require('@cloudbase/node-sdk')
const ENV_ID = 'shio-d0gsoo414401468d6'
const AUTH_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`

exports.main = async (event) => {
  const accessToken = String(event && event.access_token || '')
  const verifyCode = String(event && event.verify_code || '')
  if (!accessToken || !verifyCode) return { code: 400, message: 'access_token and verify_code are required' }
  const user = await authRequest('/auth/v1/user/me', 'GET', accessToken)
  const uid = user.data.uid || user.data.sub
  if (!user.ok || !uid) return { code: 401, message: 'invalid_session' }

  const accessKey = process.env.CLOUDBASE_APIKEY || ''
  if (!accessKey) return { code: 503, message: 'deletion_job_unavailable' }
  const app = cloudbase.init({ env: ENV_ID, accessKey })
  const jobs = app.database().collection('account_deletion_jobs')
  let jobId
  try {
    jobId = (await jobs.add({ uid, state: 'auth_pending', attempts: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })).id
  } catch { return { code: 503, message: 'deletion_job_unavailable' } }

  const deleted = await authRequest(`/auth/v1/user/me?verify_code=${encodeURIComponent(verifyCode)}`, 'DELETE', accessToken)
  if (!deleted.ok) {
    await updateJob(jobs, jobId, { state: 'auth_failed', error: safeError(deleted.data), updatedAt: new Date().toISOString() })
    return { code: 401, message: 'auth_delete_failed' }
  }
  await updateJob(jobs, jobId, { state: 'cleanup_pending', authDeletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  try {
    await cleanupUserData(app.database(), uid)
    await updateJob(jobs, jobId, { state: 'completed', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    return { code: 0, message: 'User deleted', cleanup_pending: false, job_id: jobId }
  } catch (error) {
    await updateJob(jobs, jobId, { state: 'cleanup_pending', attempts: 1, error: safeError(error), updatedAt: new Date().toISOString() })
    return { code: 202, message: 'Auth deleted; cloud-data cleanup pending', cleanup_pending: true, job_id: jobId }
  }
}

async function authRequest(path, method, token) {
  const response = await fetch(`${AUTH_BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
  const raw = await response.json().catch(() => ({}))
  return { ok: response.ok, data: responsePayload(raw) }
}

async function cleanupUserData(db, uid) {
  for (const [collection, query] of [['bills', { userId: uid }], ['categories', { userId: uid }], ['accounts', { uid }]]) {
    while (true) {
      const items = (await db.collection(collection).where(query).limit(100).get()).data || []
      if (!items.length) break
      for (const item of items) await db.collection(collection).doc(item._id).remove()
    }
  }
}
async function updateJob(jobs, id, fields) { await jobs.doc(id).update(fields) }
function responsePayload(data) { return data && data.data && typeof data.data === 'object' ? data.data : data || {} }
function safeError(error) { return String(error && error.message || error || 'unknown').slice(0, 300) }
