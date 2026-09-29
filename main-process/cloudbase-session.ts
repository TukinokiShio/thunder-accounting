export interface ExternalCloudbaseSession {
  access_token: string
  refresh_token: string
  expires_in?: number
  expires_at?: Date | string | number
}

export interface SdkTokenRefreshSession {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  user?: { id?: unknown } | null
}

/** True when a refresh notification refers to credentials that are already the active binding. */
export function isAlreadyBoundSdkCredentialPair(
  currentAccessToken: string | null,
  currentRefreshToken: string | null,
  boundAccessToken: string | null,
  boundRefreshToken: string | null,
  credentials: SdkTokenRefreshSession | null | undefined
): boolean {
  return !!credentials && !!currentAccessToken && !!currentRefreshToken &&
    currentAccessToken === boundAccessToken && currentRefreshToken === boundRefreshToken &&
    credentials.access_token === currentAccessToken && credentials.refresh_token === currentRefreshToken
}

/** Validate a token rotation against the bound credential lineage before relying on SDK user metadata. */
export function isSdkTokenRefreshForBoundLineage(
  expectedUserId: string | null,
  currentAccessToken: string | null,
  currentRefreshToken: string | null,
  lastBoundAccessToken: string | null,
  lastBoundRefreshToken: string | null,
  session: SdkTokenRefreshSession | null | undefined
): boolean {
  return !!session && !!expectedUserId && !!currentAccessToken && !!currentRefreshToken &&
    !!lastBoundAccessToken && !!lastBoundRefreshToken &&
    currentAccessToken === lastBoundAccessToken && currentRefreshToken === lastBoundRefreshToken &&
    typeof session.access_token === 'string' && !!session.access_token &&
    typeof session.refresh_token === 'string' && !!session.refresh_token &&
    (session.access_token !== currentAccessToken || session.refresh_token !== currentRefreshToken)
}

/** Accept an SDK background rotation only when both its credential lineage and UID are confirmed. */
export function isCurrentSdkTokenRefresh(
  expectedUserId: string | null,
  currentAccessToken: string | null,
  currentRefreshToken: string | null,
  lastBoundAccessToken: string | null,
  lastBoundRefreshToken: string | null,
  session: SdkTokenRefreshSession | null | undefined
): boolean {
  return isSdkTokenRefreshForBoundLineage(expectedUserId, currentAccessToken, currentRefreshToken,
    lastBoundAccessToken, lastBoundRefreshToken, session) && session?.user?.id === expectedUserId
}

interface SdkSessionResult {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  expires_at?: unknown
}

/** Share one in-flight operation per key; a rotating refresh token must never be redeemed concurrently. */
export class SingleFlight<K, Value> {
  private readonly pending = new Map<K, Promise<Value>>()

  getPending(key: K): Promise<Value> | null {
    return this.pending.get(key) || null
  }

  run(key: K, operation: () => Promise<Value>): Promise<Value> {
    const existing = this.pending.get(key)
    if (existing) return existing

    const next = Promise.resolve().then(operation)
    this.pending.set(key, next)
    void next.finally(() => {
      if (this.pending.get(key) === next) this.pending.delete(key)
    }).catch(() => undefined)
    return next
  }
}

/** Serialize credential reads and writes across accounts that share one SDK auth store. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()

  run<Value>(operation: () => Promise<Value> | Value): Promise<Value> {
    const next = this.tail.then(operation, operation)
    this.tail = next.then(() => undefined, () => undefined)
    return next
  }
}

const CLOUD_DATABASE_REQUEST_METHODS = new Set(['get', 'add', 'set', 'update', 'remove', 'count'])
const CLOUD_DATABASE_CHAIN_METHODS = new Set(['collection', 'where', 'doc', 'skip', 'limit', 'orderBy', 'field'])

/** Queue terminal SDK database requests because their internal token refresh bypasses auth APIs. */
export function serializeCloudDatabase<T extends object>(database: T, queue: SerialQueue): T {
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      if (typeof property === 'string' && CLOUD_DATABASE_REQUEST_METHODS.has(property)) {
        return (...args: unknown[]) => queue.run(() => Reflect.apply(value, target, args))
      }
      if (typeof property !== 'string' || !CLOUD_DATABASE_CHAIN_METHODS.has(property)) {
        return (...args: unknown[]) => Reflect.apply(value, target, args)
      }
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args)
        return result && typeof result === 'object' ? serializeCloudDatabase(result, queue) : result
      }
    }
  })
}

export interface CloudbaseUserSessionClient<Database> {
  auth: () => {
    setSession(session: ExternalCloudbaseSession): Promise<{
      data: { user?: { id?: unknown } | null; session?: SdkSessionResult | null } | null
      error: unknown | null
    }>
  }
  database(): Database
}

type ErrorRecord = Record<string, unknown>

