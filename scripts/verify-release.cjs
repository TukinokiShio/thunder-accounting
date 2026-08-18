#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { listPackage, extractFile } = require('@electron/asar')

const root = path.resolve(__dirname, '..')
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const unpackedArgIndex = process.argv.indexOf('--unpacked')
const unpackedDir = unpackedArgIndex >= 0
  ? path.resolve(process.argv[unpackedArgIndex + 1])
  : path.join(root, 'release', 'win-unpacked')

function fail(message) {
  console.error(`❌ ${message}`)
  process.exit(1)
}

function requireFile(filePath, label = filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`缺少${label}: ${filePath}`)
  }
}

const rendererDir = path.join(root, 'app-out', 'renderer')
requireFile(path.join(root, 'app-out', 'main', 'main.js'), 'main 产物')
requireFile(path.join(root, 'app-out', 'preload', 'index.mjs'), 'preload 产物')
requireFile(path.join(rendererDir, 'index.html'), 'renderer index.html')

const rendererAssetsDir = path.join(rendererDir, 'assets')
if (!fs.existsSync(rendererAssetsDir) || !fs.readdirSync(rendererAssetsDir).some((name) => {
  return fs.statSync(path.join(rendererAssetsDir, name)).isFile()
})) {
  fail(`缺少 renderer assets: ${rendererAssetsDir}`)
}

const asarPath = path.join(unpackedDir, 'resources', 'app.asar')
requireFile(path.join(unpackedDir, '雷霆记账.exe'), 'Windows 可执行文件')
requireFile(asarPath, 'app.asar')

const archiveEntries = new Set(listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/, '').replace(/\\/g, '/')))
for (const requiredEntry of [
  'app-out/main/main.js',
  'app-out/preload/index.mjs',
  'app-out/renderer/index.html',
  'package.json'
]) {
  if (!archiveEntries.has(requiredEntry)) {
    fail(`app.asar 缺少 ${requiredEntry}: ${asarPath}`)
  }
}

try {
  const packedPackage = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'))
  if (packedPackage.version !== sourcePackage.version) {
    fail(`app.asar 版本 ${packedPackage.version} 与源码 package.json 版本 ${sourcePackage.version} 不一致`)
  }
} catch (error) {
  fail(`无法读取 app.asar 内 package.json：${error.message}`)
}

if (!Array.from(archiveEntries).some((entry) => entry.startsWith('app-out/renderer/assets/'))) {
  fail(`app.asar 缺少 renderer assets: ${asarPath}`)
}

console.log('✅ 发布产物校验通过')
console.log(`   renderer: ${rendererDir}`)
console.log(`   unpacked: ${unpackedDir}`)
console.log(`   app.asar: ${asarPath}`)
console.log('   app.asar entries: app-out/main/main.js, app-out/preload/index.mjs, app-out/renderer/index.html, app-out/renderer/assets/*')
