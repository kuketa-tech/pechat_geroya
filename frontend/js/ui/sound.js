// Синтезированные звуки через WebAudio — без загрузки файлов и задержек.

let ctx = null;
let master = null;
let noise = null;
let enabled = true;
let volume = 0.55;

function ensure() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    // Короткий буфер белого шума для «щелчка» клавиши
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { type = 'sine', at = 0, dur = 0.12, gain = 0.2, slide = 0 } = {}) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sound = {
  configure({ sound: on, volume: vol }) {
    enabled = !!on;
    volume = vol ?? volume;
    if (master) master.gain.value = volume;
  },

  /** Разблокировать аудио по первому жесту пользователя. */
  unlock() { ensure(); },

  key() {
    const c = ensure();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 + Math.random() * 900;
    bp.Q.value = 1.4;
    const g = c.createGain();
    g.gain.value = 0.55;
    src.connect(bp).connect(g).connect(master);
    src.start();
    tone(170 + Math.random() * 30, { type: 'sine', dur: 0.05, gain: 0.08 });
  },

  error() {
    tone(150, { type: 'triangle', dur: 0.16, gain: 0.22, slide: -60 });
    tone(110, { type: 'square', dur: 0.08, gain: 0.04 });
  },

  combo(tier) {
    const base = [0, 523.25, 659.25, 783.99][tier] || 523.25;
    [1, 1.25, 1.5, 2].forEach((m, i) => tone(base * m, { at: i * 0.055, dur: 0.18, gain: 0.12, type: 'triangle' }));
  },

  bonus() {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, { at: i * 0.04, dur: 0.22, gain: 0.08 }));
  },

  finish() {
    [392, 523.25, 659.25].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.3, gain: 0.12, type: 'triangle' }));
  },

  levelUp() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, { at: i * 0.08, dur: 0.45, gain: 0.12, type: 'triangle' }));
    tone(261.63, { at: 0, dur: 0.9, gain: 0.08 });
  },

  achievement() {
    [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.35, gain: 0.1 }));
  },
};
