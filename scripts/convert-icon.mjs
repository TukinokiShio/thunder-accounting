/**
 * 将 resources/icon-designs/01-闪电铜钱.svg 转换为 PNG 和 ICO。
 * 用法: node scripts/convert-icon.mjs
 */
import sharp from 'sharp'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SVG = join(ROOT, 'resources', 'icon-designs', '01-闪电铜钱.svg')
const ICON_PNG = join(ROOT, 'resources', 'icon.png')
const ICON_ICO = join(ROOT, 'resources', 'icon.ico')

async function main() {
  console.log('Converting SVG to PNG (512x512)...')
  const png512 = await sharp(SVG).resize(512, 512).png().toBuffer()
  writeFileSync(ICON_PNG, png512)
  console.log(`✅ icon.png (512x512) saved`)

  // 生成 256x256
  console.log('Generating 256x256...')
  const png256 = await sharp(png512).resize(256, 256).png().toBuffer()

  // ICO requires specific sizes. sharp can't output ICO directly,
  // but electron-builder can auto-generate ICO from icon.png.
  // For a proper .ico, we need at least 256x256 PNG embedded.
  // Write the 256x256 as PNG for fallback.
  const png256Path = join(ROOT, 'build', 'icon-256.png')
  if (!existsSync(dirname(png256Path))) mkdirSync(dirname(png256Path), { recursive: true })
  writeFileSync(png256Path, png256)
  console.log(`✅ build/icon-256.png saved`)

  // Use the 256x256 PNG and embed it in a minimal ICO container.
  // Simple ICO format: https://en.wikipedia.org/wiki/ICO_(file_format)
  const pngData = png256
  const icoHeader = Buffer.alloc(6)
  icoHeader.writeUInt16LE(0, 0)  // reserved
  icoHeader.writeUInt16LE(1, 2)  // type: ICO
  icoHeader.writeUInt16LE(1, 4)  // count: 1 image

  const dirEntry = Buffer.alloc(16)
  dirEntry.writeUInt8(256, 0)     // width (256 → 0 = 256 in ICO)
  dirEntry.writeUInt8(256, 1)     // height
  dirEntry.writeUInt8(0, 2)       // color palette
  dirEntry.writeUInt8(0, 3)       // reserved
  dirEntry.writeUInt16LE(1, 4)    // color planes
  dirEntry.writeUInt16LE(32, 6)   // bits per pixel
  dirEntry.writeUInt32LE(pngData.length, 8)  // image size
  dirEntry.writeUInt32LE(22, 12)  // offset (6 + 16 = 22)

  const ico = Buffer.concat([icoHeader, dirEntry, pngData])
  writeFileSync(ICON_ICO, ico)
  console.log(`✅ icon.ico saved`)

  console.log('\nDone! Icon files updated.')
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
