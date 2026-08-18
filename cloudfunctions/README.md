# CloudBase account-deletion deployment checklist

Before exposing `delUser`, complete every item below in the same CloudBase environment:

1. Create the `account_deletion_jobs` collection. `delUser` inserts a durable job before deleting Auth; without it the function deliberately returns `deletion_job_unavailable` and does **not** delete the account.
2. Give both `delUser` and `cleanupDeletedUsers` access to that collection and to the `bills`, `categories`, and `accounts` collections they clean up.
3. Set the `CLOUDBASE_APIKEY` environment variable for **both** functions in CloudBase. Do not put the value in this repository or the desktop application's `.env`.
4. Deploy `delUser` as the public HTTP function and `cleanupDeletedUsers` as the non-public five-minute timer function, as recorded in `deployment.manifest.json`.
5. Run `npm run verify:cloud-deletion` locally before deployment, then use a non-production test account to verify one `code: 0` or `code: 202` response.

`npm run verify:cloud-deletion` is intentionally a source/manifest preflight: it does not require or read production credentials. The CloudBase console checks in steps 1–4 remain mandatory because collection existence and function permissions are cloud-side state.
