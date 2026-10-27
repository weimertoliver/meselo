// Mesélő ikonok: királykék alapon fehér „ő”, a két ékezet szövegkiemelő-sárga
const sharp = require('/opt/npm-tools/node_modules/sharp');
const fs = require('fs');
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const BLUE = '#2341b0', YELLOW = '#ffd43c', WHITE = '#ffffff';
// a 24-es jel (kör + két ékezet) 512-es vásznon középre: befoglaló doboz x 6.4–17.6, y 2.9–20.8
function svg({ size = 512, rounded = true, scale = 16.8 }) {
  const tx = 256 - 12 * scale, ty = 256 - 11.4 * scale;
  const bg = rounded ? `<rect width="512" height="512" rx="112" fill="${BLUE}"/>` : `<rect width="512" height="512" fill="${BLUE}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${bg}
<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale})">
<circle cx="12" cy="15.2" r="5.6" fill="none" stroke="${WHITE}" stroke-width="2.1"/>
<path d="M10.9 1.9 9 6.6M16.4 1.9l-1.9 4.7" fill="none" stroke="${YELLOW}" stroke-width="2.5" stroke-linecap="round"/>
</g></svg>`;
}
(async () => {
  fs.writeFileSync(`${out}/favicon.svg`, svg({ rounded: true }));
  const png = (s, opts, file) => sharp(Buffer.from(svg(opts))).resize(s, s).png().toFile(`${out}/${file}`);
  await png(192, { rounded: true }, 'icon-192.png');
  await png(512, { rounded: true }, 'icon-512.png');
  await png(512, { rounded: false, scale: 13.5 }, 'maskable-512.png');
  await png(180, { rounded: false, scale: 14.5 }, 'apple-touch-icon.png');
  await png(32, { rounded: true }, 'favicon-32.png');
  console.log('ikonok kész:', fs.readdirSync(out).join(', '));
})();
