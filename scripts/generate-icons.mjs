import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'icons', 'hephy_logo.png');
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const out = join(root, 'icons', `icon-${size}.png`);
  await sharp(src)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(out);
  console.log('wrote', out);
}
