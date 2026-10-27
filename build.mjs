// Mesélő · összeállítás: node build.mjs
//
//   docs/          – a telepíthető webapp (PWA), ezt szolgálja ki a GitHub Pages
//   dist/test.html – helyi tesztoldal ugyanazzal a kóddal (a tesztek ezt használják)
//
// Előfeltétel: vendor/imre/hu_HU-imre-medium.onnx (letöltés: scripts/fetch-model.sh)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const at = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(at(p), 'utf8');
const guard = (s, name) => {
  if (/<\/script/i.test(s)) throw new Error(`${name}: tilos </script> a beágyazott kódban`);
  return s;
};
const stripMap = (s) => s.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');

const MODEL = './vendor/imre/hu_HU-imre-medium.onnx';
if (!existsSync(at(MODEL))) throw new Error(`Hiányzik a hangmodell: ${MODEL} (futtasd: sh scripts/fetch-model.sh)`);

// ── Beépített hang: worker, ONNX Runtime, espeak-ng, Imre hangmodellje darabokban ──
function buildTts(dir) {
  rmSync(at(dir), { recursive: true, force: true });
  mkdirSync(at(dir + 'imre/'), { recursive: true });
  writeFileSync(at(dir + 'worker.mjs'), read('./tts/worker.mjs'));
  writeFileSync(at(dir + 'ort.wasm.min.mjs'), stripMap(read('./vendor/ort/ort.wasm.min.mjs')));
  writeFileSync(at(dir + 'ort-wasm-simd-threaded.mjs'), stripMap(read('./vendor/ort/ort-wasm-simd-threaded.mjs')));
  copyFileSync(at('./vendor/ort/ort-wasm-simd-threaded.wasm'), at(dir + 'ort-wasm-simd-threaded.wasm'));
  // az Emscripten-betöltő modulként, hogy a worker importálhassa
  writeFileSync(at(dir + 'piper_phonemize.mjs'), read('./vendor/phon/piper_phonemize.js') + '\nexport default createPiperPhonemize;\n');
  copyFileSync(at('./vendor/phon/piper_phonemize.wasm'), at(dir + 'piper_phonemize.wasm'));
  copyFileSync(at('./vendor/phon/piper_phonemize.data'), at(dir + 'piper_phonemize.data'));

  const voice = JSON.parse(read('./vendor/imre/hu_HU-imre-medium.onnx.json'));
  writeFileSync(at(dir + 'imre/config.json'), JSON.stringify({
    audio: voice.audio, espeak: voice.espeak, inference: voice.inference, phoneme_id_map: voice.phoneme_id_map,
  }));
  // 13 MB-os darabok: kisebb letöltési egységek, és minden tárhely elfogadja őket
  const PART = 13 * 1024 * 1024;
  const model = readFileSync(at(MODEL));
  const parts = [];
  for (let o = 0, k = 1; o < model.length; o += PART, k++) {
    const path = `imre/model-${k}.bin`;
    writeFileSync(at(dir + path), model.subarray(o, Math.min(o + PART, model.length)));
    parts.push({ part: k, path, size: Math.min(PART, model.length - o) });
  }
  const size = (p) => statSync(at(dir + p)).size;
  return {
    cache: 'meselo-hang-v2',
    config: 'imre/config.json',
    files: [
      { name: 'ortWasm', path: 'ort-wasm-simd-threaded.wasm', size: size('ort-wasm-simd-threaded.wasm') },
      { name: 'phonWasm', path: 'piper_phonemize.wasm', size: size('piper_phonemize.wasm') },
      { name: 'phonData', path: 'piper_phonemize.data', size: size('piper_phonemize.data') },
      ...parts,
    ],
  };
}

// ── Az oldal két része: a fej (cím, betűk, stílus) és a törzs (felület, kód) ──
function pageParts(manifest, site) {
  const page = read('./src/page.html')
    .replace('/*@@CSS@@*/', () => read('./src/style.css'))
    .replace('/*@@TTS@@*/', () => `window.MESELO_TTS = ${JSON.stringify(manifest)};${site ? '\nwindow.MESELO_SITE = true;' : ''}`)
    .replace('/*@@HUTEXT@@*/', () => guard(read('./src/hutext.js'), 'hutext.js'))
    .replace('/*@@EPUB@@*/', () => guard(read('./src/epub.js'), 'epub.js'))
    .replace('/*@@APP@@*/', () => guard(read('./src/app.js'), 'app.js'));
  if (/�/.test(page)) throw new Error('U+FFFD karakter az oldalban');
  const [head, body] = page.split('<!--@@BODY@@-->');
  return { head: head.replace(/<meta name="claude:[^>]*>\n?/, ''), body };
}

// a böngésző alapstílusa, amire az oldal épít
const RESET = ':root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}' +
  'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}';

function doc(head, body, extraHead = '') {
  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${extraHead}<style>${RESET}</style>
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
}

// ── Helyi tesztoldal ─────────────────────────────────────────────────────
mkdirSync(at('./dist/'), { recursive: true });
const testManifest = buildTts('./dist/tts/');
{
  const { head, body } = pageParts(testManifest, false);
  writeFileSync(at('./dist/test.html'), doc(head, body));
}

// ── A telepíthető webapp ─────────────────────────────────────────────────
const SITE = './docs/';
rmSync(at(SITE), { recursive: true, force: true });
mkdirSync(at(SITE + 'icons/'), { recursive: true });
const manifest = buildTts(SITE + 'tts/');
for (const f of ['favicon.svg', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) {
  copyFileSync(at(`./pwa/icons/${f}`), at(`${SITE}icons/${f}`));
}
writeFileSync(at(SITE + 'manifest.webmanifest'), JSON.stringify({
  id: './',
  name: 'Mesélő',
  short_name: 'Mesélő',
  description: 'EPUB-könyvek felolvasása természetes magyar hangon',
  lang: 'hu',
  dir: 'ltr',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#f1f2ec',
  theme_color: '#f1f2ec',
  categories: ['books', 'education'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
  file_handlers: [{ action: './', accept: { 'application/epub+zip': ['.epub'] } }],
  launch_handler: { client_mode: 'focus-existing' },
}, null, 2));

const { head, body } = pageParts(manifest, true);
const html = doc(head, body, `<meta name="description" content="EPUB-könyvek felolvasása természetes magyar hangon, telefonon és számítógépen is.">
<meta name="theme-color" content="#f1f2ec" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#11151d" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
`);
writeFileSync(at(SITE + 'index.html'), html);

// az app héja (a nagy hangfájlokat a hangmotor maga tárolja)
const SHELL = ['./', 'manifest.webmanifest', 'icons/favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'tts/worker.mjs', 'tts/ort.wasm.min.mjs', 'tts/ort-wasm-simd-threaded.mjs', 'tts/piper_phonemize.mjs', 'tts/imre/config.json'];
const version = createHash('sha256')
  .update(html)
  .update(SHELL.filter((p) => p.startsWith('tts/')).map((p) => readFileSync(at(SITE + p))).join(''))
  .digest('hex').slice(0, 12);
writeFileSync(at(SITE + 'sw.js'), read('./pwa/sw.js').replace('@@VERSION@@', version).replace('@@SHELL@@', JSON.stringify(SHELL)));
writeFileSync(at(SITE + '.nojekyll'), '');

const total = manifest.files.reduce((n, f) => n + f.size, 0);
console.log(`docs/index.html ${(html.length / 1024).toFixed(1)} KB · hang ${(total / 1048576).toFixed(1)} MB · verzió ${version}`);
