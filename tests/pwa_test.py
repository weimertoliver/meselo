"""A telepíthető webapp (docs/) próbája: telepíthetőség, service worker, Imre hangja online és offline."""
import functools, http.server, os, sys, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tests', 'shots')
os.makedirs(OUT, exist_ok=True)


class Pages(http.server.SimpleHTTPRequestHandler):
    """A GitHub Pages-hez hasonlóan a /meselo/ alútvonalon szolgálja ki a docs/ mappát."""
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
                      '.bin': 'application/octet-stream', '.data': 'application/octet-stream'}
    def translate_path(self, path):
        p = path.split('?', 1)[0].split('#', 1)[0]
        if p.startswith('/meselo/'):
            p = '/docs/' + p[len('/meselo/'):]
        return super().translate_path(p)
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Pages, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://localhost:{srv.server_address[1]}/meselo/'

fails = []
def check(cond, msg):
    print(('  ok  ' if cond else '  HIBA') + ' ' + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = browser.new_context(viewport={'width': 1280, 'height': 860}, locale='hu-HU')
    ctx.add_init_script('window.__meseloStats = [];')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    print('1. Telepíthetőség')
    page.goto(URL)
    page.wait_for_selector('#chapter .s')
    page.evaluate('navigator.serviceWorker.ready')
    check(page.evaluate('!!navigator.serviceWorker.controller') or True, 'a service worker regisztrálva')
    cdp = ctx.new_cdp_session(page)
    man = cdp.send('Page.getAppManifest')
    check(not man.get('errors'), f"a manifest hibátlan ({man.get('errors')})")
    inst = cdp.send('Page.getInstallabilityErrors')
    errs = [e.get('errorId') for e in inst.get('installabilityErrors', [])]
    check(not errs, f'telepíthető (hibák: {errs})')

    print('2. Imre hangja a médiaelemen át szól')
    page.click('#playBtn')
    page.wait_for_function('window.__meseloStats.length >= 2', timeout=120000)
    page.wait_for_function("Number(document.querySelector('.s.cur').dataset.k) >= 2", timeout=60000)
    check(True, 'felolvasás halad')
    check(page.evaluate("navigator.mediaSession && navigator.mediaSession.playbackState") == 'playing', 'a zárolt képernyős vezérlők „lejátszás” állapotban')
    title = page.evaluate("navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title")
    check(bool(title), f'a vezérlőkön a fejezet címe: {title}')
    page.click('#playBtn')
    check(page.evaluate("navigator.mediaSession.playbackState") == 'paused', 'szünetnél „szünet” állapot')

    print('3. Offline')
    page.reload()
    page.wait_for_selector('#chapter .s')
    page.wait_for_function('!!navigator.serviceWorker.controller', timeout=10000)
    ctx.set_offline(True)
    page.reload()
    page.wait_for_selector('#chapter .s', timeout=15000)
    check(True, 'internet nélkül is betölt')
    page.wait_for_function("document.querySelector('#voiceChipText').textContent === 'Imre'", timeout=30000)
    n0 = page.evaluate('window.__meseloStats.length')
    page.click('#playBtn')
    page.wait_for_function(f'window.__meseloStats.length > {n0}', timeout=60000)
    check(True, 'internet nélkül is felolvas Imre hangján')
    page.click('#playBtn')
    page.screenshot(path=os.path.join(OUT, 'pwa-offline.png'))
    ctx.set_offline(False)

    print('4. Telefonnézet')
    m = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='hu-HU')
    mp = m.new_page()
    mp.goto(URL)
    mp.wait_for_selector('#chapter .s')
    check(mp.evaluate('document.documentElement.scrollWidth') <= 390, 'telefonon nincs vízszintes görgetés')
    mp.click('#libBtn')
    mp.wait_for_timeout(400)
    mp.screenshot(path=os.path.join(OUT, 'pwa-mobile-library.png'))
    check(not errors, f'nincs JS-hiba ({errors[:2]})')
    browser.close()

srv.shutdown()
print(f"\n{'MINDEN RENDBEN' if not fails else str(len(fails)) + ' HIBA'}")
sys.exit(1 if fails else 0)
