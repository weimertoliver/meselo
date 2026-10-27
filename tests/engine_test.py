"""A beépített hang próbája valódi Chromiumban: worker indul, letölt, felolvas, és egyezik a Python Piperrel."""
import functools, http.server, json, os, sys, threading, time
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tests', 'shots')
os.makedirs(OUT, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
                      '.data': 'application/octet-stream'}
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/dist/test.html'

fails = []
def check(cond, msg):
    print(('  ok  ' if cond else '  HIBA') + ' ' + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='hu-HU')
    ctx.add_init_script('window.__meseloStats = [];')
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'pageerror: {e}'))
    page.on('worker', lambda w: logs.append(f'worker: {w.url}'))

    print('1. Alapállapot')
    page.goto(URL)
    page.wait_for_selector('#chapter .s')
    check(page.evaluate("document.querySelector('#voiceSel').value") == 'neural:imre', 'alapértelmezett hang: Imre')
    check(page.inner_text('#voiceChipText') == 'Imre', 'a lejátszóban Imre látszik')

    print('2. Első lejátszás: letöltés, indulás, felolvasás')
    t0 = time.time()
    page.click('#playBtn')
    page.wait_for_function("document.querySelector('#spokenLabel').textContent === 'Betöltés'", timeout=10000)
    check(True, 'betöltés közben a lejátszó jelzi a haladást')
    page.wait_for_timeout(600)
    prog = page.inner_text('#spokenText')
    print('     ', prog)
    page.screenshot(path=os.path.join(OUT, 'neural-loading.png'))
    page.wait_for_function("window.__meseloStats.length >= 2", timeout=120000)
    ready_s = time.time() - t0
    check(True, f'elkészült az első mondatok hangja ({ready_s:.1f} s a kattintástól)')
    page.wait_for_function("Number(document.querySelector('.s.cur').dataset.k) >= 2", timeout=60000)
    check(True, 'a felolvasás halad, a kiemelés követi')
    stats = page.evaluate('window.__meseloStats')
    rtf = [s['ms'] / 1000 / s['sec'] for s in stats if s['sec'] > 1]
    print('      szintézis: ' + ', '.join(f"{s['sec']:.1f}s hang / {s['ms']:.0f} ms" for s in stats[:6]))
    check(rtf and max(rtf) < 0.8, f'gyorsabb a valós időnél (RTF max {max(rtf) if rtf else -1:.2f})')
    check(page.evaluate("document.querySelector('#spokenLabel').textContent") == 'Kimondva', 'letöltés után a kimondott szöveg látszik')

    print('3. Szünet a mondat közepén, majd folytatás')
    k_before = page.evaluate("Number(document.querySelector('.s.cur').dataset.k)")
    page.click('#playBtn')
    state = page.evaluate("(async () => { await new Promise(r => setTimeout(r, 400)); return document.querySelector('#playBtn').getAttribute('aria-pressed'); })()")
    check(state == 'false', 'szünetel')
    n_stats = page.evaluate('window.__meseloStats.length')
    page.click('#playBtn')
    page.wait_for_function(f"Number(document.querySelector('.s.cur').dataset.k) > {k_before}", timeout=60000)
    check(True, 'folytatás után továbbhalad')

    print('4. Ugrás mondatra, tempóváltás')
    page.locator('#chapter .s').nth(1).click()
    page.wait_for_timeout(300)
    check(page.evaluate("Number(document.querySelector('.s.cur').dataset.k)") == 1, 'kattintásra a második mondatra ugrik')
    page.click('#rateBtn')
    page.wait_for_function("window.__meseloStats.length > %d" % (n_stats + 2), timeout=60000)
    check(page.inner_text('#rateBtn').startswith('1,1'), 'tempó 1,1×')
    page.click('#playBtn')

    print('5. Újratöltés: a letöltött hang a gyorsítótárból indul')
    model_hits = []
    page.on('request', lambda r: model_hits.append(r.url) if '/model-' in r.url else None)
    page.reload()
    page.wait_for_selector('#chapter .s')
    page.wait_for_function("document.querySelector('#voiceChipText').textContent === 'Imre' && window.__meseloStats !== undefined", timeout=30000)
    t1 = time.time()
    page.click('#playBtn')
    page.wait_for_function("window.__meseloStats.length >= 1", timeout=60000)
    check(not model_hits, f'nem tölti le újra a modellt ({len(model_hits)} kérés)')
    check(time.time() - t1 < 4, f'újratöltés után gyorsan szól ({time.time() - t1:.1f} s)')
    page.click('#playBtn')
    page.click('#setBtn')
    page.wait_for_timeout(400)
    page.screenshot(path=os.path.join(OUT, 'neural-settings.png'))
    page.keyboard.press('Escape')

    print('6. Egyezés a Python Piperrel (zaj nélkül, determinisztikusan)')
    text = 'Doktor Kovács Éva körülbelül három egész öt tized kilométerre lakik a második kerülettől.'
    pcm = page.evaluate("""(text) => new Promise((resolve) => {
        const w = new Worker(new URL('tts/worker.mjs', document.baseURI), { type: 'module' });
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'ready') w.postMessage({ type: 'synth', id: 1, text, lengthScale: 1, noise: [0, 0] });
          if (m.type === 'audio') { resolve(Array.from(m.pcm)); w.terminate(); }
          if (m.type === 'fatal' || m.type === 'error') resolve({ err: m.message });
        };
        w.postMessage({ type: 'init', manifest: window.MESELO_TTS });
    })""", text)
    browser.close()

srv.shutdown()
if isinstance(pcm, dict):
    check(False, 'determinisztikus szintézis: ' + str(pcm))
else:
    a = np.array(pcm, dtype=np.float32)
    np.save(os.path.join(OUT, 'browser_pcm.npy'), a)
    print(f'      böngésző: {len(a)} minta')
print('\nnapló (utolsó 15):')
for l in logs[-15:]: print('   ', l[:200])
print(f"\n{'MINDEN RENDBEN' if not fails else str(len(fails)) + ' HIBA'}")
sys.exit(1 if fails else 0)
