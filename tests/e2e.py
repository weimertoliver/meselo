"""Mesélő végponttól végpontig: hamis beszédmotorral, valódi Chromiumban."""
import json, os, sys, threading, http.server, functools, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tests', 'shots')
os.makedirs(SHOTS, exist_ok=True)

FAKE_SPEECH = r"""
(() => {
  const spoken = []; window.__spoken = spoken; window.__speakMs = 30;
  const V = (name, lang, local) => ({ name, lang, localService: local, default: false, voiceURI: name });
  const voices = [
    V('Microsoft Noemi Online (Natural) - Hungarian (Hungary)', 'hu-HU', false),
    V('Microsoft Tamas Online (Natural) - Hungarian (Hungary)', 'hu-HU', false),
    V('Microsoft Szabolcs - Hungarian (Hungary)', 'hu-HU', true),
    V('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
  ];
  let ready = false, queue = [], current = null; const listeners = [];
  class U { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; } }
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices() { return ready ? voices : []; },
    speak(u) { queue.push(u); synth.pending = true; if (!current) next(); },
    cancel() {
      const q = queue; queue = []; const c = current; current = null;
      synth.speaking = false; synth.pending = false;
      if (c) { clearTimeout(c._t); c.onerror && c.onerror({ error: 'interrupted' }); }
      q.forEach((u) => u.onerror && u.onerror({ error: 'canceled' }));
    },
    pause() { synth.paused = true; }, resume() { synth.paused = false; },
    addEventListener(t, f) { if (t === 'voiceschanged') listeners.push(f); },
    removeEventListener() {},
  };
  function next() {
    current = queue.shift();
    if (!current) { synth.speaking = false; synth.pending = false; return; }
    synth.speaking = true; synth.pending = queue.length > 0;
    const u = current;
    spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate });
    setTimeout(() => u.onstart && u.onstart({}), 2);
    u._t = setTimeout(() => { if (current !== u) return; current = null; u.onend && u.onend({}); next(); }, window.__speakMs);
  }
  setTimeout(() => { ready = true; listeners.forEach((f) => f()); }, 300);
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U;
})();
"""

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(handler.func):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
URL = BASE + '/dist/test.html'

fails = []
def check(cond, msg):
    print(('  ok  ' if cond else '  HIBA') + ' ' + msg)
    if not cond: fails.append(msg)

def spoken(page):
    return page.evaluate('window.__spoken.map(s => s.text)')

