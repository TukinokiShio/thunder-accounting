const fs = require('fs')
const path = require('path')
const ROOT = 'E:/Code/BlackHorse/VibeCoding/记账app'
const RELEASE = path.join(ROOT, 'release', 'win-unpacked')
const OUT = 'E:/Code/BlackHorse/VibeCoding/记账app/雷霆记账app_exe'
const DEST = path.join(OUT, 'win-unpacked')

console.log('📋 复制到输出目录...')
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true })
}
fs.mkdirSync(DEST, { recursive: true })

function cpR(s, d) {
  for (const e of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, e.name)
    const dp = path.join(d, e.name)
    if (e.isDirectory()) cpR(sp, dp)
    else fs.copyFileSync(sp, dp)
  }
}
cpR(RELEASE, DEST)
console.log('✅ 复制完成')
