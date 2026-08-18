// Non-public timer/event worker. Never expose as HTTP and never accept a caller uid.
const cloudbase = require('@cloudbase/node-sdk')
const ENV_ID = 'shio-d0gsoo414401468d6'

exports.main = async () => {
  const accessKey = process.env.CLOUDBASE_APIKEY || ''
  if (!accessKey) throw new Error('CLOUDBASE_APIKEY is required')
  const app = cloudbase.init({ env: ENV_ID, accessKey })
  const db = app.database(); const jobs = db.collection('account_deletion_jobs')
  const pending = (await jobs.where({ state: 'cleanup_pending' }).limit(50).get()).data || []
  for (const job of pending) {
    try {
      await cleanup(db, job.uid)
      await jobs.doc(job._id).update({ state: 'completed', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    } catch (error) {
      await jobs.doc(job._id).update({ attempts: (job.attempts || 0) + 1, lastError: String(error && error.message || error).slice(0, 300), updatedAt: new Date().toISOString() })
    }
  }
  return { processed: pending.length }
}

async function cleanup(db, uid) {
  for (const [name, query] of [['bills', { userId: uid }], ['categories', { userId: uid }], ['accounts', { uid }]]) {
    while (true) { const records = (await db.collection(name).where(query).limit(100).get()).data || []; if (!records.length) break; for (const row of records) await db.collection(name).doc(row._id).remove() }
  }
}
