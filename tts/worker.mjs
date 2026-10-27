/*! Mesélő · beépített neurális hang (Piper VITS) a böngészőben
 *  Fonémák: piper-phonemize / espeak-ng (WASM) · Hangmodell: ONNX Runtime Web (WASM, egy szál)
 */
import * as ort from './ort.wasm.min.mjs';
import createPiperPhonemize from './piper_phonemize.mjs';

const BASE = new URL('./', import.meta.url).href;
const CACHE_NAME = 'meselo-hang-v1';

let session = null;
let voiceCfg = null;
let phonModule = null; // lefordított WebAssembly.Module, minden híváshoz új példány
let phonData = null;
let initPromise = null;
let ready = false;
const queue = [];
let running = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

// ── Letöltés (Cache API-val, ha elérhető) ───────────────────────────────
async function openCache(name) {
  try { return await caches.open(name || CACHE_NAME); } catch (e) { return null; }
}

async function fetchBytes(url, cache, onBytes) {
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        onBytes(buf.byteLength);
        return buf;
      }
    } catch (e) { /* nincs gyorsítótár: letöltjük */ }
  }
  let res;
  try { res = await fetch(url, { credentials: 'same-origin' }); }
  catch (e) { throw Object.assign(new Error('network'), { code: 'net' }); }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${url}`), { code: 'net' });
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      onBytes(value.byteLength, true);
    }
    const all = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.byteLength; }
    buf = all.buffer;
  } else {
    buf = await res.arrayBuffer();
    onBytes(buf.byteLength);
  }
  if (cache) {
    try { await cache.put(url, new Response(buf.slice(0))); } catch (e) { /* tele a tárhely: nem gond */ }
  }
  return buf;
}

// ── Indítás ─────────────────────────────────────────────────────────────
async function init(manifest) {
  const cache = await openCache(manifest.cache);
  const total = manifest.files.reduce((n, f) => n + f.size, 0);
  let loaded = 0;
  let lastPost = 0;
  const onBytes = (n) => {
    loaded += n;
    const t = Date.now();
    if (t - lastPost > 120 || loaded >= total) {
      lastPost = t;
      post({ type: 'progress', loaded: Math.min(loaded, total), total });
    }
  };
  post({ type: 'progress', loaded: 0, total });

  const url = (p) => new URL(p, BASE).href;
  voiceCfg = await (await fetch(url(manifest.config))).json();

  // a „skip” bájtnyi fejléc csak a közzétételhez kell (lásd build.mjs)
  const body = (buf, f) => (f.skip ? buf.slice(f.skip) : buf);
  const bytes = {};
  for (const f of manifest.files.filter((x) => typeof x.part !== 'number')) bytes[f.name] = body(await fetchBytes(url(f.path), cache, onBytes), f);
  const parts = manifest.files.filter((x) => typeof x.part === 'number').sort((a, b) => a.part - b.part);
  const model = new Uint8Array(parts.reduce((n, f) => n + f.size - (f.skip || 0), 0));
  let off = 0;
  for (const f of parts) {
    const b = new Uint8Array(await fetchBytes(url(f.path), cache, onBytes), f.skip || 0);
    model.set(b, off);
    off += b.byteLength;
  }
  if (off !== model.byteLength) throw Object.assign(new Error('model size mismatch'), { code: 'net' });

  phonModule = await WebAssembly.compile(bytes.phonWasm);
  phonData = bytes.phonData;

  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = BASE;
  ort.env.wasm.wasmBinary = bytes.ortWasm;
  post({ type: 'stage', stage: 'compile' });
  session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  // bemelegítés: az első valódi mondat így már gyorsan szól
  await synth('Szia.', 1);
  ready = true;
  post({ type: 'ready', sampleRate: voiceCfg.audio.sample_rate });
  pump();
}

// ── Fonémák ─────────────────────────────────────────────────────────────
function phonemize(text) {
  return new Promise((resolve, reject) => {
    let out = '';
    createPiperPhonemize({
      print: (d) => { out += d; },
      printErr: () => {},
      noInitialRun: true,
      getPreloadedPackage: () => phonData.slice(0),
      locateFile: (u) => new URL(u, BASE).href,
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(phonModule, imports).then((inst) => done(inst, phonModule), reject);
        return {};
      },
    }).then((mod) => {
      try {
        mod.callMain(['-l', voiceCfg.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
        resolve(JSON.parse(out));
      } catch (e) { reject(e); }
    }, reject);
  });
}

// A piper-phonemize egy sorban adja vissza a mondatokat; a ^ … $ határok mentén bontjuk szét
function sentences(o) {
  const out = [];
  let k = 0, cur = -1;
  for (const id of o.phoneme_ids) {
    if (cur < 0) { if (id === 1) cur = 0; continue; }
    if (id === 2) {
      const n = (cur - 1) / 2;
      out.push(o.phonemes.slice(k, k + n).join(''));
      k += n;
      cur = -1;
      continue;
    }
    cur++;
  }
  return out;
}

// Az újabb espeak-ng (amivel a hangot tanították) „ʲ” siklóhangot tesz az i és a következő magánhangzó közé
const GLIDE = /i(?=[aɑeɛioøuy])/g;
const TARGET_RMS = 0.12; // kb. −18 dBFS

function toIds(ph) {
  const m = voiceCfg.phoneme_id_map;
  const ids = [...m['^'], ...m['_']];
  for (const c of Array.from(ph.normalize('NFD'))) {
    const v = m[c];
    if (!v) continue;
    ids.push(...v, ...m['_']);
  }
  ids.push(...m['$']);
  return ids;
}

// ── Felolvasás ──────────────────────────────────────────────────────────
async function synth(text, lengthScale, noise) {
  const inf = voiceCfg.inference;
  const ns = noise ? noise[0] : inf.noise_scale;
  const nw = noise ? noise[1] : inf.noise_w;
  const sr = voiceCfg.audio.sample_rate;
  const phon = await phonemize(text);
  const parts = [];
  for (const s of sentences(phon)) {
    const ids = toIds(s.replace(GLIDE, 'iʲ'));
    if (ids.length <= 4) continue;
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([ns, lengthScale, nw]), [3]),
    };
    const res = await session.run(feeds);
    const a = Float32Array.from(res.output.data);
    // egyforma hangerő minden mondatnál: a beszédrészek átlagos szintjére igazítunk, a csúcsokat korlátozzuk
    let peak = 0, sum = 0, cnt = 0;
    for (let i = 0; i < a.length; i++) {
      const v = Math.abs(a[i]);
      if (v > peak) peak = v;
      if (v > 0.02) { sum += a[i] * a[i]; cnt++; }
    }
    const rms = cnt ? Math.sqrt(sum / cnt) : 0;
    let g = rms > 1e-4 ? TARGET_RMS / rms : 0;
    if (peak * g > 0.95) g = 0.95 / peak;
    for (let i = 0; i < a.length; i++) a[i] *= g;
    parts.push(a);
  }
  const gap = Math.round(sr * 0.12 * lengthScale);
  const len = parts.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, parts.length - 1);
  const pcm = new Float32Array(Math.max(1, len));
  let o = 0;
  parts.forEach((p, i) => {
    if (i) o += gap;
    pcm.set(p, o);
    o += p.length;
  });
  // rövid ki- és beúsztatás, hogy ne pattanjon
  const fade = Math.min(Math.round(sr * 0.006), pcm.length >> 1);
  for (let i = 0; i < fade; i++) { const g = i / fade; pcm[i] *= g; pcm[pcm.length - 1 - i] *= g; }
  return { pcm, sampleRate: sr, phonemes: phon.phonemes.length };
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const t0 = performance.now();
      const r = await synth(job.text, job.lengthScale, job.noise);
      post({ type: 'audio', id: job.id, pcm: r.pcm, sampleRate: r.sampleRate, ms: performance.now() - t0 }, [r.pcm.buffer]);
    } catch (e) {
      post({ type: 'error', id: job.id, message: String((e && e.message) || e) });
    }
  }
  running = false;
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'init') {
    if (!initPromise) {
      initPromise = init(m.manifest).catch((e) => {
        initPromise = null;
        post({ type: 'fatal', code: (e && e.code) || 'engine', message: String((e && e.message) || e) });
      });
    }
  } else if (m.type === 'synth') {
    queue.push(m);
    if (ready) pump();
  } else if (m.type === 'flush') {
    const keep = new Set(m.keep || []);
    for (let i = queue.length - 1; i >= 0; i--) if (!keep.has(queue[i].id)) queue.splice(i, 1);
  }
};
