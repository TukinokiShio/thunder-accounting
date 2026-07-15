// SVG to PNG converter using sharp
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.resolve(__dirname, '..', 'resources', 'icon-designs', '01-闪电铜钱.svg');
const pngPath = path.resolve(__dirname, '..', 'resources', 'icon.png');

async function convert() {
  const svgBuffer = fs.readFileSync(svgPath);
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(pngPath);
  console.log(`Converted: ${svgPath} -> ${pngPath}`);
}

convert().catch(err => {
  console.error('Conversion failed:', err.message);
  process.exit(1);
});
