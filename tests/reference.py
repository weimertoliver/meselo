"""A böngészőbeli hangmotor kimenetének összevetése a Python Piperrel (ugyanazzal a kettős mássalhangzó- és vesszőlogikával).

Futtatás az engine_test.py után (az menti a tests/shots/browser_pcm.npy fájlt):
    python tests/reference.py        # kell hozzá: pip install piper-tts onnxruntime
"""
import os, sys, unicodedata
import numpy as np, onnxruntime as ort
from piper import PiperVoice

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXT = 'Doktor Kovács Éva, a szomszédunk, körülbelül három egész öt tized kilométerre lakik a második kerülettől.'
GEMINATE = 1.35
COMMA_PAUSE = 1.3
NOT_CONSONANT = set('aɑeɛioøuyɒəˈˌːʲ ,.;:!?-–—…\'"()«»„”')

voice = PiperVoice.load(os.path.join(ROOT, 'vendor/imre/hu_HU-imre-medium.onnx'))
sess = ort.InferenceSession(os.path.join(ROOT, 'vendor/imre/hu_HU-imre-medium.dur.onnx'))
IDS = voice.config.phoneme_id_map

def r_units(text):
    t, out, i = text.lower(), [], 0
    while i < len(t):
        if t[i] == 'r':
            if i + 1 < len(t) and t[i + 1] == 'r': out.append(True); i += 2; continue
            out.append(False)
        i += 1
    return out

def restore_rr(text, sents):
    units = r_units(text)
    if not any(units) or sum(s.count('r') for s in sents) != len(units): return sents
    it = iter(units)
    return [''.join(('rr' if next(it) else 'r') if c == 'r' else c for c in s) for s in sents]

def ids_scale(ph):
    toks = [c for c in unicodedata.normalize('NFD', ph) if c in IDS]
    ids, pos = IDS['^'] + IDS['_'], []
    for c in toks: pos.append(len(ids)); ids += IDS[c] + IDS['_']
    ids += IDS['$']
    sc = np.ones(len(ids), dtype=np.float32)
    def mark(k, pad, f=GEMINATE): sc[pos[k]:pos[k] + len(IDS[toks[k]]) + (len(IDS['_']) if pad else 0)] = f
    for k in range(len(toks) - 1):
        a, b = toks[k], toks[k + 1]
        if a in NOT_CONSONANT or (b != a and b != 'ː'): continue
        mark(k, True); mark(k + 1, False)
        p = toks[k - 1] if k else None
        if b == 'ː' and ((p == 't' and a in 'sʃ') or (p == 'd' and a in 'zʒ')): mark(k - 1, True)
    for k, c in enumerate(toks):
        if c != ',': continue
        mark(k, True, COMMA_PAUSE)
        if k + 1 < len(toks) and toks[k + 1] == ' ': mark(k + 1, True, COMMA_PAUSE)
    return ids, sc

def synth(text):
    sents = restore_rr(text, [''.join(s) for s in voice.phonemize(text)])
    parts = []
    for ph in sents:
        ids, sc = ids_scale(ph)
        a = sess.run(None, {'input': np.array([ids], dtype=np.int64), 'input_lengths': np.array([len(ids)], dtype=np.int64),
                            'scales': np.array([0, 1, 0], dtype=np.float32), 'dur_scale': sc.reshape(1, 1, -1)})[0].squeeze()
        speech = a[np.abs(a) > 0.02]
        g = 0.12 / np.sqrt(np.mean(speech ** 2))
        g = min(g, 0.95 / np.abs(a).max())
        parts.append(a * g)
    gap = np.zeros(round(22050 * 0.12), dtype=np.float32)
    out = np.concatenate([x for p in parts for x in (gap, p)][1:])
    f = round(22050 * 0.006)
    ramp = np.arange(f) / f
    out[:f] *= ramp; out[-f:] *= ramp[::-1]
    return out, sents

ref, sents = synth(TEXT)
print('fonémák:', ' | '.join(sents))
b = np.load(os.path.join(ROOT, 'tests/shots/browser_pcm.npy'))
n = min(len(b), len(ref))
corr = float(np.corrcoef(b[:n], ref[:n])[0, 1])
print(f'hossz: böngésző {len(b)}, Python {len(ref)} · korreláció {corr:.5f} · max eltérés {np.abs(b[:n] - ref[:n]).max():.4f}')
ok = len(b) == len(ref) and corr > 0.999
print('EGYEZIK' if ok else 'ELTÉR')
sys.exit(0 if ok else 1)
