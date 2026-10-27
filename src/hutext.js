/*! Mesélő · HuText – magyar szöveg előkészítése felolvasáshoz */
(function (root) {
  'use strict';

  // ── Számnevek ─────────────────────────────────────────────────────────
  const ONES = ['', 'egy', 'kettő', 'három', 'négy', 'öt', 'hat', 'hét', 'nyolc', 'kilenc'];
  const ONES_ATTR = ['', 'egy', 'két', 'három', 'négy', 'öt', 'hat', 'hét', 'nyolc', 'kilenc'];
  const TENS = ['', 'tíz', 'húsz', 'harminc', 'negyven', 'ötven', 'hatvan', 'hetven', 'nyolcvan', 'kilencven'];
  const TENS_PRE = ['', 'tizen', 'huszon', 'harminc', 'negyven', 'ötven', 'hatvan', 'hetven', 'nyolcvan', 'kilencven'];
  const BIG = [[1e12, 'billió'], [1e9, 'milliárd'], [1e6, 'millió'], [1e3, 'ezer']];

  function below1000(n, attr) {
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
    let s = '';
    if (h) s += (h === 1 ? '' : ONES_ATTR[h]) + 'száz';
    if (t) s += u ? TENS_PRE[t] : TENS[t];
    if (u) s += (attr ? ONES_ATTR : ONES)[u];
    return s;
  }

  function digitsAloud(str) {
    return String(str).replace(/\D/g, '').split('')
      .map((d) => (d === '0' ? 'nulla' : ONES[+d])).join(' ');
  }

  // attr = jelzői helyzet („két ember”, nem „kettő ember”)
  function cardinal(n, attr) {
    if (n === 0) return 'nulla';
    if (!(n > 0) || n >= 1e15 || n % 1) return digitsAloud(String(n));
    const parts = [];
    let rest = n;
    for (const [val, name] of BIG) {
      const q = Math.floor(rest / val);
      if (!q) continue;
      parts.push(val === 1e3 && q === 1 ? 'ezer' : below1000(q, true) + name);
      rest -= q * val;
    }
    if (rest) parts.push(below1000(rest, attr));
    // 2000 fölött kötőjellel tagolunk: kétezer-huszonhat
    return n <= 2000 ? parts.join('') : parts.join('-');
  }

  const ORD_MAP = [
    ['kilencven', 'kilencvenedik'], ['nyolcvan', 'nyolcvanadik'], ['milliárd', 'milliárdodik'],
    ['harminc', 'harmincadik'], ['negyven', 'negyvenedik'], ['hetven', 'hetvenedik'], ['hatvan', 'hatvanadik'],
    ['kilenc', 'kilencedik'], ['millió', 'milliomodik'], ['billió', 'billiomodik'],
    ['ötven', 'ötvenedik'], ['kettő', 'kettedik'], ['három', 'harmadik'], ['nyolc', 'nyolcadik'], ['nulla', 'nulladik'],
    ['négy', 'negyedik'], ['száz', 'századik'], ['húsz', 'huszadik'], ['ezer', 'ezredik'],
    ['egy', 'egyedik'], ['tíz', 'tizedik'], ['hét', 'hetedik'], ['hat', 'hatodik'], ['öt', 'ötödik'],
  ];

  function ordinal(n) {
    if (n === 1) return 'első';
    if (n === 2) return 'második';
    const c = cardinal(n);
    for (const [a, b] of ORD_MAP) if (c.endsWith(a)) return c.slice(0, -a.length) + b;
    return c + 'adik';
  }

  // Ragok hangrendi párjai: január 2-től → másodikától (a ragot a kimondott tőhöz igazítjuk)
  const TO_BACK = { től: 'tól', ről: 'ról', ből: 'ból', hez: 'hoz', höz: 'hoz', nek: 'nak', vel: 'val',
    ben: 'ban', be: 'ba', re: 'ra', nél: 'nál' };
  const TO_FRONT = { tól: 'től', ról: 'ről', ból: 'ből', hoz: 'hez', nak: 'nek', val: 'vel',
    ban: 'ben', ba: 'be', ra: 're', nál: 'nél' };
  const harmonize = (suf, back) => ((back ? TO_BACK : TO_FRONT)[suf] || suf);

  // Dátum napja: 15-én → tizenötödikén, 1-jén → elsején, 20-ig → huszadikáig
  function dateDay(n, suffix) {
    const stem = n === 1 ? 'elsej' : ordinal(n);
    const back = n !== 1 && /[ao]dik$/.test(stem);
    const vs = back ? 'a' : 'e', vl = back ? 'á' : 'é';
    let suf = (suffix || '').toLowerCase();
    suf = suf.replace(/^(?:[aeoö]?d)?ik/, '');
    suf = suf.replace(/^j(?=[aáeé])/, '');
    if (!suf) return stem + vs;
    if (/^[aáeé]/.test(suf)) {
      let v = suf[0];
      if (back) v = v === 'e' ? 'a' : v === 'é' ? 'á' : v;
      else v = v === 'a' ? 'e' : v === 'á' ? 'é' : v;
      return stem + v + harmonize(suf.slice(1), back);
    }
    if (suf === 'i') return stem + vs + 'i';
    return stem + vl + harmonize(suf, back);
  }

  // ── Toldalékolás ──────────────────────────────────────────────────────
  const VOWELS = 'aáeéiíoóöőuúüű';
  const isVowel = (c) => VOWELS.includes(c);
  const NO_LENGTHEN = /^(?:kor|ként|szerű)/;

  function attach(word, suffix) {
    if (!suffix) return word;
    let suf = suffix.toLowerCase();
    const di = /(cs|dz|gy|ly|ny|sz|ty|zs)$/.exec(word);
    const last = word.slice(-1);
    // -val/-vel/-vá/-vé hasonul: öt + vel → öttel
    const vm = /^v(al|el|á|é)(.*)$/.exec(suf);
    if (vm && !isVowel(last)) suf = (di ? di[1] : last) + vm[1] + vm[2];
    // kettőzött kétjegyű betű: egy + gyel → eggyel, húsz + szal → hússzal
    if (di && suf.startsWith(di[1]) && /^(?:cs|dz|gy|ly|ny|sz|ty|zs)(?:al|el|á|é)/.test(suf)) {
      return word.slice(0, -2) + di[1][0] + suf;
    }
    // tővégi a, e megnyúlik: nulla → nullát, óra → óráig
    if (/[ae]$/.test(word) && !NO_LENGTHEN.test(suf)) {
      return word.slice(0, -1) + (last === 'a' ? 'á' : 'é') + suf;
    }
    return word + suf;
  }

  // Számnév + rag a tőváltakozásokkal: hármat, hetet, tizet, ezret, kettes, kétszer
  function numAttach(words, suffix) {
    const suf = suffix.toLowerCase();
    if (/kettő$/.test(words)) {
      if (/^(?:sz[eoö]r|féle|fajta)/.test(suf)) return words.slice(0, -5) + 'két' + suf;
      if (/^[aeoö]/.test(suf)) return words.slice(0, -5) + 'kett' + suf;
      return attach(words, suf);
    }
    if (/^[aeoö]/.test(suf)) {
      if (/három$/.test(words)) return words.slice(0, -5) + 'hárm' + suf;
      if (/hét$/.test(words)) return words.slice(0, -3) + 'het' + suf;
      if (/tíz$/.test(words)) return words.slice(0, -3) + 'tiz' + suf;
      if (/ezer$/.test(words)) return words.slice(0, -4) + 'ezr' + suf;
    }
    return attach(words, suf);
  }

  const cap = (s) => s.replace(/^(\P{L}*)(\p{L})/u, (m, a, b) => a + b.toUpperCase());

  // ── Hónapok, mértékegységek ───────────────────────────────────────────
  const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július',
    'augusztus', 'szeptember', 'október', 'november', 'december'];
  const MONTH_ALT = MONTHS.join('|');
  const isMonth = (w) => MONTHS.includes(w);
  const MONTH_ABBR = {
    jan: 'január', feb: 'február', febr: 'február', márc: 'március', ápr: 'április', máj: 'május',
    jún: 'június', júl: 'július', aug: 'augusztus', szep: 'szeptember', szept: 'szeptember',
    okt: 'október', nov: 'november', dec: 'december',
  };
  const DATE_POST = new Set(['és', 's', 'vagy', 'meg', 'illetve', 'között', 'közt', 'óta', 'után', 'előtt',
    'körül', 'táján', 'tájékán', 'reggel', 'délelőtt', 'délben', 'délután', 'este', 'éjjel', 'éjjelén', 'hajnalban']);

  const UNIT_WORD = {
    '%': 'százalék', '‰': 'ezrelék', '°C': 'Celsius-fok', '°': 'fok', 'Ft': 'forint', 'HUF': 'forint',
    'EUR': 'euró', '€': 'euró', 'USD': 'dollár', '$': 'dollár', '£': 'font', 'km/h': 'kilométer per óra',
    'km²': 'négyzetkilométer', 'm²': 'négyzetméter', 'm³': 'köbméter', 'km': 'kilométer', 'cm': 'centiméter',
    'mm': 'milliméter', 'dkg': 'dekagramm', 'kg': 'kilogramm', 'mg': 'milligramm', 'ml': 'milliliter',
    'dl': 'deciliter', 'cl': 'centiliter', 'db': 'darab', 'mp': 'másodperc', 'm': 'méter', 'g': 'gramm', 'l': 'liter',
  };
  const UNIT_RE = /^(\s?)(%|‰|°C|°|Ft|HUF|EUR|€|USD|\$|£|km\/h|km²|m²|m³|km|cm|mm|dkg|kg|mg|ml|dl|cl|db|mp|m|g|l)(?![\p{L}\d])(?:-(\p{L}+))?/u;

  const FRAC = ['', 'tized', 'század', 'ezred', 'tízezred', 'százezred', 'milliomod'];
  function decimalWords(intStr, dec) {
    const ip = cardinal(Number(intStr), true);
    if (dec.length > 6) return ip + ' egész ' + digitsAloud(dec);
    const dn = Number(dec);
    if (dn === 0) return ip + ' egész nulla';
    return ip + ' egész ' + cardinal(dn, true) + ' ' + FRAC[dec.length];
  }

  function romanToInt(r) {
    if (!r || !/^C{0,3}(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(r)) return 0;
    const V = { I: 1, V: 5, X: 10, L: 50, C: 100 };
    let t = 0;
    for (let i = 0; i < r.length; i++) {
      const a = V[r[i]], b = V[r[i + 1]] || 0;
      t += a < b ? -a : a;
    }
    return t;
  }

  const lastToken = (before) => ((/([\p{L}\d]+)\s*$/u.exec(before) || [])[1] || '').toLowerCase();
  const isArticle = (w) => w === 'a' || w === 'az';
  const SENT_AFTER = /^\s+[\p{Lu}„"«(–—]/u;
  const isEnd = (rest) => /^\s*$/.test(rest);

  // ── Átalakító lépések ─────────────────────────────────────────────────
  function cleanPass(s) {
    s = s.normalize('NFC');
    s = s.replace(/[­​-‍⁠﻿]/g, '');
    // régi, Latin-1-es magyar e-könyvek: õ, û a helyes ő, ű helyett
    s = s.replace(/õ/g, 'ő').replace(/Õ/g, 'Ő').replace(/û/g, 'ű').replace(/Û/g, 'Ű');
    return s.replace(/[\r\n\t]+/g, ' ');
  }

  function dialoguePass(s) {
    // gondolatjeles párbeszéd: a jelet nem mondjuk ki, csak szünetet tartunk
    s = s.replace(/^([\s„"«»“”]*)[–—―-]\s+/, '$1');
    s = s.replace(/([.!?…]["”»’)]*)\s+[–—―]\s+/g, '$1 ');
    s = s.replace(/\s*[–—―]\s*,/g, ',');
    s = s.replace(/\s+[–—―]\s+/g, ', ');
    s = s.replace(/\s+-\s+/g, ', ');
    s = s.replace(/[„“”"«»‹›‚‘]/g, '');
    s = s.replace(/([!?…])\s*,/g, '$1').replace(/,\s*([.!?…])/g, '$1').replace(/,\s*,/g, ',');
    // a sorvégi vessző marad (folytatódó hanglejtés), csak a gondolatjelből lett maradékot töröljük
    s = s.replace(/^\s*,\s*/, '').replace(/\s+[–—―]\s*$/, '');
    return s;
  }

  function symbolPass(s) {
    return s
      .replace(/\s*&\s*/g, ' és ')
      .replace(/§/g, ' paragrafus ')
      .replace(/(\d)\s*\+\s*(?=\d)/g, '$1 plusz ')
      .replace(/(\p{L})\/(\p{L})/gu, '$1 $2')
      .replace(/(\d)\/(\d)/g, '$1 per $2')
      .replace(/[*•†‡#]/g, '')
      .replace(/\.{3,}/g, '…');
  }

  const MULTI_ABBR = [
    [/(?<!\p{L})Kr\.\s?e\./gu, 'Krisztus előtt'],
    [/(?<!\p{L})Kr\.\s?u\./gu, 'Krisztus után'],
    [/(?<!\p{L})i\.\s?e\./gu, 'időszámításunk előtt'],
    [/(?<!\p{L})i\.\s?sz\./gu, 'időszámításunk szerint'],
    [/(?<!\p{L})[uU]\.\s?i\./gu, 'utóirat'],
  ];
  function multiAbbrPass(s) {
    for (const [re, exp] of MULTI_ABBR) {
      s = s.replace(re, (m, off, str) => {
        const rest = str.slice(off + m.length);
        let w = /^\p{Lu}/u.test(m) && m[0] !== 'K' ? cap(exp) : exp;
        if (isEnd(rest) || SENT_AFTER.test(rest)) w += '.';
        return w;
      });
    }
    return s;
  }

  function monthAbbrPass(s) {
    return s.replace(/(?<!\p{L})(jan|febr?|márc|ápr|máj|jún|júl|aug|szept?|okt|nov|dec)\.(?=\s?\d)/giu,
      (m, a) => MONTH_ABBR[a.toLowerCase()]);
  }

  // 2026. 10. 20. → kétezer-huszonhat október huszadika
  const RE_NUMDATE = /(?<![\d.])(\d{4})\.\s?(\d{1,2}|[IVX]{1,4})\.\s?(\d{1,2})(?:(\.)|-(\p{L}+))(?!\d)/gu;
  function numDatePass(s) {
    return s.replace(RE_NUMDATE, (m, y, mo, d, dot, suf, off, str) => {
      const month = /^\d/.test(mo) ? Number(mo) : romanToInt(mo);
      const day = Number(d);
      if (!month || month > 12 || day < 1 || day > 31) return m;
      let w = cardinal(Number(y)) + ' ' + MONTHS[month - 1] + ' ' + dateDay(day, suf || '');
      if (dot) {
        const rest = str.slice(off + m.length);
        if (isEnd(rest) || SENT_AFTER.test(rest)) w += '.';
      }
      return w;
    });
  }

  // 8:30-kor → nyolc óra harminc perckor
  const RE_TIME = /(?<![\d:,.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])(?:-(\p{L}+))?/gu;
  function timePass(s) {
    return s.replace(RE_TIME, (m, h, mm, suf) => {
      let w = cardinal(Number(h), true) + ' óra';
      if (mm !== '00') w += ' ' + cardinal(Number(mm), true) + ' perc';
      if (suf) w = w.replace(/(\S+)$/, (x) => attach(x, suf));
      return w;
    });
  }

  const FR = { '½': 'fél', '¼': 'negyed', '¾': 'háromnegyed', '⅓': 'egyharmad', '⅔': 'kétharmad' };
  function fractionPass(s) {
    s = s.replace(/(\d+)\s?([½¼¾⅓⅔])/g, (m, n, f) => {
      if (f === '½') return n === '1' ? 'másfél' : cardinal(Number(n), true) + ' és fél';
      return cardinal(Number(n), true) + ' egész ' + FR[f];
    });
    return s.replace(/[½¼¾⅓⅔]/g, (f) => FR[f]);
  }

  function currencyPass(s) {
    return s.replace(/(?<![\p{L}\d])([$€£])\s?(\d[\d    ]*(?:,\d+)?)/gu,
      (m, c, num) => num.trim() + ' ' + c);
  }

  function negativePass(s) {
    return s.replace(/(^|[\s(])[−-](?=\d)/g, '$1mínusz ');
  }

  // XIV. Lajos → tizennegyedik Lajos
  const RE_ROMAN = /(?<![\p{L}\d.])([IVXLC]+)\.(?:-(\p{L}+))?(?=[\s,;:)\]–—…!?]|$)/gu;
  const ROMAN_STOP = new Set(['C', 'L', 'CV', 'CI', 'LI', 'CL', 'CC', 'XL']);
  function romanPass(s) {
    return s.replace(RE_ROMAN, (m, r, suf, off, str) => {
      if (ROMAN_STOP.has(r)) return m;
      const n = romanToInt(r);
      if (!n) return m;
      const before = str.slice(0, off), rest = str.slice(off + m.length);
      if (r.length === 1 && (/(?:^|[\s(])\p{Lu}\.\s*$/u.test(before) || /^\s*\p{Lu}\.(?:\s|$)/u.test(rest))) {
        return m; // monogram: V. I. Lenin
      }
      let w = ordinal(n);
      if (suf) w += suf.toLowerCase();
      else if (isEnd(rest)) w += '.';
      return w;
    });
  }

  const SEP_CH = '[\\u00A0\\u202F\\u2009 ]';
  const RE_NUM = new RegExp(
    `(\\d{1,3}(?:${SEP_CH}\\d{3})+(?!\\d)|\\d+)(?:,(\\d+))?(\\.(?!\\d))?(?:-(\\p{L}+))?`, 'gu');
  const RE_YEAR_MONTH = new RegExp(`^\\s+(?:${MONTH_ALT})(?!\\p{L})`, 'iu');
  const RE_RANGE_DATE = new RegExp(`(?:${MONTH_ALT})\\s+\\d{1,2}\\s*[–—-]\\s*$`, 'iu');
  const looksDateSuffix = (suf) => /^j?[áé](?!rt)/.test(suf) || /^j?[ae]i?$/.test(suf);

  function numbersPass(s) {
    let out = '', last = 0, m;
    RE_NUM.lastIndex = 0;
    while ((m = RE_NUM.exec(s))) {
      const start = m.index;
      let end = start + m[0].length;
      const intStr = m[1].replace(/[    ]/g, '');
      const dec = m[2];
      const period = !!m[3];
      const suffix = m[4] || '';
      const before = s.slice(0, start);
      const rest = s.slice(end);
      const prevTok = lastToken(before);
      const n = (intStr.length > 1 && intStr[0] === '0') || intStr.length > 15 ? null : Number(intStr);
      let words, tail = '';

      if (n === null) {
        words = digitsAloud(intStr) + (dec !== undefined ? ' egész ' + digitsAloud(dec) : '');
        if (suffix) words = attach(words, suffix);
        if (period) tail = '.';
      } else if (dec !== undefined) {
        words = decimalWords(intStr, dec);
        const u = !suffix && !period && UNIT_RE.exec(rest);
        if (u) { words += ' ' + attach(UNIT_WORD[u[2]], u[3] || ''); end += u[0].length; }
        else if (suffix) words = attach(words, suffix);
        if (period) tail = '.';
      } else if (n >= 1 && n <= 31 && (isMonth(prevTok) || RE_RANGE_DATE.test(before) || (suffix && !period && looksDateSuffix(suffix.toLowerCase())))) {
        if (suffix) words = dateDay(n, suffix);
        else if (period) {
          const nx = /^\s+(\p{L}+)/u.exec(rest);
          if (nx && /^\p{Ll}/u.test(nx[1]) && !DATE_POST.has(nx[1].toLowerCase())) words = ordinal(n);
          else {
            words = dateDay(n, '');
            if (isEnd(rest) || SENT_AFTER.test(rest)) tail = '.';
          }
        } else words = dateDay(n, '');
      } else if (period && !suffix && RE_YEAR_MONTH.test(rest)) {
        words = cardinal(n); // évszám a dátumban: 1848. március
      } else if (period) {
        if (suffix) words = ordinal(n) + suffix.toLowerCase();
        else if (/^\s+\p{Ll}/u.test(rest) || /^\s*[,;:)\]–—]/.test(rest)) words = ordinal(n);
        else if (isArticle(prevTok)) { words = ordinal(n); if (isEnd(rest)) tail = '.'; }
        else if (/^[\s„"«(]*$/.test(before) && isEnd(rest)) { words = ordinal(n); tail = '.'; }
        else { words = cardinal(n); tail = '.'; }
      } else if (suffix) {
        const ordSuf = /^(?:[aeoö]?d)?ik/i;
        words = ordSuf.test(suffix) ? ordinal(n) + suffix.toLowerCase().replace(ordSuf, '') : numAttach(cardinal(n), suffix);
      } else {
        const u = UNIT_RE.exec(rest);
        if (u) {
          words = cardinal(n, true) + ' ' + attach(UNIT_WORD[u[2]], u[3] || '');
          end += u[0].length;
        } else if (/^\s*[–—-]\s*\d+\.(?!\d)\s+\p{Ll}/u.test(rest)) {
          words = ordinal(n); // 17–18. század
        } else {
          const attr = /^\s+\p{Ll}/u.test(rest) || /^\s*[–—-]\s*\d+(?:,\d+)?\s+\p{Ll}/u.test(rest);
          words = cardinal(n, attr);
        }
      }

      if (/\p{L}/u.test(before.slice(-1))) words = ' ' + words;
      if (/[\p{L}\d]/u.test(s.charAt(end))) words += ' ';
      out += s.slice(last, start) + words + tail;
      last = end;
      RE_NUM.lastIndex = end;
    }
    return out + s.slice(last);
  }

  const ABBR = [
    ['pl', 'például', 'mid'], ['stb', 's a többi', 'end'], ['kb', 'körülbelül', 'mid'], ['ill', 'illetve', 'mid'],
    ['ún', 'úgynevezett', 'mid'], ['vö', 'vesd össze', 'mid'], ['ld', 'lásd', 'mid'], ['uo', 'ugyanott', 'end'],
    ['ti', 'tudniillik', 'mid'], ['tkp', 'tulajdonképpen', 'mid'], ['ca', 'cirka', 'mid'], ['szül', 'született', 'mid'],
    ['ford', 'fordította', 'mid'], ['szerk', 'szerkesztette', 'mid'], ['max', 'maximum', 'mid'],
    ['évf', 'évfolyam', 'end'], ['fej', 'fejezet', 'end'], ['old', 'oldal', 'end'], ['ker', 'kerület', 'end'],
    ['krt', 'körút', 'end'], ['dr', 'doktor', 'title'], ['ifj', 'ifjabb', 'title'], ['id', 'idősebb', 'title'],
    ['özv', 'özvegy', 'title'], ['gr', 'gróf', 'title'], ['br', 'báró', 'title'], ['hg', 'herceg', 'title'],
    ['prof', 'professzor', 'title'], ['szt', 'szent', 'title'], ['nyug', 'nyugalmazott', 'title'],
    ['mrs', 'misszisz', 'title'], ['mr', 'miszter', 'title'], ['ms', 'miz', 'title'], ['bp', 'Budapest', 'end'],
  ];
  const ABBR_MAP = new Map(ABBR.map((a) => [a[0], a]));
  const RE_ABBR = new RegExp(
    `(?<![\\p{L}\\d])(${ABBR.map((a) => a[0]).sort((x, y) => y.length - x.length).join('|')})\\.(?=[\\s,;:)\\]!?…]|$)`,
    'giu');
  function abbrPass(s) {
    return s.replace(RE_ABBR, (m, k, off, str) => {
      if (k.slice(1) !== k.slice(1).toLowerCase()) return m;
      const [, exp, type] = ABBR_MAP.get(k.toLowerCase());
      let w = /^\p{Lu}/u.test(k) ? cap(exp) : exp;
      const rest = str.slice(off + m.length);
      if (isEnd(rest) || (type === 'end' && SENT_AFTER.test(rest))) w += '.';
      return w;
    });
  }

  function capsPass(s) {
    // csupa nagybetűs címek: ELSŐ FEJEZET → első fejezet (hogy ne betűzze)
    return s.replace(/(?<!\p{L})\p{Lu}{4,}(?!\p{L})/gu, (w) => w.toLowerCase())
      .replace(/(^|[\s(])S(?=\s+\p{Ll})/gu, '$1s');
  }

  // Kiejtési szótár: „Chicago = Sikágó” a toldalékos alakra is illik (Chicagóban → Sikágóban)
  const LONG = { a: 'á', e: 'é', o: 'ó', ö: 'ő' };
  function compileDict(text) {
    const rules = [];
    String(text || '').split(/\r?\n/).forEach((line) => {
      const i = line.indexOf('=');
      if (i < 1) return;
      const from = line.slice(0, i).trim(), to = line.slice(i + 1).trim();
      if (!from || !to) return;
      const fin = from.slice(-1).toLowerCase();
      const body = (LONG[fin] ? from.slice(0, -1) : from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pat = LONG[fin] ? `${body}[${fin}${LONG[fin]}]` : body;
      try {
        rules.push({ re: new RegExp(`(?<![\\p{L}\\d])${pat}`, 'giu'), to, from, fin });
      } catch (e) { /* hibás sor: kihagyjuk */ }
    });
    return rules;
  }
  function applyDict(s, rules) {
    for (const r of rules) {
      s = s.replace(r.re, (m) => {
        const longHit = LONG[r.fin] && m.slice(-1).toLowerCase() === LONG[r.fin];
        const end = r.to.slice(-1);
        return longHit && LONG[end] ? r.to.slice(0, -1) + LONG[end] : r.to;
      });
    }
    return s;
  }

  function normalizeForSpeech(text, opts) {
    const o = opts || {};
    let s = cleanPass(String(text || ''));
    if (o.dict && o.dict.length) s = applyDict(s, o.dict);
    s = dialoguePass(s);
    s = symbolPass(s);
    s = multiAbbrPass(s);
    s = monthAbbrPass(s);
    s = numDatePass(s);
    s = timePass(s);
    s = fractionPass(s);
    s = currencyPass(s);
    s = negativePass(s);
    s = romanPass(s);
    s = numbersPass(s);
    s = abbrPass(s);
    s = capsPass(s);
    s = s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').replace(/\s+([,.;:!?…])/g, '$1').trim();
    // a mondatkezdő „s” kötőszó maradjon kisbetűs, különben betűként olvashatják
    return /^s\s/.test(s) ? s : cap(s);
  }

  const hasSpeakable = (s) => /[\p{L}\p{N}]/u.test(s || '');

  // ── Mondatokra bontás (a megjelenített szövegen) ──────────────────────
  const NO_SPLIT = new Set(['dr', 'ifj', 'id', 'özv', 'gr', 'br', 'hg', 'prof', 'szt', 'nyug', 'mr', 'mrs', 'ms', 'st',
    'kr', 'pl', 'kb', 'ill', 'ún', 'vö', 'ld', 'ti', 'tkp', 'ca', 'szül', 'ford', 'szerk', 'max', 'min', 'vs', 'kül',
    'ált', 'jan', 'feb', 'febr', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szep', 'szept', 'okt', 'nov', 'dec',
    'sz', 'u', 'i', 'e', 'ún']);
  const isRomanTok = (t) => /^[IVXLC]{1,7}$/.test(t) && romanToInt(t) > 0;

  function isBoundary(text, pIdx, punct, after) {
    const c = after[0];
    if (/\p{Ll}/u.test(c)) return false;
    if (/[–—―-]/.test(c)) return !/^\p{Ll}/u.test(after.slice(1).replace(/^\s+/, ''));
    if (punct === '.') {
      const before = text.slice(0, pIdx);
      const tok = (/([\p{L}\d]+)$/u.exec(before) || [])[1] || '';
      const low = tok.toLowerCase();
      if (NO_SPLIT.has(low)) return false;
      if (/^\p{Lu}$/u.test(tok)) return false;
      if (isRomanTok(tok) && /\p{Lu}/u.test(c)) return false;
      if (/^\d+$/.test(tok)) {
        const prev = ((/(\p{L}+)\s+\d+$/u.exec(before) || [])[1] || '').toLowerCase();
        if (isArticle(prev)) return false;
        if (/\d/.test(c)) return false;
      } else if (/\d/.test(c) && tok.length < 3) return false;
    }
    return true;
  }

  function trimRange(text, s, e) {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    return e > s ? { s, e } : null;
  }

  const MAX_SEG = 240;
  function splitLong(text, r, out) {
    const len = r.e - r.s;
    if (len <= MAX_SEG) { out.push(r); return; }
    const seg = text.slice(r.s, r.e);
    const lo = Math.floor(len * 0.3), hi = Math.floor(len * 0.72), mid = len / 2;
    let best = -1, bestScore = Infinity, m;
    const re = /([;:])\s|\s[–—]\s|(,)\s/g;
    while ((m = re.exec(seg))) {
      const cut = m[0][0] === ' ' ? m.index : m.index + 1;
      if (cut < lo || cut > hi) continue;
      const score = Math.abs(cut - mid) / len + (m[1] ? 0 : m[2] ? 0.25 : 0.1);
      if (score < bestScore) { bestScore = score; best = cut; }
    }
    if (best < 0) {
      const sp = seg.lastIndexOf(' ', Math.floor(mid));
      if (sp > lo / 2) best = sp; else { out.push(r); return; }
    }
    const a = trimRange(text, r.s, r.s + best), b = trimRange(text, r.s + best, r.e);
    if (a) splitLong(text, a, out);
    if (b) splitLong(text, b, out);
  }

  function splitSentences(text) {
    const res = [];
    const re = /([.!?…]+)(["'”’»«)\]]*)(?=\s|$)/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      const endIdx = m.index + m[0].length;
      const after = text.slice(endIdx).replace(/^\s+/, '');
      if (!after) break;
      if (!isBoundary(text, m.index, m[1], after)) continue;
      const r = trimRange(text, start, endIdx);
      if (r) res.push(r);
      start = endIdx;
    }
    const r = trimRange(text, start, text.length);
    if (r) res.push(r);
    const out = [];
    res.forEach((x) => splitLong(text, x, out));
    return out;
  }

  // Bekezdés → felolvasási egységek; a verssorok (sortörés) külön egységek
  function segmentBlock(text) {
    const out = [];
    const lines = String(text).split('\n');
    let offset = 0;
    lines.forEach((line, li) => {
      const sents = splitSentences(line);
      sents.forEach((r, k) => out.push({
        s: offset + r.s, e: offset + r.e,
        lineEnd: k === sents.length - 1 && li < lines.length - 1,
      }));
      offset += line.length + 1;
    });
    return out;
  }

  const api = {
    normalizeForSpeech, segmentBlock, splitSentences, compileDict, hasSpeakable,
    cardinal, ordinal, dateDay, numAttach, attach, romanToInt, MONTHS,
  };
  root.HuText = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
