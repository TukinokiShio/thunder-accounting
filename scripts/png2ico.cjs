const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PNG_PATH = path.join(ROOT, 'resources', 'icon.png');
const ICO_PATH = path.join(ROOT, 'resources', 'icon.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function generateIco() {
  const pngs = [];
  for (const size of SIZES) {
    const buf = await sharp(PNG_PATH)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pngs.push(buf);
  }

  const icoBuf = await toIco(pngs);
  fs.writeFileSync(ICO_PATH, icoBuf);
  console.log(`ICO generated: ${ICO_PATH} (${icoBuf.length} bytes, ${SIZES.length} sizes: ${SIZES.join(',')})`);
}

generateIco().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
