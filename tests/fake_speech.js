
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
