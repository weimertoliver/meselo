/*! Mesélő · felolvasó alkalmazás */
(function () {
  'use strict';

  const H = window.HuText;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const now = () => performance.now();
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const huNum = (x, min, max) => x.toLocaleString('hu-HU', { minimumFractionDigits: min, maximumFractionDigits: max });

  // ── Tárolás: privát ablakban, tiltott tárhellyel is működjön ─────────
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nincs tárhely */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nincs tárhely */ } },
  };

  const DB = {
    _db: null,
    open() {
      if (!this._db) {
        this._db = new Promise((resolve, reject) => {
          try {
            const r = indexedDB.open('meselo', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('books', { keyPath: 'id' });
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
            r.onblocked = () => reject(new Error('blocked'));
          } catch (e) { reject(e); }
        });
      }
      return this._db;
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('books', mode);
        const req = fn(tx.objectStore('books'));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async put(rec) { try { await this.run('readwrite', (s) => s.put(rec)); return true; } catch (e) { return false; } },
    async get(id) { try { return await this.run('readonly', (s) => s.get(id)); } catch (e) { return null; } },
    async all() { try { return (await this.run('readonly', (s) => s.getAll())) || []; } catch (e) { return []; } },
    async del(id) { try { await this.run('readwrite', (s) => s.delete(id)); } catch (e) { /* */ } },
    async clear() { try { await this.run('readwrite', (s) => s.clear()); } catch (e) { /* */ } },
  };

  // ── Állapot ───────────────────────────────────────────────────────────
  const NEURAL_ID = 'neural:imre';
  const DEFAULTS = { v: 2, voice: NEURAL_ID, rate: 1, pitch: 1, pause: 'mid', font: 1, showSpoken: true, dict: '', cps: 15, allVoices: false };
  const savedSettings = LS.get('meselo:settings', {});
  if ((savedSettings.v || 1) < 2) {
    // az első változat „automatikus” böngészőhangja helyett a beépített Imre hang az alapértelmezett
    if (!savedSettings.voice) savedSettings.voice = NEURAL_ID;
    savedSettings.v = 2;
  }
  const S = {
    set: Object.assign({}, DEFAULTS, savedSettings),
    book: null, ch: 0, segs: [], seg: 0,
    playing: false, token: 0, timer: 0, watchdog: 0, keep: 0, errors: 0,
    voice: null, huVoices: [], allVoices: [],
    curEl: null, userScrollAt: -1e9, wl: null, coverUrl: null,
    sleep: { mode: 'off', minutes: 0, until: 0 }, sleepTick: 0,
    dict: [],
  };
  S.dict = H.compileDict(S.set.dict);
  const saveSettings = () => LS.set('meselo:settings', S.set);

  const synth = (() => { try { return window.speechSynthesis || null; } catch (e) { return null; } })();
  const canSpeak = !!(synth && typeof window.SpeechSynthesisUtterance === 'function');

  const PAUSE = { sent: 160, line: 420, head: 950, sep: 1400, para: { short: 300, mid: 650, long: 1100 } };
  const pauseMs = (kind) => Math.round((kind === 'para' ? (PAUSE.para[S.set.pause] || 650) : (PAUSE[kind] || 200)) / clamp(S.set.rate, 0.5, 2));

  // 16 bites, egycsatornás WAV a mondat hangjából és a mögé tett csendből
  function wavBlob(pcm, sr, trailMs) {
    const n = pcm.length + Math.round((sr * (trailMs || 0)) / 1000);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const tag = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE');
    tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    tag(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0, o = 44; i < pcm.length; i++, o += 2) {
      const x = pcm[i] < -1 ? -1 : pcm[i] > 1 ? 1 : pcm[i];
      v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ── Beépített neurális hang (Imre): a böngészőben fut, egy Web Workerben ──
  const Neural = {
    manifest: window.MESELO_TTS || null,
    worker: null,
    state: 'idle', // idle | loading | ready | failed
    stage: 'download',
    loaded: 0,
    total: 0,
    error: null,
    readyPromise: null,
    audio: null, // minden mondat ugyanazon a médiaelemen szól: így zárolt képernyővel is megy, és nem torzul
    url: '',
    cur: 0,
    seq: 0,
    unlocked: false,
    nextId: 1,
    jobs: new Map(),
    cache: new Map(),
    get available() {
      return !!(this.manifest && typeof Worker === 'function' && typeof WebAssembly === 'object' && typeof Audio === 'function');
    },
    get totalMB() {
      return this.manifest ? Math.round(this.manifest.files.reduce((n, f) => n + f.size, 0) / 1048576) : 0;
    },
    el() {
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.preload = 'auto';
        this.audio.setAttribute('playsinline', '');
      }
      return this.audio;
    },
    // a kattintáson belül egy rövid csenddel engedélyezzük a lejátszást (a későbbi mondatokhoz már nem kell kattintás)
    unlock() {
      if (this.unlocked || this.cur) return;
      const a = this.el();
      try {
        this.silent = this.silent || URL.createObjectURL(wavBlob(new Float32Array(2205), 22050, 0));
        a.src = this.silent;
        const p = a.play();
        if (p && p.then) p.then(() => { this.unlocked = true; }, () => {});
      } catch (e) { /* */ }
    },
    start() {
      if (this.state === 'ready') return Promise.resolve();
      if (this.state === 'failed') return Promise.reject(this.error);
      if (this.readyPromise) return this.readyPromise;
      this.state = 'loading';
      this.stage = 'download';
      renderEngine();
      this.readyPromise = new Promise((resolve, reject) => {
        const fail = (code, msg) => {
          if (this.state === 'failed') return;
          this.state = 'failed';
          this.error = { code, message: msg };
          this.readyPromise = null;
          try { if (this.worker) this.worker.terminate(); } catch (e) { /* */ }
          this.worker = null;
          for (const j of this.jobs.values()) j.reject({ code });
          this.jobs.clear();
          this.cache.clear();
          renderEngine();
          reject(this.error);
        };
        let w;
        try { w = new Worker(new URL('tts/worker.mjs', document.baseURI), { type: 'module' }); }
        catch (e) { fail('engine', String(e && e.message)); return; }
        this.worker = w;
        w.onerror = (ev) => { try { ev.preventDefault(); } catch (e) { /* */ } fail('engine', ev && ev.message); };
        w.onmessageerror = () => fail('engine', 'messageerror');
        w.onmessage = (ev) => {
          const m = ev.data || {};
          if (m.type === 'progress') { this.loaded = m.loaded; this.total = m.total; renderEngine(); }
          else if (m.type === 'stage') { this.stage = m.stage; renderEngine(); }
          else if (m.type === 'ready') { this.state = 'ready'; renderEngine(); resolve(); }
          else if (m.type === 'fatal') fail(m.code || 'engine', m.message);
          else if (m.type === 'audio' || m.type === 'error') {
            const j = this.jobs.get(m.id);
            if (!j) return;
            this.jobs.delete(m.id);
            if (m.type === 'error') { j.reject({ code: 'synth', message: m.message }); return; }
            if (window.__meseloStats) window.__meseloStats.push({ ms: m.ms, sec: m.pcm.length / m.sampleRate });
            j.resolve({ pcm: m.pcm, sampleRate: m.sampleRate, sec: m.pcm.length / m.sampleRate, ms: m.ms });
          }
        };
        w.postMessage({ type: 'init', manifest: this.manifest });
      });
      return this.readyPromise;
    },
    get(text) {
      const key = `${S.set.rate}|${text}`;
      let p = this.cache.get(key);
      if (p) { this.cache.delete(key); this.cache.set(key, p); return p; }
      p = new Promise((resolve, reject) => {
        const id = this.nextId++;
        this.jobs.set(id, { resolve, reject, key });
        this.worker.postMessage({ type: 'synth', id, text, lengthScale: 1 / clamp(S.set.rate, 0.5, 2) });
      });
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key); });
      this.cache.set(key, p);
      while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
      return p;
    },
    flush(keepTexts) {
      if (!this.worker) return;
      const keepKeys = new Set((keepTexts || []).map((t) => `${S.set.rate}|${t}`));
      const keepIds = [];
      for (const [id, j] of this.jobs) {
        if (keepKeys.has(j.key)) { keepIds.push(id); continue; }
        this.jobs.delete(id);
        if (this.cache.get(j.key)) this.cache.delete(j.key);
        j.reject({ code: 'canceled' });
      }
      this.worker.postMessage({ type: 'flush', keep: keepIds });
    },
    clearCache() { this.flush([]); this.cache.clear(); },
    // egy mondat a mögé tett szünettel együtt egy WAV-fájlként szól
    play(item, trailMs, onend, onfail) {
      this.stopSource();
      const a = this.el();
      const id = ++this.seq;
      this.cur = id;
      this.url = URL.createObjectURL(wavBlob(item.pcm, item.sampleRate, trailMs));
      const done = (ok, err) => {
        if (this.cur !== id) return;
        this.cur = 0;
        this.release();
        if (ok) onend(); else if (onfail) onfail(err);
      };
      a.onended = () => done(true);
      a.onerror = () => done(false, a.error);
      a.src = this.url;
      try {
        const p = a.play();
        if (p && p.catch) p.catch((e) => { if (!(e && e.name === 'AbortError')) done(false, e); });
      } catch (e) { done(false, e); }
    },
    stopSource() {
      this.cur = 0;
      const a = this.audio;
      if (a) { a.onended = null; a.onerror = null; try { a.pause(); } catch (e) { /* */ } }
      this.release();
    },
    release() { if (this.url) { URL.revokeObjectURL(this.url); this.url = ''; } },
    pauseNow() { if (this.audio) { try { this.audio.pause(); } catch (e) { /* */ } } },
    resumeNow() {
      if (!this.audio) return;
      try { const p = this.audio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* */ }
    },
    async isCached() {
      if (!this.manifest || typeof caches === 'undefined') return false;
      try {
        const c = await caches.open(this.manifest.cache);
        const last = this.manifest.files[this.manifest.files.length - 1];
        return !!(await c.match(new URL('tts/' + last.path, document.baseURI).href));
      } catch (e) { return false; }
    },
  };
  const useNeural = () => S.set.voice === NEURAL_ID && Neural.available && Neural.state !== 'failed';
  const canPlay = () => useNeural() || canSpeak;

  // ── Mintakönyv ────────────────────────────────────────────────────────
  function sampleBook() {
    const p = (text, cls) => ({ type: 'p', text, cls });
    const label = (text) => ({ type: 'h', level: 3, text });
    const h1 = (text) => ({ type: 'h', level: 1, text });
    const h2 = (text) => ({ type: 'h', level: 2, text });
    const chapters = [
      { title: 'Így működik', blocks: [
        label('Első fejezet'), h1('Így működik'),
        p('Ez egy rövid mintakönyv. Nyomd meg a lejátszás gombot, és a Mesélő mondatról mondatra felolvassa, a kiemelő pedig mindig ott jár, ahol a hang.'),
        p('Ha bármelyik mondatra rákattintasz, onnan folytatja. A nyilakkal mondatonként léptethetsz, a szóköz pedig elindítja és megállítja a felolvasást.'),
        p('Saját könyvet a Könyvtár gombbal nyithatsz meg, vagy egyszerűen húzd rá az EPUB-fájlt erre az oldalra. A könyv nem töltődik fel sehová: a felolvasás a böngésződben történik, és a Mesélő megjegyzi, hol hagytad abba.'),
        p('A felolvasó Imre hangján szól. Ez a hang a böngésződben fut, ezért bármelyik böngészőben és telefonon ugyanígy hangzik. Első indításkor egyszer le kell tölteni (kb. 72 MB), utána internet nélkül is működik. A Beállításokban a böngésző saját hangjai közül is választhatsz, és ott állíthatod a tempót is.'),
      ] },
      { title: 'Számok és rövidítések', blocks: [
        label('Második fejezet'), h1('Számok és rövidítések'),
        p('A számokat, a dátumokat és a rövidítéseket nem úgy mondjuk ki, ahogy leírjuk. A Mesélő felolvasás előtt átírja őket, a lejátszó fölötti sorban pedig azt is látod, pontosan mit mond.'),
        p('1848. március 15-én reggel a pesti ifjak a Pilvax kávéházból indultak el, és délre a 12 pontot már az egész város ismerte.'),
        p('XIV. Lajos 72 évig uralkodott, ami a 17–18. században is ritkaságnak számított.'),
        p('Dr. Kovács Éva kb. 3,5 km-re lakik a II. kerülettől, de a 8:30-kor induló busszal 20 perc alatt beér.'),
        p('A könyv ára 4 990 Ft volt, de 25%-kal olcsóbban, 3 742 forintért vettem meg.'),
        p('Az ún. tihanyi alapítólevél Kr. u. 1055-ből való; ez a legrégebbi olyan fennmaradt oklevél, amelyben magyar szavak is olvashatók.'),
        p('A 2000-es évek elején még kazettáról hallgattuk a hangoskönyveket, ma már 2 kattintás az egész.'),
      ] },
      { title: 'Párbeszéd', blocks: [
        label('Harmadik fejezet'), h1('Párbeszéd'),
        p('A magyar könyvekben a párbeszédet gondolatjel vezeti be. A Mesélő ezeket nem mondja ki, csak rövid szünetet tart, ahogy egy jó felolvasó is tenné.'),
        p('– Hallod ezt? – kérdezte Anna, és letette a könyvet.'),
        p('– Hallom – felelte a nagyapja. – Mintha valaki a szomszéd szobában olvasna fel.'),
        p('– Pedig csak a gép az. Azt mondtam neki, hogy a gondolatjeleknél tartson szünetet.'),
        p('– Ügyes gép – nevetett az öreg. – Kérdezd meg, tud-e verset is mondani!'),
      ] },
      { title: 'Egy vers', blocks: [
        label('Negyedik fejezet'), h1('Egy vers'),
        p('Versnél a sorok végén is megáll egy pillanatra, ahogy a költő tördelte.'),
        h2('Petőfi Sándor: Szeptember végén (részlet)'),
        p(['Még nyílnak a völgyben a kerti virágok,', 'Még zöldel a nyárfa az ablak előtt,',
          'De látod amottan a téli világot?', 'Már hó takará el a bérci tetőt.',
          'Még ifjú szivemben a lángsugarú nyár', 'S még benne virít az egész kikelet,',
          'De íme sötét hajam őszbe vegyül már,', 'A tél dere már megüté fejemet.'].join('\n')),
        p('Koltó, 1847. szeptember', 'dateline'),
      ] },
    ];
    return {
      id: 'sample', isSample: true, title: 'Ismerkedés a Mesélővel', author: 'Bemutató', lang: 'hu',
      chapters, toc: chapters.map((c, i) => ({ title: c.title, ch: i, block: 0, level: 0 })), cover: null,
    };
  }

  // ── Könyv előkészítése ────────────────────────────────────────────────
  function prepareBook(book) {
    let start = 0;
    book.chapters.forEach((c) => {
      let cum = 0;
      c.blockCum = c.blocks.map((b) => { const v = cum; if (b.type !== 'sep') cum += b.text.length; return v; });
      c.chars = cum;
      c.start = start;
      start += cum;
    });
    book.total = Math.max(1, start);
    book.toc.forEach((e) => { const c = book.chapters[e.ch]; e.pos = c.start + (c.blockCum[e.block] || 0); });
    book.tocSorted = book.toc.slice().sort((a, b) => a.pos - b.pos);
    return book;
  }

  const curPos = () => {
    if (!S.book) return 0;
    const c = S.book.chapters[S.ch];
    const sg = S.segs[S.seg];
    return c.start + (sg ? sg.cum : 0);
  };
  function currentEntry(pos) {
    let cur = null;
    for (const e of S.book.tocSorted) { if (e.pos <= pos + 0.5) cur = e; else break; }
    return cur || S.book.tocSorted[0] || null;
  }
  const secsFor = (chars) => chars / (clamp(S.set.cps, 6, 40) * S.set.rate);
  function fmtDur(sec, approx) {
    if (sec < 45) return approx ? 'kevesebb mint 1 perc' : '< 1 perc';
    const m = Math.round(sec / 60);
    const pre = approx ? 'kb. ' : '';
    if (m < 60) return `${pre}${m} perc`;
    const h = Math.floor(m / 60), mm = m % 60;
    return `${pre}${h} óra${mm ? ' ' + mm + ' perc' : ''}`;
  }

  // ── Megjelenítés ──────────────────────────────────────────────────────
  function appendGap(el, gap) {
    gap.split('\n').forEach((t, i) => {
      if (i) el.appendChild(document.createElement('br'));
      if (t) el.appendChild(document.createTextNode(t));
    });
  }

  function renderChapter() {
    const chap = S.book.chapters[S.ch];
    const art = $('#chapter');
    art.textContent = '';
    const frag = document.createDocumentFragment();
    const segs = [];
    chap.blocks.forEach((b, bi) => {
      let el;
      if (b.type === 'h') {
        el = document.createElement(b.level === 1 ? 'h2' : 'h3');
        el.className = b.level === 1 ? 'h1' : b.level === 3 ? 'h3' : 'h2';
      } else el = document.createElement('p');
      if (b.type === 'sep') {
        el.className = 'sep';
        el.textContent = b.text || '* * *';
        segs.push({ b: bi, text: '', kind: 'sep', pause: 'sep', el, cum: chap.blockCum[bi] });
        frag.appendChild(el);
        return;
      }
      if (b.text.includes('\n')) el.classList.add('verse');
      if (b.cls) el.classList.add(b.cls);
      const parts = H.segmentBlock(b.text);
      let pos = 0;
      parts.forEach((r, k) => {
        if (r.s > pos) appendGap(el, b.text.slice(pos, r.s));
        const span = document.createElement('span');
        span.className = 's';
        span.dataset.k = String(segs.length);
        span.textContent = b.text.slice(r.s, r.e);
        el.appendChild(span);
        const last = k === parts.length - 1;
        segs.push({
          b: bi, text: span.textContent, kind: b.type, el, cum: chap.blockCum[bi] + r.s,
          pause: last ? (b.type === 'h' ? 'head' : 'para') : (r.lineEnd ? 'line' : 'sent'),
        });
        segs[segs.length - 1].el = span;
        pos = r.e;
      });
      if (pos < b.text.length) appendGap(el, b.text.slice(pos));
      frag.appendChild(el);
    });
    art.appendChild(frag);
    S.segs = segs;
    S.curEl = null;

    const n = S.book.chapters.length;
    $('#runHead').innerHTML = '';
    const rb = document.createElement('b');
    rb.textContent = S.book.title;
    const rc = document.createElement('span');
    rc.textContent = n > 1 ? `${S.ch + 1}. rész / ${n}` : '';
    $('#runHead').append(rb, rc);
    const prev = S.book.chapters[S.ch - 1], next = S.book.chapters[S.ch + 1];
    $('#prevChap').hidden = !prev;
    $('#nextChap').hidden = !next;
    $('#prevChapTitle').textContent = prev ? prev.title : '';
    $('#nextChapTitle').textContent = next ? next.title : '';
    $('#chapNav').hidden = !prev && !next;
  }

  function renderHeader() {
    const b = S.book;
    $('#nbTitle').textContent = b.title;
    $('#nbAuthor').textContent = b.author || '';
    $('#sampleBadge').hidden = !b.isSample;
    document.title = b.isSample ? 'Mesélő felolvasó' : `${b.title} · Mesélő`;
  }

  function visibleBand() {
    const top = $('#topbar').getBoundingClientRect().bottom;
    const bottom = $('#player').getBoundingClientRect().top;
    return { top, bottom: Math.max(top + 80, bottom) };
  }

  function updateFollow() {
    const btn = $('#followBtn');
    if (!S.playing || !S.curEl) { btn.hidden = true; return; }
    const r = S.curEl.getBoundingClientRect();
    const { top, bottom } = visibleBand();
    btn.hidden = !(r.bottom < top || r.top > bottom);
  }

  function followScroll(el, opt) {
    if (!opt.force && now() - S.userScrollAt < 5000) { updateFollow(); return; }
    const behavior = opt.instant || reducedMotion() ? 'auto' : 'smooth';
    if (opt.force && S.seg === 0) { window.scrollTo({ top: 0, behavior }); updateFollow(); return; }
    const r = el.getBoundingClientRect();
    const { top, bottom } = visibleBand();
    const h = bottom - top;
    if (opt.force || r.top < top + 8 || r.bottom > bottom - h * 0.18) {
      const y = window.scrollY + r.top - top - Math.min(h * 0.3, 170);
      window.scrollTo({ top: Math.max(0, y), behavior });
    }
    updateFollow();
  }

  function highlight(k, o) {
    const opt = o || {};
    if (S.curEl) S.curEl.classList.remove('cur');
    const sg = S.segs[k];
    S.curEl = sg ? sg.el : null;
    if (S.curEl && sg.kind !== 'sep') S.curEl.classList.add('cur');
    if (S.curEl) followScroll(S.curEl, opt);
    showSpoken(sg && sg.kind !== 'sep' ? H.normalizeForSpeech(sg.text, { dict: S.dict }) : '');
    updateProgress();
  }

  function showSpoken(text) {
    if (text !== undefined) S.spokenText = text;
    const loading = useNeural() && Neural.state === 'loading' && S.waiting;
    $('#spoken').hidden = !S.set.showSpoken && !loading;
    $('#spokenLabel').textContent = loading ? 'Betöltés' : 'Kimondva';
    $('#spokenText').textContent = loading ? loadingText() : (S.spokenText || '…');
  }

  let saveT = 0;
  function savePos() {
    if (!S.book) return;
    const all = LS.get('meselo:pos', {});
    all[S.book.id] = { ch: S.ch, seg: S.seg, pct: curPos() / S.book.total, t: Date.now() };
    LS.set('meselo:pos', all);
  }
  const savePosSoon = () => { clearTimeout(saveT); saveT = setTimeout(savePos, 700); };

  function updateProgress() {
    if (!S.book) return;
    const pos = curPos();
    const pct = clamp(pos / S.book.total, 0, 1);
    const pctTxt = `${Math.round(pct * 100)}%`;
    $('#seekFill').style.transform = `scaleX(${pct})`;
    const seek = $('#seek');
    seek.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
    seek.setAttribute('aria-valuetext', pctTxt);
    $('#pctLabel').textContent = pctTxt;
    $('#remainLabel').textContent = 'még ' + fmtDur(secsFor(S.book.total - pos), true);
    const e = currentEntry(pos);
    $('#chapLabel').textContent = e ? e.title : S.book.chapters[S.ch].title;
    updateMediaSession();
    S.book.toc.forEach((t) => {
      if (!t.el) return;
      t.el.classList.toggle('current', t === e);
      t.el.classList.toggle('read', !!e && t.pos < e.pos);
    });
    savePosSoon();
  }

  function renderToc() {
    const b = S.book;
    const ol = $('#tocList');
    ol.textContent = '';
    $('#tocBook').textContent = b.title;
    $('#tocSub').textContent = [b.author, 'teljes hossz: ' + fmtDur(secsFor(b.total), true)].filter(Boolean).join(' · ');
    const sorted = b.tocSorted;
    b.toc.forEach((e) => {
      const li = document.createElement('li');
      li.className = 'lvl' + Math.min(e.level || 0, 2);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toc-item';
      const t = document.createElement('span');
      t.className = 'toc-title';
      t.textContent = e.title;
      const d = document.createElement('span');
      d.className = 'toc-dur';
      const next = sorted[sorted.indexOf(e) + 1];
      const len = (next ? next.pos : b.total) - e.pos;
      d.textContent = len > 0 ? fmtDur(secsFor(len), false) : '';
      btn.append(t, d);
      btn.addEventListener('click', () => { goToEntry(e); closeDlg($('#tocDlg')); });
      li.appendChild(btn);
      ol.appendChild(li);
      e.el = btn;
    });
    updateProgress();
  }

  function openChapter(ch, seg, opt) {
    const o = opt || {};
    S.ch = clamp(ch, 0, S.book.chapters.length - 1);
    renderChapter();
    S.seg = clamp(seg || 0, 0, Math.max(0, S.segs.length - 1));
    if (o.top) window.scrollTo({ top: 0, behavior: 'auto' });
    highlight(S.seg, { force: true, instant: true });
  }

  function showBook(book, opt) {
    const o = opt || {};
    stop();
    if (S.coverUrl) { URL.revokeObjectURL(S.coverUrl); S.coverUrl = null; }
    S.book = prepareBook(book);
    if (book.cover) { try { S.coverUrl = URL.createObjectURL(book.cover); } catch (e) { S.coverUrl = null; } }
    if (o.remember !== false) LS.set('meselo:last', book.id);
    const p = LS.get('meselo:pos', {})[book.id];
    const ch = p && p.ch < book.chapters.length ? p.ch : 0;
    renderHeader();
    openChapter(ch, p ? p.seg : 0);
    renderToc();
  }

  // ── Felolvasás ────────────────────────────────────────────────────────
  function clearTimers() {
    clearTimeout(S.timer); clearTimeout(S.watchdog); clearInterval(S.keep);
    S.timer = S.watchdog = S.keep = 0;
  }
  function cancelSpeech() {
    S.pausedAt = null;
    S.waiting = false;
    Neural.stopSource();
    try { if (synth && (synth.speaking || synth.pending || synth.paused)) synth.cancel(); } catch (e) { /* */ }
  }

  function setPlayUi() {
    const b = $('#playBtn');
    const busy = S.playing && !!S.waiting;
    b.classList.toggle('on', S.playing);
    b.classList.toggle('busy', busy);
    b.setAttribute('aria-label', S.playing ? 'Szünet' : 'Felolvasás');
    b.setAttribute('aria-pressed', String(S.playing));
    b.setAttribute('aria-busy', String(busy));
    if (busy !== S.wasBusy) { S.wasBusy = busy; showSpoken(); }
    updateFollow();
    updateMediaSession();
  }

  // zárolt képernyő és értesítési sáv: cím, lejátszás, szünet, léptetés
  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !S.book || typeof MediaMetadata !== 'function') return;
    const e = currentEntry(curPos());
    const title = e ? e.title : S.book.title;
    const key = `${S.book.id}|${title}`;
    try {
      if (key !== S.msKey) {
        S.msKey = key;
        navigator.mediaSession.metadata = new MediaMetadata({
          title, artist: S.book.author || 'Mesélő', album: S.book.title,
          artwork: [{ src: new URL('icons/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }],
        });
      }
      navigator.mediaSession.playbackState = S.playing ? 'playing' : 'paused';
    } catch (err) { /* nem támogatott */ }
  }

  async function wake(on) {
    if (on && useNeural()) return;
    try {
      if (on && !S.wl && navigator.wakeLock) {
        S.wl = await navigator.wakeLock.request('screen');
        if (S.wl && S.wl.addEventListener) S.wl.addEventListener('release', () => { S.wl = null; });
      } else if (!on && S.wl) {
        const w = S.wl; S.wl = null; await w.release();
      }
    } catch (e) { S.wl = null; }
  }

  function play() {
    if (!canPlay()) { toast('Ez a böngésző nem tud felolvasni. Próbáld meg Microsoft Edge-ben vagy Chrome-ban.', 'error'); return; }
    if (S.playing || !S.segs.length) return;
    if (useNeural()) Neural.unlock(); // a hangot a kattintáson belül kell engedélyezni (iPhone)
    const p = S.pausedAt;
    if (p && p.token === S.token && p.ch === S.ch && p.seg === S.seg && Neural.cur) {
      // a beépített hang ott folytatja, ahol megállt, a mondat közepén is
      S.pausedAt = null;
      S.playing = true;
      Neural.resumeNow();
      setPlayUi();
      return;
    }
    S.pausedAt = null;
    S.playing = true;
    S.errors = 0;
    setPlayUi();
    wake(true);
    speakCurrent();
  }
  function stop() {
    S.playing = false;
    S.token++;
    clearTimers();
    cancelSpeech();
    setPlayUi();
    wake(false);
  }
  function pause() {
    if (S.playing && Neural.cur && useNeural()) {
      S.playing = false;
      S.pausedAt = { token: S.token, ch: S.ch, seg: S.seg };
      Neural.pauseNow();
      setPlayUi();
      wake(false);
      savePos();
      return;
    }
    stop();
    savePos();
  }
  const toggle = () => (S.playing ? pause() : play());

  function learnFrom(chars, secs) {
    if (secs < 1 || chars < 30) return;
    const cps = chars / secs;
    if (cps < 6 || cps > 40) return;
    S.set.cps = S.set.cps * 0.9 + cps * 0.1;
    S.learnN = (S.learnN || 0) + 1;
    if (S.learnN % 5 === 0) saveSettings();
  }
  function learn(sg, started) {
    if (!started) return;
    learnFrom(sg.text.length, ((now() - started) / 1000) * S.set.rate);
  }

  function finished(sg, my, delay) {
    clearTimeout(S.watchdog);
    clearInterval(S.keep);
    if (S.sleep.mode === 'time' && Date.now() >= S.sleep.until) {
      stop();
      setSleep('off', 0, true);
      if (S.seg + 1 < S.segs.length) { S.seg++; highlight(S.seg); }
      savePos();
      toast('Az elalvási időzítő leállította a felolvasást.');
      return;
    }
    const wait = delay === undefined ? pauseMs(sg.pause) : delay;
    if (wait <= 0) { advance(); return; }
    S.timer = setTimeout(() => { if (my === S.token) advance(); }, wait);
  }

  function arm(text, sg, my) {
    const est = (text.length / (clamp(S.set.cps, 6, 40) * S.set.rate)) * 1000;
    let tries = 0;
    const check = () => {
      if (my !== S.token) return;
      let busy = false;
      try { busy = synth.speaking || synth.pending; } catch (e) { busy = false; }
      if (busy && tries < 6) { tries++; S.watchdog = setTimeout(check, 3000); return; }
      if (busy) cancelSpeech();
      finished(sg, my); // elveszett „end” esemény: továbblépünk
    };
    S.watchdog = setTimeout(check, est * 2.2 + 5000);
  }

  function speakCurrent() {
    clearTimers();
    const my = ++S.token;
    const sg = S.segs[S.seg];
    if (!sg) { endOfChapter(); return; }
    highlight(S.seg);
    const text = sg.kind === 'sep' ? '' : H.normalizeForSpeech(sg.text, { dict: S.dict });
    if (!H.hasSpeakable(text)) {
      S.timer = setTimeout(() => { if (my === S.token) advance(); }, pauseMs(sg.kind === 'sep' ? 'sep' : sg.pause));
      return;
    }
    if (useNeural()) { speakNeural(text, sg, my); return; }
    if (!canSpeak) { stop(); toast('Ez a böngésző nem tud felolvasni. Válaszd a beépített Imre hangot a Beállításokban.', 'error'); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (S.voice && S.voice.lang) || 'hu-HU';
    if (S.voice) u.voice = S.voice;
    u.rate = S.set.rate;
    u.pitch = S.set.pitch;
    let started = 0;
    u.onstart = () => { if (my === S.token) started = now(); };
    u.onend = () => {
      if (my !== S.token) return;
      learn(sg, started);
      S.errors = 0;
      finished(sg, my);
    };
    u.onerror = (e) => {
      if (my !== S.token) return;
      const code = e && e.error;
      if (code === 'interrupted' || code === 'canceled') return;
      if (code === 'not-allowed') {
        pause();
        toast('A böngésző csak kattintás után enged felolvasni. Nyomd meg újra a lejátszás gombot.', 'error');
        return;
      }
      S.errors++;
      if (S.errors <= 2) { S.timer = setTimeout(() => { if (my === S.token) speakCurrent(); }, 500); return; }
      S.errors = 0;
      toast('Ezt a mondatot nem sikerült felolvasni, továbblépek.', 'error');
      finished(sg, my);
    };
    S.utter = u; // ne vesszen el a hivatkozás, különben az „end” esemény elmaradhat
    try {
      if (synth.paused) synth.resume();
      synth.speak(u);
    } catch (e) {
      pause();
      toast('A felolvasás nem indult el ebben a böngészőben.', 'error');
      return;
    }
    arm(text, sg, my);
    if (S.voice && S.voice.localService === false && /Google/i.test(S.voice.name)) {
      // a Chrome hálózati hangjai kb. 15 másodperc után elnémulnak; így ébren tartjuk őket
      S.keep = setInterval(() => {
        if (my !== S.token) { clearInterval(S.keep); return; }
        try { if (synth.speaking) { synth.pause(); synth.resume(); } } catch (e) { /* */ }
      }, 9000);
    }
  }

  // Beépített hang: a mondat hangja a workerből jön, közben a következő mondatokat is előkészítjük
  const textAt = (k) => {
    const sg = S.segs[k];
    if (!sg || sg.kind === 'sep') return '';
    const t = H.normalizeForSpeech(sg.text, { dict: S.dict });
    return H.hasSpeakable(t) ? t : '';
  };
  function upcomingTexts(n) {
    const out = [];
    for (let k = S.seg + 1; k < S.segs.length && out.length < n; k++) { const t = textAt(k); if (t) out.push(t); }
    return out;
  }

  async function speakNeural(text, sg, my) {
    S.waiting = true;
    setPlayUi();
    try {
      if (Neural.state !== 'ready') await Neural.start();
    } catch (e) {
      S.waiting = false;
      if (my === S.token) neuralFailed();
      return;
    }
    if (my !== S.token) return;
    Neural.flush([text, ...upcomingTexts(3)]);
    let item;
    try { item = await Neural.get(text); }
    catch (e) {
      if (my !== S.token || (e && e.code === 'canceled')) return;
      S.waiting = false;
      if (Neural.state === 'failed') { neuralFailed(); return; }
      S.errors++;
      if (S.errors <= 1) { S.timer = setTimeout(() => { if (my === S.token) speakCurrent(); }, 300); return; }
      S.errors = 0;
      toast('Ezt a mondatot nem sikerült felolvasni, továbblépek.', 'error');
      finished(sg, my);
      return;
    }
    if (my !== S.token) return;
    S.waiting = false;
    S.errors = 0;
    setPlayUi();
    if (!S.playing) return;
    Neural.play(item, pauseMs(sg.pause), () => {
      if (my !== S.token) return;
      learnFrom(sg.text.length, item.sec * S.set.rate);
      finished(sg, my, 0);
    }, () => {
      if (my !== S.token) return;
      toast('A lejátszás megakadt, továbblépek a következő mondatra.', 'error');
      finished(sg, my, 0);
    });
    upcomingTexts(3).forEach((t) => Neural.get(t).catch(() => {}));
  }

  function neuralFailed() {
    const code = Neural.error && Neural.error.code;
    const why = code === 'net'
      ? 'Nem sikerült letölteni Imre hangját. Ellenőrizd az internetkapcsolatot, és próbáld újra.'
      : 'Imre hangja ebben a böngészőben nem tud elindulni.';
    renderVoices();
    if (canSpeak && S.playing) {
      toast(`${why} Addig a böngésző saját hangjával olvasok.`, 'error', 8000);
      speakCurrent();
    } else {
      stop();
      toast(why, 'error', 8000);
    }
  }

  function advance() {
    if (S.seg + 1 < S.segs.length) { S.seg++; speakCurrent(); return; }
    endOfChapter();
  }

  function endOfChapter() {
    if (S.ch + 1 >= S.book.chapters.length) {
      stop();
      savePos();
      toast('A könyv végére értél.');
      return;
    }
    if (S.sleep.mode === 'chapter') {
      stop();
      setSleep('off', 0, true);
      openChapter(S.ch + 1, 0, { top: true });
      toast('A fejezet végén megálltam, ahogy kérted.');
      return;
    }
    openChapter(S.ch + 1, 0, { top: true });
    if (S.playing) S.timer = setTimeout(() => { if (S.playing) speakCurrent(); }, pauseMs('head'));
  }

  function jumpTo(k, autoplay) {
    const resume = S.playing || autoplay;
    let busy = false;
    try { busy = !!synth && (synth.speaking || synth.pending); } catch (e) { busy = false; }
    S.token++;
    clearTimers();
    cancelSpeech();
    S.seg = clamp(k, 0, Math.max(0, S.segs.length - 1));
    highlight(S.seg, { force: true });
    if (resume && canPlay()) {
      S.playing = true;
      setPlayUi();
      wake(true);
      if (useNeural()) { Neural.unlock(); speakCurrent(); return; }
      // iOS-en az első felolvasásnak a kattintáson belül kell indulnia; különben hagyunk időt a leállításnak
      if (busy) S.timer = setTimeout(() => { if (S.playing) speakCurrent(); }, 140);
      else speakCurrent();
    } else if (autoplay && !canPlay()) toast('Ez a böngésző nem tud felolvasni.', 'error');
  }

  function step(d) {
    let k = S.seg + d;
    while (S.segs[k] && S.segs[k].kind === 'sep') k += d;
    if (k >= 0 && k < S.segs.length) { jumpTo(k); return; }
    const was = S.playing;
    if (d > 0 && S.ch + 1 < S.book.chapters.length) { stop(); openChapter(S.ch + 1, 0, { top: true }); if (was) play(); }
    else if (d < 0 && S.ch > 0) { stop(); openChapter(S.ch - 1, 1e9); if (was) play(); }
  }

  function goToEntry(e) {
    const was = S.playing;
    stop();
    if (e.ch !== S.ch) openChapter(e.ch, 0, { top: true });
    let k = S.segs.findIndex((s) => s.b >= e.block);
    if (k < 0) k = 0;
    jumpTo(k, was);
  }

  function seekTo(frac) {
    const b = S.book;
    const target = clamp(frac, 0, 1) * b.total;
    let ch = b.chapters.findIndex((c) => target < c.start + c.chars);
    if (ch < 0) ch = b.chapters.length - 1;
    const was = S.playing;
    stop();
    if (ch !== S.ch) openChapter(ch, 0);
    const off = target - b.chapters[ch].start;
    let k = S.segs.findIndex((s) => s.kind !== 'sep' && s.cum + s.text.length > off);
    if (k < 0) k = S.segs.length - 1;
    jumpTo(k, was);
  }

  // ── Hangok ────────────────────────────────────────────────────────────
  const isHuVoice = (v) => /^hu(?:[-_]|$)/i.test(v.lang || '') || /hungarian|magyar/i.test(v.name || '');
  function voiceInfo(v) {
    let name = v.name.replace(/^(Microsoft|Google|Apple)\s+/i, '')
      .replace(/\s*[-–]\s*(Hungarian|magyar|English|German|French).*$/i, '')
      .replace(/\s*Online\s*\(Natural\)/i, '')
      .replace(/\s*\((?:Natural|Enhanced|Premium|Neural)\)/gi, '').trim();
    name = { Noemi: 'Noémi', Tamas: 'Tamás' }[name] || name || v.name;
    const natural = /Natural|Neural/i.test(v.name);
    const better = /Premium|Enhanced/i.test(v.name);
    const tag = natural ? 'természetes' : better ? 'bővített' : v.localService === false ? 'online' : 'rendszerhang';
    return { name, tag, natural };
  }
  const voiceScore = (v) => (/Natural|Neural/i.test(v.name) ? 100 : 0) + (/Premium/i.test(v.name) ? 70 : 0) +
    (/Enhanced/i.test(v.name) ? 60 : 0) + (/Google/i.test(v.name) ? 20 : 0) + (v.localService === false ? 5 : 0);

  function loadVoices() {
    let list = [];
    if (canSpeak) { try { list = synth.getVoices() || []; } catch (e) { list = []; } }
    S.allVoices = list;
    S.huVoices = list.filter(isHuVoice).sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
    const want = S.set.voice && S.set.voice !== NEURAL_ID ? S.set.voice : '';
    let v = want ? list.find((x) => x.voiceURI === want || x.name === want) : null;
    if (!v) v = S.huVoices[0] || null;
    const changed = v !== S.voice;
    S.voice = v; // a beépített hang mellett ez a tartalék
    renderVoices();
    if (changed && S.playing && !useNeural()) jumpTo(S.seg);
  }

  function renderVoices() {
    const sel = $('#voiceSel');
    const pool = S.set.allVoices ? S.huVoices.concat(S.allVoices.filter((v) => !isHuVoice(v))) : S.huVoices;
    sel.textContent = '';
    if (Neural.available) {
      const g = document.createElement('optgroup');
      g.label = 'Beépített hang';
      const o = document.createElement('option');
      o.value = NEURAL_ID;
      o.textContent = Neural.state === 'failed' ? 'Imre · ebben a böngészőben nem indult el' : 'Imre · természetes, minden böngészőben';
      g.appendChild(o);
      sel.appendChild(g);
    }
    const g2 = document.createElement('optgroup');
    g2.label = 'A böngésző hangjai';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = !canSpeak ? 'Ez a böngésző nem tud felolvasni'
      : S.huVoices.length ? `Automatikus (${voiceInfo(S.huVoices[0]).name})` : 'Automatikus (rendszer alapértelmezése)';
    auto.disabled = !canSpeak;
    g2.appendChild(auto);
    pool.forEach((v) => {
      const o = document.createElement('option');
      const i = voiceInfo(v);
      o.value = v.voiceURI || v.name;
      o.textContent = `${i.name} · ${i.tag}${isHuVoice(v) ? '' : ` (${v.lang})`}`;
      g2.appendChild(o);
    });
    sel.appendChild(g2);
    if (S.set.voice === NEURAL_ID && Neural.available) sel.value = NEURAL_ID;
    else sel.value = S.set.voice && pool.some((v) => (v.voiceURI || v.name) === S.set.voice) ? S.set.voice : '';
    sel.disabled = !canSpeak && !Neural.available;
    renderEngine();
  }

  const mb = (b) => huNum(b / 1048576, 0, 0);
  function loadingText() {
    if (Neural.stage === 'compile') return 'Imre hangjának előkészítése…';
    const pct = Neural.total ? Math.floor((Neural.loaded / Neural.total) * 100) : 0;
    return `Imre hangjának letöltése: ${pct}% (${mb(Neural.loaded)} / ${mb(Neural.total || Neural.totalMB * 1048576)} MB). Csak az első alkalommal kell.`;
  }

  // a hangválasztó kis címkéje a lejátszóban és a súgó a beállításokban
  function renderEngine() {
    const chip = $('#voiceChip');
    const chipText = $('#voiceChipText');
    const hint = $('#voiceHint');
    hint.classList.remove('warn');
    chip.classList.remove('warn');
    $('#pitchField').hidden = useNeural();
    showSpoken();
    setPlayUi();
    if (S.set.voice === NEURAL_ID && Neural.available) {
      if (Neural.state !== 'failed') {
        const pct = Neural.total ? Math.floor((Neural.loaded / Neural.total) * 100) : 0;
        chipText.textContent = Neural.state !== 'loading' ? 'Imre' : Neural.stage === 'compile' ? 'Imre · indul' : `Imre · ${pct}%`;
        chip.title = 'Hang: Imre (beépített)';
        hint.textContent = Neural.state === 'loading' ? loadingText()
          : `Beépített, természetes hang. A böngésződben fut, ezért minden böngészőben és telefonon ugyanígy szól. Első használatkor kb. ${Neural.totalMB} MB-ot tölt le, utána internet nélkül is működik.`;
        return;
      }
      hint.classList.add('warn');
      chip.classList.add('warn');
      const why = Neural.error && Neural.error.code === 'net'
        ? 'Nem sikerült letölteni Imre hangját (nincs internet?). Az oldal újratöltésével újra megpróbálom.'
        : 'Imre hangja ebben a böngészőben nem tud elindulni. Egy friss Chrome, Edge, Firefox vagy Safari kell hozzá.';
      hint.textContent = `${why} Addig a böngésző saját hangjával olvasok.`;
      chipText.textContent = S.voice ? voiceInfo(S.voice).name : 'Nincs hang';
      return;
    }
    if (!canSpeak) {
      chipText.textContent = 'Nincs felolvasás';
      chip.classList.add('warn');
      hint.classList.add('warn');
      hint.textContent = 'Ez a böngésző nem támogatja a felolvasást. Válaszd a beépített Imre hangot.';
      return;
    }
    if (!S.voice) {
      chipText.textContent = 'Nincs magyar hang';
      chip.classList.add('warn');
      hint.classList.add('warn');
      hint.textContent = 'Ebben a böngészőben nincs magyar hang, ezért a rendszer alapértelmezett hangja olvas. Válaszd inkább a beépített Imre hangot.';
      return;
    }
    const i = voiceInfo(S.voice);
    chipText.textContent = i.name;
    chip.classList.toggle('warn', !isHuVoice(S.voice));
    chip.title = `Hang: ${i.name} (${i.tag})`;
    if (!isHuVoice(S.voice)) {
      hint.classList.add('warn');
      hint.textContent = 'Ez nem magyar hang, ezért a magyar szöveget idegen kiejtéssel olvassa fel.';
    } else if (i.natural) {
      hint.textContent = S.voice.localService === false
        ? 'Természetes, neurális hang. A működéséhez internetkapcsolat kell.'
        : 'Természetes, neurális hang.';
    } else {
      hint.textContent = 'Ez a rendszer saját, gépies magyar hangja. A beépített Imre hang sokkal természetesebb.';
    }
  }

  // ── Elalvási időzítő ──────────────────────────────────────────────────
  const SLEEP_SEQ = ['off', 15, 30, 60, 'chapter'];
  function setSleep(mode, minutes, silent) {
    clearInterval(S.sleepTick);
    S.sleep = { mode, minutes: minutes || 0, until: mode === 'time' ? Date.now() + minutes * 60000 : 0 };
    if (mode === 'time') S.sleepTick = setInterval(renderSleep, 15000);
    renderSleep();
    if (!silent) {
      toast(mode === 'off' ? 'Az elalvási időzítő kikapcsolva.'
        : mode === 'chapter' ? 'A fejezet végén megállok.' : `${minutes} perc múlva megállok, a mondat végén.`);
    }
  }
  function cycleSleep() {
    const cur = S.sleep.mode === 'time' ? S.sleep.minutes : S.sleep.mode;
    const nx = SLEEP_SEQ[(SLEEP_SEQ.indexOf(cur) + 1) % SLEEP_SEQ.length];
    if (nx === 'off' || nx === 'chapter') setSleep(nx);
    else setSleep('time', nx);
  }
  function renderSleep() {
    let txt = '';
    if (S.sleep.mode === 'time') txt = `${Math.max(0, Math.ceil((S.sleep.until - Date.now()) / 60000))} p`;
    else if (S.sleep.mode === 'chapter') txt = 'fejezet';
    $('#sleepLabel').textContent = txt;
    const b = $('#sleepBtn');
    b.classList.toggle('on', S.sleep.mode !== 'off');
    b.setAttribute('aria-label', S.sleep.mode === 'off' ? 'Elalvási időzítő: ki' : `Elalvási időzítő: ${txt}`);
    b.title = S.sleep.mode === 'off' ? 'Elalvási időzítő' : `Megáll: ${S.sleep.mode === 'chapter' ? 'a fejezet végén' : txt.replace(' p', ' perc múlva')}`;
  }

  // ── Beállítások ───────────────────────────────────────────────────────
  const RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];
  const fmtRate = (r) => `${huNum(r, 1, 2)}×`;
  function renderRate() {
    $('#rateBtn').textContent = fmtRate(S.set.rate);
    $('#rateRange').value = String(S.set.rate);
    $('#rateOut').textContent = fmtRate(S.set.rate);
  }
  function setRate(r, restart) {
    S.set.rate = Math.round(clamp(r, 0.5, 2) * 100) / 100;
    saveSettings();
    renderRate();
    Neural.clearCache(); // a beépített hang más tempóhoz újra elkészíti a mondatokat
    if (restart && S.playing) jumpTo(S.seg);
    if (S.book) { renderToc(); }
  }
  function applySettingsUi() {
    renderRate();
    $('#pitchRange').value = String(S.set.pitch);
    $('#pitchOut').textContent = huNum(S.set.pitch, 2, 2);
    $$('#pauseSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pause === S.set.pause)));
    document.documentElement.style.setProperty('--read-scale', String(S.set.font));
    $('#fontOut').textContent = `${Math.round(S.set.font * 100)}%`;
    $('#showSpoken').checked = !!S.set.showSpoken;
    $('#allVoices').checked = !!S.set.allVoices;
    $('#dictArea').value = S.set.dict;
    renderDictCount();
  }
  function renderDictCount() {
    const n = S.dict.length;
    $('#dictCount').textContent = n ? `${n} szabály` : '';
  }

  function previewTry() {
    const raw = $('#tryInput').value.trim();
    $('#tryOut').textContent = raw ? H.normalizeForSpeech(raw, { dict: S.dict }) : '';
  }
  function speakTry() {
    previewTry();
    const text = $('#tryOut').textContent;
    if (!text) return;
    if (!canPlay()) { toast('Ez a böngésző nem tud felolvasni.', 'error'); return; }
    if (S.playing) pause();
    S.token++;
    clearTimers();
    cancelSpeech();
    if (useNeural()) {
      const my = S.token;
      Neural.unlock();
      const btn = $('#tryBtn');
      btn.disabled = true;
      Neural.start()
        .then(() => Neural.get(text))
        .then((item) => { if (my === S.token) Neural.play(item, 0, () => {}); })
        .catch(() => { if (Neural.state === 'failed') neuralFailed(); })
        .finally(() => { btn.disabled = false; });
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (S.voice && S.voice.lang) || 'hu-HU';
    if (S.voice) u.voice = S.voice;
    u.rate = S.set.rate;
    u.pitch = S.set.pitch;
    S.utter = u;
    try { synth.speak(u); } catch (e) { toast('A felolvasás nem indult el ebben a böngészőben.', 'error'); }
  }

  // ── Könyvtár ──────────────────────────────────────────────────────────
  const LANGS = { en: 'angol', de: 'német', fr: 'francia', es: 'spanyol', it: 'olasz', ru: 'orosz', pl: 'lengyel',
    cs: 'cseh', sk: 'szlovák', ro: 'román', hr: 'horvát', sr: 'szerb', pt: 'portugál', nl: 'holland', fi: 'finn',
    sv: 'svéd', ja: 'japán', zh: 'kínai', la: 'latin', uk: 'ukrán' };

  function errText(err) {
    const c = err && err.code;
    return ({
      notzip: 'Ezt a fájlt nem tudom megnyitni: nem érvényes EPUB, vagy megsérült.',
      drm: 'Ez a könyv DRM-védett, ezért nem tudom felolvasni. DRM-mentes vagy csak vízjeles EPUB-ot tudok megnyitni.',
      notext: 'Nem találtam felolvasható szöveget a könyvben. Lehet, hogy csak képekből áll.',
      noopf: 'A könyvből hiányzik a tartalomleíró (OPF) fájl, ezért nem tudom megnyitni.',
      inflate: 'Ez a böngésző nem tudja kibontani az EPUB-ot. Próbáld meg egy frissebb böngészőben.',
    })[c] || 'Nem sikerült megnyitni a könyvet. Ellenőrizd, hogy ép EPUB-fájlt választottál-e.';
  }

  async function makeThumb(blob) {
    if (!blob || typeof createImageBitmap !== 'function') return null;
    try {
      const bmp = await createImageBitmap(blob);
      const h = 160, w = Math.max(1, Math.round((bmp.width * h) / bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.min(w, 220);
      c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } catch (e) { return null; }
  }

  async function trimLibrary(keepId) {
    const all = (await DB.all()).sort((a, b) => (b.opened || 0) - (a.opened || 0));
    for (const r of all.slice(8)) if (r.id !== keepId) await DB.del(r.id);
  }

  async function openFile(file) {
    if (!file) return;
    if (!/\.epub$/i.test(file.name) && file.type !== 'application/epub+zip') {
      toast('Ez nem EPUB-fájl. Csak .epub kiterjesztésű könyvet tudok megnyitni.', 'error');
      return;
    }
    toast(`Megnyitom: ${file.name}`, 'busy', 60000);
    try {
      const buf = await file.arrayBuffer();
      const book = await window.Epub.open(buf, { fileName: file.name });
      const thumb = await makeThumb(book.cover);
      await DB.put({
        id: book.id, title: book.title, author: book.author, name: file.name, size: file.size,
        file: new Blob([buf], { type: 'application/epub+zip' }), thumb, added: Date.now(), opened: Date.now(),
      });
      trimLibrary(book.id);
      showBook(book);
      closeDlg($('#libDlg'));
      const lang = (book.lang || '').toLowerCase();
      if (lang && !/^hu/.test(lang)) {
        toast(`Megnyitottam: ${book.title}. A könyv nyelve ${LANGS[lang.slice(0, 2)] || lang}, a Mesélő viszont magyar kiejtéssel olvas, ezért furcsán szólhat.`, 'info', 8000);
      } else toast(`Megnyitottam: ${book.title}`);
    } catch (err) {
      toast(errText(err), 'error', 8000);
    }
  }

  async function openStored(id, opt) {
    const o = opt || {};
    if (id === 'sample') { showBook(sampleBook()); closeDlg($('#libDlg')); return true; }
    const rec = await DB.get(id);
    if (!rec || !rec.file) {
      if (!o.silent) toast('Ezt a könyvet már nem találom ebben a böngészőben. Nyisd meg újra a fájlt.', 'error');
      return false;
    }
    try {
      const book = await window.Epub.open(await rec.file.arrayBuffer(), { fileName: rec.name });
      rec.opened = Date.now();
      DB.put(rec);
      showBook(book);
      closeDlg($('#libDlg'));
      return true;
    } catch (err) {
      if (!o.silent) toast(errText(err), 'error');
      return false;
    }
  }

  function coverEl(thumb, title) {
    if (thumb) {
      const img = document.createElement('img');
      img.className = 'cover';
      img.src = thumb;
      img.alt = '';
      return img;
    }
    const d = document.createElement('span');
    d.className = 'cover gen';
    d.textContent = (String(title || '?').trim()[0] || '?').toUpperCase();
    d.setAttribute('aria-hidden', 'true');
    return d;
  }

  async function renderLibrary() {
    const list = $('#bookList');
    const recs = (await DB.all()).sort((a, b) => (b.opened || 0) - (a.opened || 0));
    const pos = LS.get('meselo:pos', {});
    list.textContent = '';
    const items = recs.map((r) => ({ id: r.id, title: r.title, author: r.author, thumb: r.thumb }));
    items.push({ id: 'sample', title: 'Ismerkedés a Mesélővel', author: 'Beépített mintakönyv', thumb: null, sample: true });
    items.forEach((it) => {
      const li = document.createElement('li');
      li.className = 'book-row' + (S.book && S.book.id === it.id ? ' current' : '');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'book-open';
      const txt = document.createElement('span');
      txt.className = 'bk-text';
      const t = document.createElement('span');
      t.className = 'bk-title';
      t.textContent = it.title;
      const m = document.createElement('span');
      m.className = 'bk-meta';
      const p = pos[it.id];
      const state = S.book && S.book.id === it.id ? 'most olvasod' : p ? `${Math.round((p.pct || 0) * 100)}%-nál tartasz` : 'még nem kezdted el';
      m.textContent = [it.author, state].filter(Boolean).join(' · ');
      txt.append(t, m);
      open.append(coverEl(it.thumb, it.title), txt);
      open.addEventListener('click', () => openStored(it.id));
      li.appendChild(open);
      if (!it.sample) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'book-del';
        del.setAttribute('aria-label', `${it.title} eltávolítása a könyvtárból`);
        del.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        del.addEventListener('click', async () => {
          await DB.del(it.id);
          const all = LS.get('meselo:pos', {});
          delete all[it.id];
          LS.set('meselo:pos', all);
          if (S.book && S.book.id === it.id) showBook(sampleBook());
          renderLibrary();
          toast(`Eltávolítottam: ${it.title}`);
        });
        li.appendChild(del);
      }
      list.appendChild(li);
    });
    $('#clearBtn').hidden = !recs.length;
  }

  // ── Párbeszédablakok, értesítések ─────────────────────────────────────
  function openDlg(sel) {
    const d = $(sel);
    if (d.open) return;
    try { d.showModal(); } catch (e) { d.setAttribute('open', ''); }
  }
  function closeDlg(d) { if (d && d.open) { try { d.close(); } catch (e) { d.removeAttribute('open'); } } }

  let toastT = 0;
  function toast(msg, kind, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.dataset.kind = kind || 'info';
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastT);
    toastT = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { if (!t.classList.contains('show')) t.hidden = true; }, 250);
    }, ms || 4200);
  }

  // ── Események ─────────────────────────────────────────────────────────
  function bindUi() {
    $('#playBtn').addEventListener('click', toggle);
    $('#prevBtn').addEventListener('click', () => step(-1));
    $('#nextBtn').addEventListener('click', () => step(1));
    $('#rateBtn').addEventListener('click', () => {
      const nx = RATES.find((x) => x > S.set.rate + 0.001) || RATES[0];
      setRate(nx, true);
    });
    $('#sleepBtn').addEventListener('click', cycleSleep);
    $('#voiceChip').addEventListener('click', () => openDlg('#setDlg'));
    $('#followBtn').addEventListener('click', () => { S.userScrollAt = -1e9; if (S.curEl) followScroll(S.curEl, { force: true }); });
    $('#prevChap').addEventListener('click', () => { const was = S.playing; stop(); openChapter(S.ch - 1, 0, { top: true }); if (was) play(); });
    $('#nextChap').addEventListener('click', () => { const was = S.playing; stop(); openChapter(S.ch + 1, 0, { top: true }); if (was) play(); });

    $('#chapter').addEventListener('click', (e) => {
      const sp = e.target.closest('.s');
      if (!sp) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) return;
      jumpTo(Number(sp.dataset.k), true);
    });

    $('#tocBtn').addEventListener('click', () => {
      openDlg('#tocDlg');
      const cur = S.book.toc.find((t) => t.el && t.el.classList.contains('current'));
      if (cur) cur.el.scrollIntoView({ block: 'center' });
    });
    $('#libBtn').addEventListener('click', () => { renderLibrary(); openDlg('#libDlg'); });
    $('#brandBtn').addEventListener('click', () => { renderLibrary(); openDlg('#libDlg'); });
    $('#setBtn').addEventListener('click', () => openDlg('#setDlg'));
    $$('dialog').forEach((d) => {
      d.addEventListener('click', (e) => { if (e.target === d) closeDlg(d); });
      $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => closeDlg(d)));
    });

    $('#openBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      openFile(f);
    });
    $('#clearBtn').addEventListener('click', () => { $('#clearConfirm').hidden = false; $('#clearBtn').hidden = true; });
    $('#clearNo').addEventListener('click', () => { $('#clearConfirm').hidden = true; $('#clearBtn').hidden = false; });
    $('#clearYes').addEventListener('click', async () => {
      await DB.clear();
      LS.del('meselo:pos');
      LS.del('meselo:last');
      $('#clearConfirm').hidden = true;
      if (!S.book.isSample) showBook(sampleBook());
      renderLibrary();
      toast('Töröltem a mentett könyveket és könyvjelzőket.');
    });

    // beállítások
    $('#voiceSel').addEventListener('change', (e) => {
      const was = S.playing;
      if (was) stop();
      S.set.voice = e.target.value;
      saveSettings();
      loadVoices();
      if (useNeural()) Neural.start().catch(() => {});
      if (was) play();
    });
    $('#allVoices').addEventListener('change', (e) => { S.set.allVoices = e.target.checked; saveSettings(); renderVoices(); });
    $('#rateRange').addEventListener('input', (e) => { $('#rateOut').textContent = fmtRate(Number(e.target.value)); });
    $('#rateRange').addEventListener('change', (e) => setRate(Number(e.target.value), true));
    $('#pitchRange').addEventListener('input', (e) => { $('#pitchOut').textContent = huNum(Number(e.target.value), 2, 2); });
    $('#pitchRange').addEventListener('change', (e) => {
      S.set.pitch = Number(e.target.value);
      saveSettings();
      if (S.playing) jumpTo(S.seg);
    });
    $$('#pauseSeg button').forEach((b) => b.addEventListener('click', () => {
      S.set.pause = b.dataset.pause;
      saveSettings();
      applySettingsUi();
    }));
    const setFont = (d) => {
      S.set.font = Math.round(clamp(S.set.font + d, 0.8, 1.6) * 10) / 10;
      saveSettings();
      applySettingsUi();
      if (S.curEl) followScroll(S.curEl, { force: true, instant: true });
    };
    $('#fontDown').addEventListener('click', () => setFont(-0.1));
    $('#fontUp').addEventListener('click', () => setFont(0.1));
    $('#showSpoken').addEventListener('change', (e) => { S.set.showSpoken = e.target.checked; saveSettings(); highlight(S.seg); });
    let dictT = 0;
    $('#dictArea').addEventListener('input', (e) => {
      clearTimeout(dictT);
      dictT = setTimeout(() => {
        S.set.dict = e.target.value;
        S.dict = H.compileDict(S.set.dict);
        saveSettings();
        renderDictCount();
        previewTry();
        showSpoken(S.segs[S.seg] ? H.normalizeForSpeech(S.segs[S.seg].text, { dict: S.dict }) : '');
      }, 300);
    });
    $('#tryInput').addEventListener('input', previewTry);
    $('#tryForm').addEventListener('submit', (e) => { e.preventDefault(); speakTry(); });

    // haladássáv
    const seek = $('#seek');
    const fracAt = (x) => { const r = seek.getBoundingClientRect(); return (x - r.left) / r.width; };
    seek.addEventListener('click', (e) => seekTo(fracAt(e.clientX)));
    seek.addEventListener('keydown', (e) => {
      const pct = curPos() / S.book.total;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); seekTo(pct + 0.01); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); seekTo(pct - 0.01); }
      else if (e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); seekTo(pct + 0.1); }
      else if (e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); seekTo(pct - 0.1); }
    });

    // billentyűk
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if ($$('dialog').some((d) => d.open)) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ' || e.code === 'Space') {
        if (t && t.closest && t.closest('button')) return;
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) S.userScrollAt = now();
    });

    // kézi görgetés: egy ideig nem rántjuk vissza a kiemeléshez
    const userScroll = () => { S.userScrollAt = now(); };
    window.addEventListener('wheel', userScroll, { passive: true });
    window.addEventListener('touchmove', userScroll, { passive: true });
    let raf = 0;
    window.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        $('#topbar').classList.toggle('scrolled', window.scrollY > 4);
        updateFollow();
      });
    }, { passive: true });

    // fájl ráhúzása
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('#dropzone').hidden = false; });
    window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('#dropzone').hidden = true; });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      $('#dropzone').hidden = true;
      const files = [...e.dataTransfer.files];
      openFile(files.find((x) => /\.epub$/i.test(x.name)) || files[0]);
    });

    window.addEventListener('pagehide', savePos);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') savePos();
      else if (S.playing) wake(true);
    });

    // a lejátszó magassága igazítja az alsó margót és az értesítések helyét
    const setH = () => document.documentElement.style.setProperty('--player-h', `${Math.ceil($('#player').getBoundingClientRect().height)}px`);
    if (window.ResizeObserver) new ResizeObserver(setH).observe($('#player'));
    setH();
  }

  // ── Telepíthető app (csak az önálló weboldalon) ─────────────────────────
  function initApp() {
    if ('mediaSession' in navigator) {
      const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* nem támogatott */ } };
      set('play', () => play());
      set('pause', () => pause());
      set('stop', () => pause());
      set('previoustrack', () => step(-1));
      set('nexttrack', () => step(1));
      set('seekbackward', () => step(-1));
      set('seekforward', () => step(1));
    }
    if (!window.MESELO_SITE) return;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => { deferred = e; $('#installZone').hidden = false; });
    window.addEventListener('appinstalled', () => { deferred = null; $('#installZone').hidden = true; toast('A Mesélő telepítve van.'); });
    $('#installBtn').addEventListener('click', async () => {
      if (!deferred) return;
      try { await deferred.prompt(); await deferred.userChoice; } catch (e) { /* */ }
      deferred = null;
      $('#installZone').hidden = true;
    });
    // Windows: jobb klikk egy EPUB-on → Társítás… → Mesélő
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (params) => {
        const h = params && params.files && params.files[0];
        if (h) { try { openFile(await h.getFile()); } catch (e) { /* */ } }
      });
    }
  }

  // ── Indulás ───────────────────────────────────────────────────────────
  function init() {
    document.documentElement.lang = 'hu';
    const last = LS.get('meselo:last', null);
    applySettingsUi();
    bindUi();
    initApp();
    renderSleep();
    showBook(sampleBook(), { remember: false });
    previewTry();
    loadVoices();
    if (canSpeak) {
      try { synth.addEventListener('voiceschanged', loadVoices); } catch (e) { synth.onvoiceschanged = loadVoices; }
      [150, 600, 1500, 3500].forEach((t) => setTimeout(loadVoices, t));
    }
    // ha Imre hangja már le van töltve, a háttérben elindítjuk, hogy a lejátszás azonnal szóljon
    if (useNeural()) Neural.isCached().then((hit) => { if (hit) Neural.start().catch(() => {}); });
    if (last && last !== 'sample') openStored(last, { silent: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
