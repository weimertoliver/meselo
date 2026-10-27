# Mesélő

EPUB-könyveket olvas fel természetes magyar hangon, telefonon és számítógépen is. Telepíthető webapp (PWA): egyszer kell megnyitni, utána saját ikonnal indul, és internet nélkül is működik.

**Megnyitás:** https://weimertoliver.github.io/meselo/

## Mit tud

- EPUB-könyvek felolvasása Imre hangján (Piper neurális hangmodell). A hang a böngészőben készül, a könyvek nem kerülnek fel sehová.
- Magyar kiejtési szabályok: évszámok, dátumok, sorszámnevek, római számok, toldalékos számok, rövidítések, mértékegységek.
- Gondolatjeles párbeszéd és versek tagolt felolvasása.
- Mondatkiemelés, kattintásra onnan folytatja, tempóállítás, elalvási időzítő.
- Könyvtár és könyvjelző: minden könyvnél megjegyzi, hol tartasz.
- Saját kiejtési szótár (például `Chicago = Sikágó`).
- Telefonon zárolt képernyővel is olvas, és a zárolt képernyőről is vezérelhető.

## Telepítés

**Android:** nyisd meg a fenti címet Chrome-ban, majd a jobb felső menüben (⋮) válaszd a **Telepítés** (vagy **Hozzáadás a kezdőképernyőhöz**) pontot.

**Windows:** nyisd meg Edge-ben vagy Chrome-ban, és kattints a címsor jobb szélén megjelenő telepítés ikonra, vagy a Mesélő Könyvtár paneljén a **Mesélő telepítése** gombra. Telepítés után az EPUB-fájlokat a Windows Intézőből is megnyithatod vele (jobb klikk → Társítás → Mesélő).

Első felolvasáskor a Mesélő letölti Imre hangját (kb. 72 MB). Ez az eszközön marad, legközelebb már nem kell letölteni.

## Fejlesztés

| Mappa, fájl | Tartalom |
| --- | --- |
| `src/` | a felület (`page.html`, `style.css`), az app (`app.js`), az EPUB-olvasó (`epub.js`) és a magyar szövegelőkészítő (`hutext.js`) |
| `tts/worker.mjs` | a hangmotor egy Web Workerben: fonémák espeak-ng-vel, hang ONNX Runtime Webbel |
| `pwa/` | service worker, ikonok |
| `vendor/` | ONNX Runtime Web, a WebAssemblyre fordított espeak-ng és Imre hangjának beállításai |
| `docs/` | a kész webapp, ezt szolgálja ki a GitHub Pages |
| `tests/` | egység- és böngészős tesztek |

```sh
sh scripts/fetch-model.sh      # egyszer: Imre hangmodellje a vendor/imre/ mappába
node build.mjs                 # docs/ (a webapp) és dist/test.html (tesztoldal)

node tests/hutext.test.cjs     # kiejtési szabályok
python3 tests/make_epub.py tests/out
python3 tests/e2e.py           # felület, EPUB-megnyitás, felolvasás böngészőhanggal
python3 tests/engine_test.py   # Imre hangja Chromiumban
python3 tests/fallback_test.py # ha a hangmotor nem indul, a böngésző hangjával olvas
python3 tests/pwa_test.py      # telepíthetőség, offline működés
```

A böngészős tesztekhez Python Playwright és Chromium kell.

## Licencek és köszönet

- **Mesélő**: GPL-3.0 (lásd `LICENSE`), mert az espeak-ng is GPL-3.0 licencű.
- **Imre hangja**: [Piper](https://github.com/OHF-Voice/piper1-gpl) hangmodell az Open Home Foundation CC0 licencű magyar hangfelvételei alapján ([voice-datasets](https://github.com/NabuCasa/voice-datasets)), a [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) kiadásából.
- **Fonémák**: [espeak-ng](https://github.com/rhasspy/espeak-ng) (GPL-3.0) és [piper-phonemize](https://github.com/wide-video/piper-phonemize) (MIT), WebAssemblyre fordítva ([@diffusionstudio/piper-wasm](https://www.npmjs.com/package/@diffusionstudio/piper-wasm)). A `piper_phonemize.data` csak a magyar és az angol nyelvi adatokat tartalmazza.
- **Futtatás**: [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.22.0 (MIT, Copyright © Microsoft Corporation).
- **Betűtípusok**: Literata és IBM Plex Sans (SIL Open Font License), a Google Fonts-ról.
