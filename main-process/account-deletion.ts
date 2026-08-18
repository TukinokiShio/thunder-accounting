/**
 * Normalizes the public delUser function response into stable IPC error keys.
 *
 * The function intentionally uses application-level codes (0/202) even when
 * its HTTP transport is 200, so callers must inspect both layers.
 */
export interface AccountDeletionResponse {
  code?: number
  message?: string
  cleanup_pending?: boolean
}

export function resolveAccountDeletionResponse(
  httpStatus: number,
  response: AccountDeletionResponse
): { cleanupPending: boolean } {
  const message = String(response.message || '').toLowerCase()
  if (message === 'deletion_job_unavailable') {
    throw new Error('account_delete_job_unavailable')
  }
  if (message === 'invalid_session') {
    throw new Error('account_delete_session_expired')
  }
  if (message === 'auth_delete_failed') {
    throw new Error('account_delete_verification_failed')
  }
  if (httpStatus === 401 || httpStatus === 403) {
    throw new Error('account_delete_session_expired')
  }
  if (httpStatus === 503 || httpStatus >= 500) {
    throw new Error('account_delete_service_unavailable')
  }
  const isSuccessHttpStatus = httpStatus >= 200 && httpStatus < 300
  if (isSuccessHttpStatus && response.code === 0) return { cleanupPending: false }
  if (isSuccessHttpStatus && response.code === 202) return { cleanupPending: true }
  throw new Error(`account_delete_failed: ${response.message || `HTTP ${httpStatus}`}`)
}
