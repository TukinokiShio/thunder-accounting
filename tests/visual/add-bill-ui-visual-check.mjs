import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidencePath = path.join(root, 'artifacts/visual-v1.16.4/visual-evidence.json')
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
const expected = [
  ['artifacts/visual-v1.16.4/screenshots/desktop-640-light-amount-final.png', 640, 900],
  ['artifacts/visual-v1.16.4/screenshots/desktop-1024-light-date-final.png', 1024, 900],
  ['artifacts/visual-v1.16.4/screenshots/desktop-1024-dark-category-final.png', 1024, 900],
  ['artifacts/visual-v1.16.4/screenshots/desktop-light-amount-final.png', 1440, 900],
  ['artifacts/visual-v1.16.4/screenshots/mobile-light-category-short-final.png', 390, 500],
]

function pngSize(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`not a PNG: ${filePath}`)
  }
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

for (const [relative, width, height] of expected) {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute)) throw new Error(`missing screenshot: ${relative}`)
  const actual = pngSize(absolute)
  if (actual[0] !== width || actual[1] !== height) {
    throw new Error(`${relative}: expected ${width}x${height}, got ${actual[0]}x${actual[1]}`)
  }
}

for (const item of [...(evidence.screenshots ?? []), ...(evidence.supplemental_screenshots ?? [])]) {
  const absolute = path.join(root, item.path)
  if (!fs.existsSync(absolute)) throw new Error(`evidence path missing: ${item.path}`)
  const [width, height] = pngSize(absolute)
  if (width !== item.viewport.width || height !== item.viewport.height) {
    throw new Error(`${item.path}: evidence viewport mismatch`)
  }
}

console.log(`PASS: ${expected.length} required screenshots and ${evidence.screenshots.length + evidence.supplemental_screenshots.length} evidence entries have verified PNG dimensions`)