const SAFE_CLOUDBASE_CODES = new Set([
  'cloud_unknown_error', 'cloud_session_incomplete', 'cloud_session_uid_mismatch', 'cloud_session_rejected',
  'cloud_session_changed', 'cloud_session_refresh_failed', 'cloud_session_refresh_incomplete',
  'cloud_session_identity_unconfirmed', 'cloud_session_rotation_unverified',
  'cloud_session_persist_failed',
  'cloud_session_unavailable', 'cloud_session_binding_unavailable', 'cloud_session_or_local_database_unavailable',
  'cloud_session_rotation_incomplete',
  'cloud_sdk_not_initialized', 'cloud_sdk_init_failed', 'cloud_user_database_unavailable',
  'cloud_pull_investments_failed', 'cloud_pull_investment_snapshots_failed', 'cloud_sync_investment_failed', 'cloud_delete_investment_failed',
  'token_expired', 'access_token_expired', 'invalid_refresh_token', 'refresh_token_expired',
  'investment_history_collection_missing', 'migration_required', 'reauth_required',
  'cloud_session_or_local_database_unavailable',
  'database_permission_denied', 'database_collection_not_exist', 'database_timeout', 'database_request_failed',
  'database_invalid_operrator', 'database_duplicate_write', 'database_transaction_fail', 'database_transaction_conflict',
  'database_collection_exceed_limit', 'database_collection_already_exist',
  'cloud_investment_positions_payload_invalid', 'cloud_investment_snapshots_payload_invalid',
  'cloud_auth_provider_not_enabled', 'cloud_auth_invalid_credentials', 'cloud_auth_user_not_found',
  'cloud_auth_user_status_abnormal', 'cloud_auth_service_error', 'cloud_auth_invalid_params',
  'cloud_auth_method_mismatch', 'cloud_auth_rate_limited', 'cloud_auth_captcha_required',
  'cloud_auth_captcha_invalid', 'cloud_auth_mfa_required', 'cloud_auth_precondition_failed',
  'cloud_auth_verification_failed', 'cloud_auth_unknown_error', 'cloud_auth_metadata_conflict',
  'invalid_argument', 'not_found', 'permission_denied', 'resource_exhausted', 'failed_precondition',
  'aborted', 'unimplemented', 'internal', 'unavailable', 'unauthenticated', 'missing_required_param',
  'captcha_required', 'captcha_invalid', 'provider_error', 'unauthorized_client', 'mfa_phone_required',
  'login_type_disabled', 'unreachable', 'local', 'cancelled', 'deadline_exceeded', 'already_exists',
  'out_of_range', 'data_loss', 'invalid_password', 'password_not_set', 'invalid_status', 'user_pending',
  'user_blocked', 'invalid_verification_code', 'two_factor_required', 'invalid_two_factor',
  'invalid_two_factor_recovery', 'under_review', 'invalid_request', 'unsupported_response_type',
  'invalid_scope', 'invalid_grant', 'server_error', 'temporarily_unavailable', 'interaction_required',
  'login_required', 'account_selection_required', 'consent_required', 'invalid_request_uri',
  'invalid_request_object', 'request_not_supported', 'request_uri_not_supported',
  'registration_not_supported', 'provider_not_enabled', 'login_method_disabled',
  'invalid_username_or_password', 'wrong_password', 'user_not_found',
  'sys_err', 'server_timeout', 'invalid_param', 'invalid_common_param', 'invalid_request_source',
  'resource_not_found', 'invalid_region', 'invalid_host', 'request_canceled', 'request_forbidden',
  'access_denied', 'exceed_authority', 'missing_required_param', 'missing_credentials',
  'authentication_failed', 'action_forbidden', 'permission_denied', 'invalid_credentials',
  'access_token_invalid', 'unauthorized', 'network_error', 'request_timeout', 'fetch_failed', 'failed_to_fetch'
])

const AUTH_ERROR_CODE_BY_NUMBER: Record<number, string> = {
  3: 'invalid_argument', 5: 'not_found', 7: 'permission_denied', 8: 'resource_exhausted',
  9: 'failed_precondition', 10: 'aborted', 12: 'unimplemented', 13: 'internal', 14: 'unavailable',
  16: 'unauthenticated', 4000: 'missing_required_param', 4001: 'captcha_required',
  4002: 'captcha_invalid', 4019: 'provider_error', 4022: 'unauthorized_client',
  4042: 'mfa_phone_required', 4045: 'login_type_disabled'
}

