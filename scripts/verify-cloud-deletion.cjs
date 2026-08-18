#!/usr/bin/env node

// Credential-free preflight for the durable account-deletion saga. Cloud-side
// collection and IAM checks are documented in cloudfunctions/README.md.
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const manifest = JSON.parse(read('cloudfunctions/deployment.manifest.json'))
const functions = manifest.functions || []
const requiredCollections = manifest.requiredCollections || []

function requireCheck(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${message}`)
  }
}

requireCheck(requiredCollections.some((item) => item.name === 'account_deletion_jobs' && item.requiredBeforeDeploy),
  'deployment manifest requires account_deletion_jobs')
requireCheck(functions.some((item) => item.name === 'delUser' && item.environmentVariables?.includes('CLOUDBASE_APIKEY')),
  'delUser declares its server-only API key requirement')
requireCheck(functions.some((item) => item.name === 'cleanupDeletedUsers' && item.trigger === 'timer' && item.public === false),
  'cleanupDeletedUsers remains a non-public timer worker')
requireCheck(read('cloudfunctions/delUser/index.js').includes("collection('account_deletion_jobs')"),
  'delUser writes a durable cleanup job before Auth deletion')
requireCheck(read('cloudfunctions/README.md').includes('Create the `account_deletion_jobs` collection'),
  'cloud-side collection creation is documented for deployers')

if (process.exitCode) process.exit(process.exitCode)
console.log('Cloud deletion preflight passed. Complete the CloudBase-console checks in cloudfunctions/README.md before deploying.')
