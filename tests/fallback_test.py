"""Ha a beépített hang nem indul el (pl. tiltott WASM vagy hiányzó fájl), a böngésző hangjával olvas tovább."""
import functools, http.server, os, sys, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import importlib.util
spec = importlib.util.spec_from_file_location('e2e_fake', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake_speech.js'))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAKE = open(os.path.join(ROOT, 'tests', 'fake_speech.js'), encoding='utf-8').read()

class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.wasm': 'application/wasm'}
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/dist/test.html'
fails = []
def check(c, m):
    print(('  ok  ' if c else '  HIBA') + ' ' + m)
    if not c: fails.append(m)
with sync_playwright() as p:
    b = p.chromium.launch()
    for label, route in [('hiányzó worker', '**/tts/worker.mjs'), ('hiányzó modelldarab', '**/tts/imre/model-3.bin')]:
        print(label)
        ctx = b.new_context(locale='hu-HU')
        ctx.add_init_script(FAKE)
        ctx.route(route, lambda r: r.fulfill(status=404, body='nincs'))
        pg = ctx.new_page()
        pg.goto(URL)
        pg.wait_for_selector('#chapter .s')
        pg.click('#playBtn')
        pg.wait_for_function("window.__spoken.length >= 2", timeout=60000)
        check(True, 'a böngésző hangjával folytatja')
        toast = pg.evaluate("document.querySelector('#toast').textContent")
        check(('Imre' in toast) and ('böngésző saját hangjával' in toast), f'érthető üzenet: {toast[:90]}')
        check(pg.evaluate("document.querySelector('#voiceChip').classList.contains('warn')"), 'a hangcímke figyelmeztet')
        ctx.close()
    b.close()
srv.shutdown()
print('MINDEN RENDBEN' if not fails else f'{len(fails)} HIBA')
sys.exit(1 if fails else 0)