const AUTH_ERROR_CATEGORY_CODE: Record<string, string> = {
  PROVIDER_NOT_ENABLED: 'cloud_auth_provider_not_enabled',
  INVALID_CREDENTIALS: 'cloud_auth_invalid_credentials',
  USER_NOT_FOUND: 'cloud_auth_user_not_found',
  USER_STATUS_ABNORMAL: 'cloud_auth_user_status_abnormal',
  SERVICE_ERROR: 'cloud_auth_service_error',
  INVALID_PARAMS: 'cloud_auth_invalid_params',
  AUTH_METHOD_MISMATCH: 'cloud_auth_method_mismatch',
  RATE_LIMITED: 'cloud_auth_rate_limited',
  CAPTCHA_REQUIRED: 'cloud_auth_captcha_required',
  CAPTCHA_INVALID: 'cloud_auth_captcha_invalid',
  MFA_REQUIRED: 'cloud_auth_mfa_required',
  PRECONDITION_FAILED: 'cloud_auth_precondition_failed',
  VERIFICATION_FAILED: 'cloud_auth_verification_failed',
  UNKNOWN: 'cloud_auth_unknown_error'
}

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

/** Safely classify SDK AuthError metadata without exposing message, request ID, or credentials. */
function safeAuthErrorCode(root: ErrorRecord): string | null {
  if (root.name !== 'AuthError' && root.__isAuthError !== true) return null

  const stringCandidates = [root.code, root.status]
    .map(normalizedCodeCandidate)
    .map((code) => code && /^\d+$/.test(code) ? AUTH_ERROR_CODE_BY_NUMBER[Number(code)] || code : code)
    .filter((code): code is string => code !== null && code !== 'unknown' && code !== 'unknown_error')
  const numericCode = typeof root.errorCode === 'number' && Number.isInteger(root.errorCode)
    ? AUTH_ERROR_CODE_BY_NUMBER[root.errorCode]
    : null
  const candidates = [...stringCandidates, ...(numericCode ? [numericCode] : [])]
  if (new Set(candidates).size > 1) return 'cloud_auth_metadata_conflict'

  for (const candidate of candidates) {
    const code = safeCode(candidate)
    if (code) return code
  }

  const category = typeof root.category === 'string' ? AUTH_ERROR_CATEGORY_CODE[root.category] : null
  return category || null
}

/** Return only machine-readable CloudBase error metadata; never surface SDK messages or request bodies. */
export function safeCloudbaseErrorCode(value: unknown, fallback = 'cloud_unknown_error'): string {
  const root = asRecord(value)
  if (root) {
    const authCode = safeAuthErrorCode(root)
    if (authCode) return authCode
  }
  const candidates = [
    root?.code,
    root?.error_code,
    root?.errCode,
    root?.error,
    asRecord(root?.error)?.code,
    asRecord(root?.error)?.error_code,
    asRecord(root?.error)?.errCode,
    asRecord(root?.data)?.code,
    asRecord(root?.data)?.error_code,
    asRecord(root?.data)?.errCode,
    asRecord(root?.data)?.error,
    asRecord(root?.response)?.code,
    asRecord(root?.response)?.status,
    asRecord(asRecord(root?.response)?.data)?.code,
    asRecord(asRecord(root?.response)?.data)?.error_code,
    asRecord(root?.cause)?.code
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
): Promise<{ userId: string; database: Database; session: ExternalCloudbaseSession }> {
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

  // setSession refreshes and rotates credentials. Persist the returned pair instead of
  // keeping the now-invalid refresh token supplied by the caller.
  const sdkSession = result.data?.session
  if (typeof sdkSession?.access_token !== 'string' || !sdkSession.access_token ||
    typeof sdkSession.refresh_token !== 'string' || !sdkSession.refresh_token) {
    throw new Error('cloud_session_rotation_incomplete')
  }
  const rotatedSession: ExternalCloudbaseSession = {
    access_token: sdkSession.access_token,
    refresh_token: sdkSession.refresh_token
  }
  if (typeof sdkSession.expires_in === 'number' && Number.isFinite(sdkSession.expires_in) && sdkSession.expires_in > 0) {
    rotatedSession.expires_in = sdkSession.expires_in
  }
  if (sdkSession.expires_at instanceof Date || typeof sdkSession.expires_at === 'string' || typeof sdkSession.expires_at === 'number') {
    rotatedSession.expires_at = sdkSession.expires_at
  }

  return { userId: actualUserId, database: client.database(), session: rotatedSession }
}

/** Refresh once only for an explicit access-token-expired code, then bind and re-check UID. */
export async function bindCloudbaseUserDatabaseWithRefresh<Database>(
  client: CloudbaseUserSessionClient<Database>,
  session: ExternalCloudbaseSession,
  expectedUserId: string,
  refreshTokens: () => Promise<ExternalCloudbaseSession>
): Promise<{ userId: string; database: Database; session: ExternalCloudbaseSession }> {
  try {
    return await bindCloudbaseUserDatabase(client, session, expectedUserId)
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
  return await bindCloudbaseUserDatabase(client, refreshed, expectedUserId)
}
