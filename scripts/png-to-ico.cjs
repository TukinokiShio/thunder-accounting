/**
 * 将 resources/icon.png 打包为 icon.ico。
 * ICO 格式：Header (6B) + DirEntry (16B) + PNG data
 */
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')
const { createHash } = require('crypto')

// 使用 sharp-cli 生成的 PNG 文件
const pngPath = join(__dirname, '..', 'resources', 'icon.png')
const icoPath = join(__dirname, '..', 'resources', 'icon.ico')

console.log('Reading icon.png...')
const png = readFileSync(pngPath)
console.log(`PNG size: ${png.length} bytes`)

// ICO header
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)  // reserved
header.writeUInt16LE(1, 2)  // type: ICO
header.writeUInt16LE(1, 4)  // count: 1

// ICO directory entry
const entry = Buffer.alloc(16)
const w = 256, h = 256
entry.writeUInt8(w >= 256 ? 0 : w, 0)  // width (0 = 256)
entry.writeUInt8(h >= 256 ? 0 : h, 1)  // height
entry.writeUInt8(0, 2)   // color count
entry.writeUInt8(0, 3)   // reserved
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bpp
entry.writeUInt32LE(png.length, 8)  // image size
entry.writeUInt32LE(6 + 16, 12)     // offset = header + entry

const ico = Buffer.concat([header, entry, png])
writeFileSync(icoPath, ico)
console.log(`✅ icon.ico created: ${ico.length} bytes`)
