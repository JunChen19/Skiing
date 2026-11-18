/* ================= audio.js ================= */
// 全程序化 WebAudio 音效：风声、刻雪、擦树呼啸、撞击、UI 音（零音频文件）
'use strict';

function makeSfx() {
  let ctx = null, master = null, noiseBuf = null;
  let wind = null, carve = null;
  let muted = localStorage.getItem(CFG.MUTE_KEY) === '1';

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    // 白噪声源
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 风：带通噪声，随速度升频升量
    const wSrc = ctx.createBufferSource();
    wSrc.buffer = noiseBuf; wSrc.loop = true;
    const wF = ctx.createBiquadFilter();
    wF.type = 'bandpass'; wF.frequency.value = 420; wF.Q.value = 0.55;
    const wG = ctx.createGain(); wG.gain.value = 0.0;
    wSrc.connect(wF).connect(wG).connect(master);
    wSrc.start();
    wind = { f: wF, g: wG };

    // 刻雪：高通噪声，随侧滑强度
    const cSrc = ctx.createBufferSource();
    cSrc.buffer = noiseBuf; cSrc.loop = true;
    cSrc.playbackRate.value = 0.82;
    const cF = ctx.createBiquadFilter();
    cF.type = 'highpass'; cF.frequency.value = 2100;
    const cG = ctx.createGain(); cG.gain.value = 0;
    cSrc.connect(cF).connect(cG).connect(master);
    cSrc.start();
    carve = { g: cG };
  }

  function update(dt, st) {
    if (!ctx || !wind) return;
    const k = 1 - Math.exp(-8 * dt);
    const wTarget = st.crashed ? 0.03 : 0.04 + st.speedN * 0.30;
    wind.g.gain.value += (wTarget - wind.g.gain.value) * k;
    wind.f.frequency.value += ((360 + st.speedN * 1050) - wind.f.frequency.value) * k;
    const cTarget = st.crashed ? 0 : Math.min(0.3,
      st.slip * st.slip * 0.3 + st.speedN * 0.05 + Math.abs(st.steer || 0) * st.speedN * 0.22);
    carve.g.gain.value += (cTarget - carve.g.gain.value) * k;
  }

  function burst(type, freq0, freq1, dur, gain, q) {
    if (!ctx || muted) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(freq0, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq1), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }
  function tone(freq, dur, gain, type) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator();
    o.type = type || 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.05);
  }

  return {
    init,
    update,
    whoosh() { burst('bandpass', 950, 260, 0.28, 0.5, 1.4); },
    crash() {
      burst('lowpass', 500, 90, 0.5, 0.95, 0.7);
      tone(66, 0.4, 0.6, 'sine');
      setTimeout(() => burst('lowpass', 300, 80, 0.35, 0.4, 0.7), 120);
    },
    click() { tone(680, 0.06, 0.12, 'square'); },
    start() { tone(440, 0.1, 0.1, 'triangle'); setTimeout(() => tone(660, 0.14, 0.1, 'triangle'), 90); },
    over() { tone(392, 0.3, 0.14, 'sine'); setTimeout(() => tone(262, 0.5, 0.14, 'sine'), 200); },
    newBest() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.13, 'triangle'), i * 110));
    },
    setMuted(m) {
      muted = m;
      localStorage.setItem(CFG.MUTE_KEY, m ? '1' : '0');
      if (master) master.gain.value = m ? 0 : 1;
    },
    get muted() { return muted; },
  };
}
