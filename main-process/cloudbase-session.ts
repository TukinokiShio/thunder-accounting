export interface ExternalCloudbaseSession {
  access_token: string
  refresh_token: string
}

export interface CloudbaseUserSessionClient<Database> {
  auth: () => {
    setSession(session: ExternalCloudbaseSession): Promise<{
      data: { user?: { id?: unknown } | null } | null
      error: unknown | null
    }>
  }
  database(): Database
}

type ErrorRecord = Record<string, unknown>

const SAFE_CLOUDBASE_CODES = new Set([
  'cloud_unknown_error', 'cloud_session_incomplete', 'cloud_session_uid_mismatch', 'cloud_session_rejected',
  'cloud_session_changed', 'cloud_session_refresh_failed', 'cloud_session_refresh_incomplete',
  'cloud_session_unavailable', 'cloud_session_binding_unavailable', 'cloud_session_or_local_database_unavailable',
  'cloud_sdk_not_initialized', 'cloud_sdk_init_failed', 'cloud_user_database_unavailable',
  'cloud_pull_investments_failed', 'cloud_pull_investment_snapshots_failed', 'cloud_sync_investment_failed', 'cloud_delete_investment_failed',
  'token_expired', 'access_token_expired', 'invalid_refresh_token', 'refresh_token_expired',
  'investment_history_collection_missing', 'migration_required', 'reauth_required'
])

function asRecord(value: unknown): ErrorRecord | null {
  return value && typeof value === 'object' ? value as ErrorRecord : null
}

function safeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').slice(0, 64)
  return code && (SAFE_CLOUDBASE_CODES.has(code) || /^http_[1-5]\d{2}$/.test(code)) ? code : null
}

function normalizedCodeCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 64 || !/^[a-z0-9_.-]+$/i.test(trimmed)) return null
  return trimmed.toLowerCase()
}

/** Return only machine-readable CloudBase error metadata; never surface SDK messages or request bodies. */
export function safeCloudbaseErrorCode(value: unknown, fallback = 'cloud_unknown_error'): string {
  const root = asRecord(value)
  const candidates = [
    root?.code,
    root?.error_code,
    root?.error,
    asRecord(root?.error)?.code,
    asRecord(root?.error)?.error_code,
    asRecord(root?.data)?.code,
    asRecord(root?.data)?.error_code,
    asRecord(root?.data)?.error
  ]
  const normalizedCandidates = candidates
    .map(normalizedCodeCandidate)
    .filter((code): code is string => code !== null)
  if (new Set(normalizedCandidates).size > 1) return 'cloud_unknown_error'

  for (const candidate of candidates) {
    const code = safeCode(candidate)
    if (code) return code
  }
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  if (message && message.length <= 256) {
    const messageParts = message.toLowerCase().split(':').map((part) => safeCode(part.trim()))
    if (messageParts.length > 0 && messageParts.every((part): part is string => part !== null)) {
      return messageParts[messageParts.length - 1] || 'cloud_unknown_error'
    }
  }
  const status = root?.status ?? root?.statusCode ?? asRecord(root?.response)?.status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    return `http_${status}`
  }
  return safeCode(fallback) || 'cloud_unknown_error'
}

export function isExplicitAccessTokenExpiredError(value: unknown): boolean {
  const code = safeCloudbaseErrorCode(value, '')
  return code === 'token_expired' || code === 'access_token_expired'
}

/** Attach an existing login to JS SDK and fail closed unless the SDK confirms the same UID. */
export async function bindCloudbaseUserDatabase<Database>(
  client: CloudbaseUserSessionClient<Database>,
  session: ExternalCloudbaseSession,
  expectedUserId: string
): Promise<{ userId: string; database: Database }> {
  if (!session.access_token || !session.refresh_token || !expectedUserId) {
    throw new Error('cloud_session_incomplete')
  }

  let result: Awaited<ReturnType<ReturnType<CloudbaseUserSessionClient<Database>['auth']>['setSession']>>
  try {
    result = await client.auth().setSession(session)
  } catch (error) {
    throw new Error(`cloud_session_rejected:${safeCloudbaseErrorCode(error)}`)
  }
  if (result.error) throw new Error(`cloud_session_rejected:${safeCloudbaseErrorCode(result.error)}`)

  const actualUserId = result.data?.user?.id
  if (typeof actualUserId !== 'string' || !actualUserId || actualUserId !== expectedUserId) {
    throw new Error('cloud_session_uid_mismatch')
  }

  return { userId: actualUserId, database: client.database() }
}

/** Refresh once only for an explicit access-token-expired code, then bind and re-check UID. */
export async function bindCloudbaseUserDatabaseWithRefresh<Database>(
  client: CloudbaseUserSessionClient<Database>,
  session: ExternalCloudbaseSession,
  expectedUserId: string,
  refreshTokens: () => Promise<ExternalCloudbaseSession>
): Promise<{ userId: string; database: Database; session: ExternalCloudbaseSession }> {
  try {
    const bound = await bindCloudbaseUserDatabase(client, session, expectedUserId)
    return { ...bound, session }
  } catch (error) {
    if (!isExplicitAccessTokenExpiredError(error)) throw error
  }

  let refreshed: ExternalCloudbaseSession
  try {
    refreshed = await refreshTokens()
  } catch (error) {
    if (error instanceof Error && /^cloud_session_refresh_[a-z0-9_-]+(?::[a-z0-9_.-]+)*$/i.test(error.message)) throw error
    throw new Error(`cloud_session_refresh_failed:${safeCloudbaseErrorCode(error)}`)
  }
  if (!refreshed.access_token || !refreshed.refresh_token) throw new Error('cloud_session_refresh_incomplete')
  const bound = await bindCloudbaseUserDatabase(client, refreshed, expectedUserId)
  return { ...bound, session: refreshed }
}
