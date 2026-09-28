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
  } catch {
    throw new Error('cloud_session_rejected')
  }
  if (result.error) throw new Error('cloud_session_rejected')

  const actualUserId = result.data?.user?.id
  if (typeof actualUserId !== 'string' || !actualUserId || actualUserId !== expectedUserId) {
    throw new Error('cloud_session_uid_mismatch')
  }

  return { userId: actualUserId, database: client.database() }
}