def wait_spoken(page, n, timeout=20000):
    page.wait_for_function(f'window.__spoken.length >= {n}', timeout=timeout)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='hu-HU')
    ctx.add_init_script(FAKE_SPEECH)
    ctx.add_init_script("try { if (!localStorage.getItem('meselo:settings')) localStorage.setItem('meselo:settings', JSON.stringify({ v: 2, voice: '' })); } catch (e) {}")
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts' not in m.text else None)

    print('1. Mintakönyv betöltése')
    page.goto(URL)
    page.wait_for_selector('#chapter .s')
    check(page.inner_text('#nbTitle') == 'Ismerkedés a Mesélővel', 'a mintakönyv címe látszik')
    page.wait_for_function("document.querySelector('#voiceChipText').textContent === 'Noémi'", timeout=5000)
    check(True, 'a hangválasztó a Noémi hangot választotta')
    check(page.locator('#chapter .s.cur').count() == 1, 'az első mondat ki van emelve')
    check(len(page.locator('#tocList li').all()) == 4, 'a tartalomban 4 fejezet van')

    print('2. Lejátszás és kiemelés')
    page.click('#playBtn')
    wait_spoken(page, 3)
    k = page.evaluate("Number(document.querySelector('.s.cur').dataset.k)")
    check(k >= 2, f'a kiemelés halad (most: {k}. mondat)')
    first = page.evaluate('window.__spoken[0]')
    check(first['voice'].startswith('Microsoft Noemi'), 'a Noémi hanggal szól')
    page.click('#playBtn')
    n_after_pause = page.evaluate('window.__spoken.length')
    page.wait_for_timeout(900)
    check(page.evaluate('window.__spoken.length') == n_after_pause, 'a szünet tényleg megállítja')

    print('3. Második fejezet: számok, dátumok, rövidítések')
    page.click('#tocBtn')
    page.click('#tocList li:nth-child(2) button')
    page.evaluate('window.__spoken.length = 0')
    page.click('#playBtn')
    page.wait_for_function("window.__spoken.some(s => s.text.includes('kazettáról'))", timeout=30000)
    page.click('#playBtn')
    said = ' | '.join(spoken(page))
    for phrase in [
        'Ezernyolcszáznegyvennyolc március tizenötödikén reggel',
        'tizenkét pontot',
        'Tizennegyedik Lajos hetvenkét évig uralkodott, ami a tizenhetedik–tizennyolcadik században',
        'Doktor Kovács Éva körülbelül három egész öt tized kilométerre lakik a második kerülettől',
        'nyolc óra harminc perckor induló busszal húsz perc alatt',
        'négyezer-kilencszázkilencven forint volt, de huszonöt százalékkal olcsóbban, háromezer-hétszáznegyvenkét forintért',
        'Az úgynevezett tihanyi alapítólevél Krisztus után ezerötvenötből való',
        'A kétezres évek elején',
        'ma már két kattintás',
    ]:
        check(phrase in said, f'kimondva: „{phrase}”')

    print('4. Párbeszéd és vers')
    page.click('#tocBtn')
    page.click('#tocList li:nth-child(3) button')
    page.evaluate('window.__spoken.length = 0')
    page.click('#playBtn')
    page.wait_for_function("window.__spoken.some(s => s.text.includes('Koltó'))", timeout=40000)
    page.click('#playBtn')
    said_list = spoken(page)
    check('Hallod ezt? kérdezte Anna, és letette a könyvet.' in said_list, 'a gondolatjeles párbeszédet jel nélkül mondja')
    check(not any('–' in s for s in said_list if 'kérdezte' in s or 'felelte' in s), 'a párbeszédben nem marad gondolatjel')
    check('s még benne virít az egész kikelet,' in said_list, 'a verssorok külön egységek, az „s” kisbetűs')
    check(any(s.startswith('Koltó, ezernyolcszáznegyvenhét szeptember') for s in said_list), 'a keltezés évszáma tőszámnév')

    print('5. Saját EPUB3 megnyitása')
    page.set_input_files('#fileInput', os.path.join(ROOT, 'tests/out/probakonyv-epub3.epub'))
    page.wait_for_function("document.querySelector('#nbTitle').textContent === 'A próbakönyv'", timeout=10000)
    check(True, 'a könyv címe megjelent')
    check(page.inner_text('#nbAuthor') == 'Teszt Elek', 'a szerző megjelent')
    toc = page.eval_on_selector_all('#tocList .toc-title', 'els => els.map(e => e.textContent)')
    check(toc == ['Első fejezet', 'Második fejezet', 'Egy kis kitérő', 'Harmadik fejezet'], f'tartalomjegyzék a nav-ból: {toc}')
    text1 = page.inner_text('#chapter')
    check('Petőfi' in text1 and 'Petõfi' not in text1, 'az õ betű ő-re javítva')
    check('városba.1' not in text1 and 'városba. A kocsis' in text1.replace('\n', ' '), 'a lábjegyzetszám nem kerül a szövegbe')
    page.evaluate('window.__spoken.length = 0')
    page.click('#playBtn')
    page.wait_for_function("window.__spoken.some(s => s.text.includes('jó'))", timeout=20000)
    page.click('#playBtn')
    s5 = spoken(page)
    check(any('felolvasni jó' in s for s in s5), 'a lágy kötőjelet kihagyja a kimondott szövegből')
    check(any('ezernyolcszáznegyvennyolc március tizenötödikén' in s for s in s5), 'a könyv szövegét is magyarosan mondja')
    check(any(s.startswith('A huszadik kerületbe, felelte') for s in s5), 'római szám + gondolatjel a könyvből')

    print('6. Latin-2 fejezet és horgony')
    page.click('#tocBtn')
    page.click('#tocList li:nth-child(3) button')
    cur = page.inner_text('.s.cur')
    check(cur.startswith('Egy kis kitérő'), f'a „kitérő” horgonyra ugrott: {cur[:30]}')
    text2 = page.inner_text('#chapter')
    check('Árvíztűrő tükörfúrógép: őrült ŐŰ.' in text2, 'ISO-8859-2 kódolás helyesen dekódolva')
    check('Laza szöveg div-ben kiemeléssel.' in text2 and 'És egy p a div-ben.' in text2, 'vegyes tartalmú div szövege megvan')

    print('7. Újratöltés után folytatja')
    seg_before = page.evaluate("document.querySelector('.s.cur').textContent")
    page.wait_for_timeout(1000)
    page.reload()
    page.wait_for_function("document.querySelector('#nbTitle').textContent === 'A próbakönyv'", timeout=10000)
    page.wait_for_timeout(300)
    check(page.evaluate("document.querySelector('.s.cur').textContent") == seg_before, 'ugyanannál a mondatnál folytatja')

    print('8. EPUB2 (NCX) és hibás fájlok')
    page.set_input_files('#fileInput', os.path.join(ROOT, 'tests/out/regi-epub2.epub'))
    page.wait_for_function("document.querySelector('#nbTitle').textContent === 'Régi kódolású könyv'", timeout=10000)
    toc2 = page.eval_on_selector_all('#tocList .toc-title', 'els => els.map(e => e.textContent)')
    check(toc2 == ['Latin-2 fejezet', 'Kitérő', 'Vers'], f'tartalomjegyzék az NCX-ből: {toc2}')
    page.click('#tocBtn')
    page.click('#tocList li:nth-child(3) button')
    check(page.locator('#chapter p.verse br').count() == 2, 'a vers sortörései megmaradnak')
    check(page.locator('#chapter p.sep').count() == 1, 'a jelenetváltás egyetlen elválasztó')
    check('lábjegyzet' not in page.inner_text('#chapter'), 'a lábjegyzet törzse kimarad')
    page.set_input_files('#fileInput', os.path.join(ROOT, 'tests/out/drm-vedett.epub'))
    page.wait_for_function("document.querySelector('#toast').textContent.includes('DRM')", timeout=10000)
    check(True, 'DRM-es könyvnél érthető üzenet')
    check(page.inner_text('#nbTitle') == 'Régi kódolású könyv', 'a hibás megnyitás nem zárja be az aktuális könyvet')
    page.set_input_files('#fileInput', os.path.join(ROOT, 'tests/out/nem-epub.epub'))
    page.wait_for_function("document.querySelector('#toast').textContent.includes('nem érvényes EPUB')", timeout=10000)
    check(True, 'sérült fájlnál érthető üzenet')

    print('9. Könyvtár')
    page.click('#libBtn')
    page.wait_for_selector('#bookList .bk-title')
    rows = page.eval_on_selector_all('#bookList .bk-title', 'els => els.map(e => e.textContent)')
    check(rows[:2] == ['Régi kódolású könyv', 'A próbakönyv'] and rows[-1] == 'Ismerkedés a Mesélővel', f'könyvtár: {rows}')
    page.click('#bookList li:nth-child(2) .book-open')
    page.wait_for_function("document.querySelector('#nbTitle').textContent === 'A próbakönyv'", timeout=10000)
    check(True, 'a könyvtárból újranyitja a könyvet')

    real_errors = [e for e in errors if 'Failed to load resource' not in e]
    check(not real_errors, f'nincs JS-hiba ({real_errors[:3]})')

    print('10. Képernyőképek')
    page.click('#libBtn')
    page.click('#bookList li:last-child .book-open')
    page.wait_for_function("document.querySelector('#nbTitle').textContent === 'Ismerkedés a Mesélővel'")
    page.click('#tocBtn')
    page.click('#tocList li:nth-child(2) button')
    page.locator('#chapter .s').nth(4).click()
    page.evaluate('window.__speakMs = 100000')
    page.wait_for_timeout(800)
    page.screenshot(path=os.path.join(SHOTS, 'desktop-light.png'))
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(SHOTS, 'desktop-dark.png'))
    page.emulate_media(color_scheme='light')
    page.click('#playBtn')
    page.click('#setBtn')
    page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(SHOTS, 'desktop-settings.png'))

    m = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='hu-HU')
    m.add_init_script(FAKE_SPEECH)
    m.add_init_script("try { if (!localStorage.getItem('meselo:settings')) localStorage.setItem('meselo:settings', JSON.stringify({ v: 2, voice: '' })); } catch (e) {}")
    mp = m.new_page()
    mp.goto(URL)
    mp.wait_for_selector('#chapter .s')
    mp.wait_for_timeout(700)
    sw = mp.evaluate('document.documentElement.scrollWidth')
    check(sw <= 390, f'telefonon nincs vízszintes görgetés ({sw}px)')
    mp.locator('#chapter .s').nth(2).click()
    mp.evaluate('window.__speakMs = 100000')
    mp.wait_for_timeout(600)
    mp.screenshot(path=os.path.join(SHOTS, 'mobile-light.png'))
    mp.click('#playBtn')
    mp.click('#tocBtn')
    mp.wait_for_timeout(400)
    mp.screenshot(path=os.path.join(SHOTS, 'mobile-toc.png'))
    browser.close()

srv.shutdown()
print(f"\n{'MINDEN RENDBEN' if not fails else str(len(fails)) + ' HIBA'}")
sys.exit(1 if fails else 0)
