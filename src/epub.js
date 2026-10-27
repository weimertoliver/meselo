/*! Mesélő · EPUB-olvasó: ZIP, OPF, tartalomjegyzék, szövegkinyerés */
(function (root) {
  'use strict';

  class EpubError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

  const utf8 = new TextDecoder('utf-8');
  const sniff = new TextDecoder('windows-1252');

  // ── ZIP (központi könyvtár alapján) ───────────────────────────────────
  let pakoPromise = null;
  function loadPako() {
    if (root.pako) return Promise.resolve(root.pako);
    if (!pakoPromise) {
      pakoPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';
        s.onload = () => (root.pako ? resolve(root.pako) : reject(new EpubError('inflate')));
        s.onerror = () => reject(new EpubError('inflate'));
        document.head.appendChild(s);
      });
    }
    return pakoPromise;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'function') {
      try {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { /* nincs deflate-raw: pako jön */ }
    }
    const pako = await loadPako();
    return pako.inflateRaw(data);
  }

  async function unzip(buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const len = u8.length;
    if (len < 22) throw new EpubError('notzip');
    let eocd = -1;
    for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new EpubError('notzip');
    let count = dv.getUint16(eocd + 10, true);
    let cdOff = dv.getUint32(eocd + 16, true);
    if (cdOff === 0xffffffff || count === 0xffff) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z = Number(dv.getBigUint64(loc + 8, true));
        if (z + 56 <= len && dv.getUint32(z, true) === 0x06064b50) {
          count = Number(dv.getBigUint64(z + 32, true));
          cdOff = Number(dv.getBigUint64(z + 48, true));
        }
      }
    }
    const entries = new Map();
    let p = cdOff;
    for (let k = 0; k < count && p + 46 <= len; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      let csize = dv.getUint32(p + 20, true);
      let usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      let lho = dv.getUint32(p + 42, true);
      const name = utf8.decode(u8.subarray(p + 46, p + 46 + nlen));
      if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) {
        let q = p + 46 + nlen;
        const qe = q + xlen;
        while (q + 4 <= qe) {
          const id = dv.getUint16(q, true), sz = dv.getUint16(q + 2, true);
          if (id === 1) {
            let r = q + 4;
            if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(r, true)); r += 8; }
            if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(r, true)); r += 8; }
            if (lho === 0xffffffff) lho = Number(dv.getBigUint64(r, true));
            break;
          }
          q += 4 + sz;
        }
      }
      if (!name.endsWith('/')) entries.set(name, { name, flags, method, csize, lho });
      p += 46 + nlen + xlen + clen;
    }
    if (!entries.size) throw new EpubError('notzip');
    const lower = new Map();
    for (const n of entries.keys()) lower.set(n.toLowerCase(), n);
    const find = (n) => entries.get(n) || entries.get(lower.get(String(n || '').toLowerCase()));

    return {
      names: () => [...entries.keys()],
      has: (n) => !!find(n),
      async bytes(n) {
        const e = find(n);
        if (!e) return null;
        if (e.flags & 1) throw new EpubError('drm');
        const h = e.lho;
        if (h + 30 > len || dv.getUint32(h, true) !== 0x04034b50) throw new EpubError('notzip');
        const start = h + 30 + dv.getUint16(h + 26, true) + dv.getUint16(h + 28, true);
        const data = u8.subarray(start, start + e.csize);
        if (e.method === 0) return data;
        if (e.method === 8) return inflateRaw(data);
        throw new EpubError('notzip');
      },
      async text(n) {
        const b = await this.bytes(n);
        return b ? decodeText(b) : null;
      },
    };
  }

  // ── Kódolás: régi magyar e-könyvek gyakran ISO-8859-2 / Windows-1250 ──
  function decodeText(bytes) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8.decode(bytes.subarray(3));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    const head = sniff.decode(bytes.subarray(0, 1024));
    const m = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head) || /<meta[^>]*charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
    const label = (m ? m[1] : 'utf-8').toLowerCase();
    if (label === 'utf-8' || label === 'utf8') {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (e) { return new TextDecoder('windows-1250').decode(bytes); }
    }
    try { return new TextDecoder(label).decode(bytes); } catch (e) { return utf8.decode(bytes); }
  }

  // ── XML segédek ───────────────────────────────────────────────────────
  const hasErr = (d) => !d || d.getElementsByTagName('parsererror').length > 0;
  function parseXML(str) {
    if (str == null) return null;
    try {
      const d = new DOMParser().parseFromString(str, 'application/xml');
      if (!hasErr(d)) return d;
    } catch (e) { /* tovább */ }
    try { return new DOMParser().parseFromString(str, 'text/html'); } catch (e) { return null; }
  }
  function parseXHTML(str) {
    let d = null;
    try { d = new DOMParser().parseFromString(str, 'application/xhtml+xml'); } catch (e) { d = null; }
    if (hasErr(d)) d = new DOMParser().parseFromString(str, 'text/html');
    return d;
  }
  const lname = (el) => String(el.localName || el.nodeName || '').toLowerCase().replace(/^.*:/, '');
  function els(doc, name) {
    const out = [];
    for (const e of doc.getElementsByTagName('*')) if (lname(e) === name) out.push(e);
    return out;
  }
  const kids = (el, name) => [...el.children].filter((c) => lname(c) === name);
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

  // ── Útvonalak ─────────────────────────────────────────────────────────
  const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  function resolve(fromPath, href) {
    const h = String(href || '').trim();
    const i = h.indexOf('#');
    const raw = i < 0 ? h : h.slice(0, i);
    const frag = i < 0 ? '' : safeDecode(h.slice(i + 1));
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { path: null, frag };
    if (!raw) return { path: fromPath, frag };
    const parts = ((raw.startsWith('/') ? '' : dirOf(fromPath)) + safeDecode(raw)).split('/');
    const out = [];
    for (const seg of parts) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
    return { path: out.join('/'), frag };
  }

  // ── Szövegkinyerés ────────────────────────────────────────────────────
  const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details',
    'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
  const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'math', 'rt', 'rp', 'img', 'image', 'audio',
    'video', 'object', 'iframe', 'noscript', 'template', 'button', 'select', 'textarea', 'input', 'canvas', 'map',
    'embed', 'source', 'track', 'picture', 'link', 'meta']);
  const OPS = 'http://www.idpf.org/2007/ops';
  const typeOf = (el) => ((el.getAttribute('epub:type') || (el.getAttributeNS && el.getAttributeNS(OPS, 'type')) || '') +
    ' ' + (el.getAttribute('role') || '')).toLowerCase();
  const isNoteRef = (el) => /\b(?:noteref|doc-noteref)\b/.test(typeOf(el));
  const isNoteBody = (el) => /\b(?:footnotes?|endnotes?|rearnotes?|doc-footnote|doc-endnotes?|pagebreak|doc-pagebreak)\b/.test(typeOf(el));
  const isHidden = (el) => el.hasAttribute('hidden') || /display\s*:\s*none/i.test(el.getAttribute('style') || '');
  const MARK_BR = '';

  function isMarker(el, tag) {
    const t = el.textContent || '';
    if (tag === 'sup' && /^[\s\d*†‡§,.\-–[\]()]{1,8}$/.test(t)) return true;
    if (tag === 'a' && /#/.test(el.getAttribute('href') || '') && /^[\s\d*†‡[\]()]{1,6}$/.test(t)) return true;
    return false;
  }

  function containsBlock(el) {
    for (const c of el.children) {
      if (BLOCK.has(lname(c)) || containsBlock(c)) return true;
    }
    return false;
  }

  function cleanInline(t, fixHu) {
    let s = t.replace(/\s+/g, ' ')
      .replace(new RegExp(` ?${MARK_BR} ?`, 'g'), '\n')
      .replace(/\n{2,}/g, '\n')
      .replace(/^\n+|\n+$/g, '')
      .trim();
    if (fixHu) s = s.replace(/õ/g, 'ő').replace(/Õ/g, 'Ő').replace(/û/g, 'ű').replace(/Û/g, 'Ű');
    return s.normalize('NFC');
  }

  function extractBlocks(doc, fixHu) {
    const body = doc.body || doc.getElementsByTagName('body')[0] || doc.documentElement;
    const blocks = [];
    const ids = new Map();
    let pending = [];

    function inline(node, acc) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3 || n.nodeType === 4) { acc.t += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        const t = lname(n);
        if (SKIP.has(t) || isHidden(n) || isNoteBody(n)) continue;
        if (t === 'br') { acc.t += MARK_BR; continue; }
        if (isNoteRef(n) || isMarker(n, t)) continue;
        if (n.id) acc.ids.push(n.id);
        if (t === 'a' && n.getAttribute('name')) acc.ids.push(n.getAttribute('name'));
        inline(n, acc);
      }
    }

    function emit(type, acc, tag) {
      const text = cleanInline(acc.t, fixHu);
      if (!text) { pending.push(...acc.ids); return; }
      const idx = blocks.length;
      for (const id of pending.concat(acc.ids)) if (!ids.has(id)) ids.set(id, idx);
      pending = [];
      if (!/[\p{L}\p{N}]/u.test(text)) {
        if (blocks.length && blocks[blocks.length - 1].type === 'sep') blocks[blocks.length - 1].text = text;
        else blocks.push({ type: 'sep', text });
        return;
      }
      if (type === 'h') blocks.push({ type: 'h', level: /^h[12]$/.test(tag) ? 1 : 2, text });
      else blocks.push({ type: 'p', text });
    }

    function walk(container) {
      let acc = { t: '', ids: [] };
      const flush = () => {
        if (acc.t.trim()) emit('p', acc);
        else pending.push(...acc.ids);
        acc = { t: '', ids: [] };
      };
      for (const n of container.childNodes) {
        if (n.nodeType === 3 || n.nodeType === 4) { acc.t += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        const t = lname(n);
        if (SKIP.has(t) || isHidden(n) || isNoteBody(n)) continue;
        if (t === 'br') { acc.t += MARK_BR; continue; }
        const blockish = BLOCK.has(t) || containsBlock(n);
        if (!blockish) {
          if (isNoteRef(n) || isMarker(n, t)) continue;
          if (n.id) acc.ids.push(n.id);
          inline(n, acc);
          continue;
        }
        flush();
        if (n.id) pending.push(n.id);
        if (t === 'hr') {
          if (blocks.length && blocks[blocks.length - 1].type !== 'sep') blocks.push({ type: 'sep', text: '' });
          continue;
        }
        if (containsBlock(n)) { walk(n); continue; }
        const a = { t: '', ids: [] };
        inline(n, a);
        emit(/^h[1-6]$/.test(t) ? 'h' : 'p', a, t);
      }
      flush();
    }

    if (body) walk(body);
    for (const id of pending) if (!ids.has(id)) ids.set(id, Math.max(0, blocks.length - 1));
    while (blocks.length && blocks[0].type === 'sep') blocks.shift();
    return { blocks, ids };
  }

  // ── Tartalomjegyzék ───────────────────────────────────────────────────
  function parseNav(doc, navPath) {
    const navs = [...doc.getElementsByTagName('*')].filter((e) => lname(e) === 'nav');
    const nav = navs.find((n) => /\btoc\b/.test(typeOf(n))) || navs[0];
    if (!nav) return [];
    const ol = kids(nav, 'ol')[0] || [...nav.getElementsByTagName('*')].find((e) => lname(e) === 'ol');
    const out = [];
    (function walkOl(list, level) {
      if (!list) return;
      for (const li of kids(list, 'li')) {
        const a = [...li.children].find((c) => lname(c) === 'a' || lname(c) === 'span');
        const title = a ? clean(a.textContent) : '';
        const href = a && lname(a) === 'a' ? a.getAttribute('href') : null;
        if (title && href) { const r = resolve(navPath, href); out.push({ title, path: r.path, frag: r.frag, level }); }
        walkOl(kids(li, 'ol')[0], level + 1);
      }
    })(ol, 0);
    return out;
  }

  function parseNcx(doc, ncxPath) {
    const out = [];
    const navMap = els(doc, 'navmap')[0];
    (function walk(node, level) {
      if (!node) return;
      for (const np of kids(node, 'navpoint')) {
        const label = kids(np, 'navlabel')[0];
        const content = kids(np, 'content')[0];
        const title = label ? clean(label.textContent) : '';
        const src = content && content.getAttribute('src');
        if (title && src) { const r = resolve(ncxPath, src); out.push({ title, path: r.path, frag: r.frag, level }); }
        walk(np, level + 1);
      }
    })(navMap, 0);
    return out;
  }

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  const FONT_OBFUSCATION = /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/i;

  // ── Megnyitás ─────────────────────────────────────────────────────────
  async function open(buffer, opts) {
    const o = opts || {};
    const zip = await unzip(buffer);

    // DRM: tartalmi fájlok titkosítása (a betűtípus-elrejtés nem számít annak)
    const encrypted = new Set();
    const encXml = await zip.text('META-INF/encryption.xml');
    if (encXml) {
      const d = parseXML(encXml);
      if (d) {
        for (const ed of els(d, 'encrypteddata')) {
          const alg = (els(ed, 'encryptionmethod')[0] || ed).getAttribute('Algorithm') || '';
          const ref = els(ed, 'cipherreference')[0];
          const uri = ref && ref.getAttribute('URI');
          if (uri && !FONT_OBFUSCATION.test(alg)) encrypted.add(resolve('', uri).path);
        }
      }
    }
    const drmFiles = zip.has('META-INF/rights.xml') || zip.has('META-INF/license.lcpl');
    if ([...encrypted].some((p) => /\.x?html?$/i.test(p))) throw new EpubError('drm');

    let opfPath = null;
    const container = parseXML(await zip.text('META-INF/container.xml'));
    if (container) {
      const rf = els(container, 'rootfile').find((e) => /oebps-package|opf/i.test(e.getAttribute('media-type') || 'opf'));
      opfPath = rf && rf.getAttribute('full-path');
    }
    if (!opfPath || !zip.has(opfPath)) opfPath = zip.names().find((n) => /\.opf$/i.test(n)) || null;
    if (!opfPath) throw new EpubError('noopf');
    const opf = parseXML(await zip.text(opfPath));
    if (!opf) throw new EpubError('noopf');

    const meta = (name) => clean((els(opf, name)[0] || {}).textContent);
    const title = meta('title') || String(o.fileName || '').replace(/\.epub$/i, '') || 'Névtelen könyv';
    const author = els(opf, 'creator').slice(0, 3).map((e) => clean(e.textContent)).filter(Boolean).join(', ');
    const lang = meta('language');
    const identifier = meta('identifier');
    const fixHu = !lang || /^hu/i.test(lang);

    const manifest = new Map();
    for (const it of els(opf, 'item')) {
      const id = it.getAttribute('id'), href = it.getAttribute('href');
      if (!id || !href) continue;
      manifest.set(id, {
        id, path: resolve(opfPath, href).path,
        type: (it.getAttribute('media-type') || '').toLowerCase(),
        props: it.getAttribute('properties') || '',
      });
    }
    const spineEl = els(opf, 'spine')[0];
    const spine = els(opf, 'itemref').map((r) => ({
      idref: r.getAttribute('idref'), linear: (r.getAttribute('linear') || 'yes').toLowerCase() !== 'no',
    }));
    const items = [...manifest.values()];
    const navItem = items.find((i) => /\bnav\b/.test(i.props));
    const ncxItem = (spineEl && manifest.get(spineEl.getAttribute('toc'))) || items.find((i) => i.type === 'application/x-dtbncx+xml');
    let coverItem = items.find((i) => /\bcover-image\b/.test(i.props));
    if (!coverItem) {
      const cm = els(opf, 'meta').find((m) => (m.getAttribute('name') || '').toLowerCase() === 'cover');
      if (cm) coverItem = manifest.get(cm.getAttribute('content'));
    }
    if (!coverItem) coverItem = items.find((i) => /^image\//.test(i.type) && /cover/i.test(i.id + i.path));
    if (coverItem && !/^image\//.test(coverItem.type)) coverItem = null;

    let order = spine.filter((s) => s.linear);
    if (!order.length) order = spine;
    const chapters = [];
    const pathToChapter = new Map();
    const waiting = [];
    for (const s of order) {
      const item = manifest.get(s.idref);
      if (!item || !/html|xml/.test(item.type) || item === navItem) continue;
      if (encrypted.has(item.path)) throw new EpubError('drm');
      const bytes = await zip.bytes(item.path);
      if (!bytes) continue;
      const doc = parseXHTML(decodeText(bytes));
      const { blocks, ids } = extractBlocks(doc, fixHu);
      if (!blocks.some((b) => b.type !== 'sep')) { waiting.push(item.path); continue; }
      if (!chapters.length) {
        const sample = blocks.map((b) => b.text).join(' ').slice(0, 4000);
        const junk = (sample.match(/[\uFFFD\u0000-\u0008\u000E-\u001F]/g) || []).length;
        if (sample.length > 50 && junk / sample.length > 0.05) throw new EpubError('drm');
      }
      const idx = chapters.length;
      waiting.forEach((pth) => pathToChapter.set(pth, idx));
      waiting.length = 0;
      pathToChapter.set(item.path, idx);
      chapters.push({ path: item.path, blocks, ids, title: '' });
    }
    waiting.forEach((pth) => pathToChapter.set(pth, Math.max(0, chapters.length - 1)));
    if (!chapters.length) throw new EpubError(encXml || drmFiles ? 'drm' : 'notext');

    let raw = [];
    try {
      if (navItem) {
        const b = await zip.bytes(navItem.path);
        if (b) raw = parseNav(parseXHTML(decodeText(b)), navItem.path);
      }
      if (!raw.length && ncxItem) {
        const d = parseXML(await zip.text(ncxItem.path));
        if (d) raw = parseNcx(d, ncxItem.path);
      }
    } catch (e) { raw = []; }

    const toc = [];
    for (const e of raw) {
      if (!e.path || !pathToChapter.has(e.path)) continue;
      const ch = pathToChapter.get(e.path);
      const block = e.frag && chapters[ch].path === e.path ? (chapters[ch].ids.get(e.frag) || 0) : 0;
      toc.push({ title: e.title, ch, block, level: Math.min(e.level, 3) });
    }

    chapters.forEach((c, i) => {
      const fromToc = toc.filter((t) => t.ch === i).sort((a, b) => a.block - b.block || a.level - b.level)[0];
      const head = c.blocks.find((b) => b.type === 'h');
      c.title = (fromToc && fromToc.title) || (head && head.text.replace(/\n/g, ' ').slice(0, 90)) || `${i + 1}. szakasz`;
    });

    let cover = null;
    if (coverItem) {
      try {
        const b = await zip.bytes(coverItem.path);
        if (b) cover = new Blob([b], { type: coverItem.type });
      } catch (e) { cover = null; }
    }

    const chars = chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + (b.type === 'sep' ? 0 : b.text.length), 0), 0);
    return {
      id: 'b' + hash([identifier, title, author, chars].join('|')),
      title, author, lang,
      chapters: chapters.map((c) => ({ title: c.title, blocks: c.blocks })),
      toc: toc.length ? toc : chapters.map((c, i) => ({ title: c.title, ch: i, block: 0, level: 0 })),
      cover,
    };
  }

  root.Epub = { open, EpubError, _internal: { unzip, decodeText, extractBlocks, resolve } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
