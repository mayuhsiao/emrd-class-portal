/* =========================================================
 * EMRD Lucky Draw — 音效引擎
 * 全部用 Web Audio 即時合成：免音檔、離線也能用
 *  - 轉動滴答聲、小鼓滾奏、停輪「喀鏘」、開獎爆擊 + 銅管號角
 *  - 煙火升空 / 爆炸 / 劈啪聲、背景音樂（原創派對節奏）
 * ========================================================= */
(function (LD) {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var master, sfx, music, verbIn, noiseBuf;
  var enabled = true;
  var musicOn = false;
  var ducked = false;
  var lastTick = 0;
  var lastBoom = 0;

  var MUSIC_LEVEL = 0.26;
  var MUSIC_DUCKED = 0.06;

  var SEMI = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  function hz(note) {
    var m = /^([A-G][#b]?)(-?\d)$/.exec(note);
    var midi = SEMI[m[1]] + (parseInt(m[2], 10) + 1) * 12;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------- 建立音訊管線（必須在使用者按鍵 / 點擊後才能啟動） ---------- */
  function ensure() {
    if (!AC) return false;
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { AC = null; return false; }

      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 16;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.18;

      master = ctx.createGain();
      master.gain.value = enabled ? 0.85 : 0;
      master.connect(comp);
      comp.connect(ctx.destination);

      sfx = ctx.createGain();
      sfx.connect(master);

      var verb = ctx.createConvolver();
      verb.buffer = impulse(2.8, 2.6);
      verbIn = ctx.createGain();
      verbIn.gain.value = 0.55;
      verbIn.connect(verb);
      verb.connect(master);

      music = ctx.createGain();
      music.gain.value = 0;
      music.connect(master);
      var musicWet = ctx.createGain();
      musicWet.gain.value = 0.25;
      music.connect(musicWet);
      musicWet.connect(verbIn);

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  /** 人工殘響（大廳迴音），讓號角與鈸聲更華麗 */
  function impulse(sec, decay) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * sec);
    var buf = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function on() { return enabled && ensure(); }
  function osc(type, f) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function filt(type, f, q) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  function noise() { var s = ctx.createBufferSource(); s.buffer = noiseBuf; return s; }

  /** 一條輸出線：乾聲送到 dest（預設音效匯流排），另外 wet 比例送進殘響 */
  function out(wet, dest) {
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(dest || sfx);
    if (wet && !dest) {
      var w = ctx.createGain();
      w.gain.value = wet;
      g.connect(w);
      w.connect(verbIn);
    }
    return g;
  }

  /** 敲擊型包絡：瞬間起音 → 指數衰減 */
  function hit(g, t, peak, decay, attack) {
    var a = attack || 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  /* ---------- 轉動滴答聲 ---------- */
  var TICK_F = [2350, 1980, 2640, 2150];
  function tick(variant) {
    if (!on()) return;
    var t = ctx.currentTime;
    if (t - lastTick < 0.028) return; // 多個滾筒同時轉時避免糊成一片
    lastTick = t;
    t += 0.004;
    var f = TICK_F[(variant || 0) % TICK_F.length] * rand(0.97, 1.03);
    var o = osc('triangle', f);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.035);
    var g = out(0.05);
    hit(g, t, 0.2, 0.045, 0.002);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.07);

    var n = noise();
    var hp = filt('highpass', 3800, 0.7);
    var ng = out(0);
    hit(ng, t, 0.14, 0.012, 0.001);
    n.connect(hp);
    hp.connect(ng);
    n.start(t, Math.random() * 1.5, 0.03);
  }

  /* ---------- 小鼓滾奏（轉動中持續，停輪時漸強） ---------- */
  var roll = { timer: 0, next: 0, level: 0.4, target: 0.4 };
  function snare(t, v) {
    var n = noise();
    var bp = filt('bandpass', rand(2000, 2800), 0.7);
    var g = out(0.12);
    hit(g, t, 0.5 * v, 0.1, 0.004);
    n.connect(bp);
    bp.connect(g);
    n.start(t, Math.random() * 1.6, 0.14);

    var o = osc('triangle', 240);
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    var og = out(0.05);
    hit(og, t, 0.26 * v, 0.07, 0.003);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.1);
  }
  function rollPump() {
    if (!ctx) return;
    var horizon = ctx.currentTime + 0.12;
    while (roll.next < horizon) {
      roll.level += (roll.target - roll.level) * 0.07;
      snare(roll.next, roll.level * rand(0.72, 1));
      roll.next += 1 / rand(17, 20);
    }
  }
  function rollStart(level) {
    if (!on()) return;
    roll.target = level || 0.4;
    if (roll.timer) return;
    roll.level = roll.target * 0.5;
    roll.next = ctx.currentTime + 0.05;
    roll.timer = setInterval(rollPump, 25);
    rollPump();
  }
  function rollTo(level) { roll.target = level; }
  function rollStop() {
    clearInterval(roll.timer);
    roll.timer = 0;
  }

  /* ---------- 開始轉動：呼嘯 + 能量上衝 ---------- */
  function whoosh() {
    if (!on()) return;
    var t = ctx.currentTime + 0.01;
    var n = noise();
    var bp = filt('bandpass', 300, 1.1);
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + 0.5);
    var g = out(0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.22);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    n.connect(bp);
    bp.connect(g);
    n.start(t, 0, 0.7);

    var o = osc('sawtooth', 110);
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.5);
    var lp = filt('lowpass', 1400, 5);
    var og = out(0.2);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.13, t + 0.12);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.58);
    o.connect(lp);
    lp.connect(og);
    o.start(t);
    o.stop(t + 0.62);
  }

  /* ---------- 鐘聲（亮晶晶） ---------- */
  function bell(t, f, vol, dur, dest) {
    [[1, 1], [2.76, 0.32], [5.4, 0.1], [8.93, 0.04]].forEach(function (p) {
      var o = osc('sine', f * p[0]);
      var g = out(dest ? 0 : 0.5, dest);
      hit(g, t, vol * p[1], dur / (1 + p[0] * 0.3), 0.003);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  }

  /* ---------- 單一滾筒停下：喀鏘！ ---------- */
  var LAND_NOTES = ['E6', 'G6', 'A6', 'C7', 'D7'];
  function thunk(i) {
    if (!on()) return;
    var t = ctx.currentTime + 0.005;
    var o = osc('sine', 170);
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.2);
    var g = out(0.15);
    hit(g, t, 0.95, 0.34, 0.004);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.42);

    [1, 1.47, 2.09].forEach(function (m) {
      var p = osc('square', 520 * m);
      var bp = filt('bandpass', 1900, 4);
      var pg = out(0.3);
      hit(pg, t, 0.06, 0.2, 0.002);
      p.connect(bp);
      bp.connect(pg);
      p.start(t);
      p.stop(t + 0.25);
    });
    bell(t + 0.02, hz(LAND_NOTES[(i || 0) % LAND_NOTES.length]), 0.2, 1.1);
  }

  /* ---------- 開獎爆擊：重低音 + 碎音鈸 ---------- */
  function impact() {
    if (!on()) return;
    var t = ctx.currentTime + 0.01;
    var o = osc('sine', 110);
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.8);
    var g = out(0.2);
    hit(g, t, 1, 1.1, 0.008);
    o.connect(g);
    o.start(t);
    o.stop(t + 1.25);

    var n = noise();
    n.loop = true;
    var hp = filt('highpass', 4200, 0.5);
    var pk = filt('peaking', 8200, 1.4);
    pk.gain.value = 7;
    var cg = out(0.65);
    hit(cg, t, 0.5, 2.6, 0.006);
    n.connect(hp);
    hp.connect(pk);
    pk.connect(cg);
    n.start(t);
    n.stop(t + 2.8);
  }

  /* ---------- 銅管號角 ---------- */
  function brass(t, f, dur, vol, vibrato) {
    var g = out(0.5);
    var lp = filt('lowpass', 500, 1.5);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(3800, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(2100, t + 0.35);
    lp.connect(g);
    var lfo = null;
    var lfoGain = null;
    if (vibrato) {
      lfo = osc('sine', 5.5);
      lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0, t);
      lfoGain.gain.linearRampToValueAtTime(14, t + 0.5);
      lfo.connect(lfoGain);
      lfo.start(t);
      lfo.stop(t + dur + 0.8);
    }
    [-8, 0, 8].forEach(function (cents) {
      var o = osc('sawtooth', f);
      o.detune.value = cents;
      if (lfoGain) lfoGain.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.8);
    });
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.035);
    g.gain.setTargetAtTime(vol * 0.72, t + 0.08, 0.12);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.13);
  }
  function timpani(t, f, vol) {
    var o = osc('sine', f * 1.5);
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    var g = out(0.35);
    hit(g, t, vol, 1.2, 0.005);
    o.connect(g);
    o.start(t);
    o.stop(t + 1.4);
  }
  function fanfare() {
    if (!on()) return;
    var t = ctx.currentTime + 0.05;
    brass(t, hz('G4'), 0.1, 0.15);
    brass(t + 0.13, hz('G4'), 0.1, 0.15);
    brass(t + 0.26, hz('G4'), 0.1, 0.15);
    var a = t + 0.4;
    ['C4', 'E4', 'G4', 'C5'].forEach(function (n) { brass(a, hz(n), 0.48, 0.1); });
    timpani(a, hz('C2'), 0.7);
    var b = a + 0.56;
    ['F4', 'A4', 'C5'].forEach(function (n) { brass(b, hz(n), 0.16, 0.1); });
    var c = b + 0.2;
    ['G4', 'B4', 'D5'].forEach(function (n) { brass(c, hz(n), 0.16, 0.1); });
    timpani(c, hz('G2'), 0.5);
    var d = c + 0.21;
    ['C4', 'G4', 'C5', 'E5', 'G5'].forEach(function (n) { brass(d, hz(n), 1.7, 0.1, true); });
    timpani(d, hz('C2'), 0.85);
    timpani(d + 0.12, hz('C2'), 0.5);
  }

  /* ---------- 魔法亮晶晶 ---------- */
  var SPARKLE = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7', 'G7'];
  function chimes(count) {
    if (!on()) return;
    var t0 = ctx.currentTime + 0.02;
    var n = count || 14;
    for (var i = 0; i < n; i++) {
      bell(t0 + i * 0.07 + Math.random() * 0.05, hz(SPARKLE[Math.min(SPARKLE.length - 1, Math.floor(i / n * SPARKLE.length + Math.random() * 2))]), rand(0.05, 0.11), 1.4);
    }
  }

  /* ---------- 煙火 ---------- */
  function launch() {
    if (!on()) return;
    var t = ctx.currentTime + 0.01;
    var d = rand(0.7, 1.1);
    var o = osc('sine', 500);
    o.frequency.setValueAtTime(rand(380, 560), t);
    o.frequency.exponentialRampToValueAtTime(rand(1400, 2100), t + d);
    var g = out(0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g);
    o.start(t);
    o.stop(t + d + 0.05);
  }
  function boom(size) {
    if (!on()) return;
    var t = ctx.currentTime;
    if (t - lastBoom < 0.09) return;
    lastBoom = t;
    t += 0.005;
    var v = 0.32 + (size || 1) * 0.3;
    var n = noise();
    var lp = filt('lowpass', rand(800, 1500), 0.7);
    var g = out(0.55);
    hit(g, t, v, 1.1, 0.008);
    n.connect(lp);
    lp.connect(g);
    n.start(t, Math.random() * 0.4, 1.4);

    var o = osc('sine', 90);
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.45);
    var og = out(0.1);
    hit(og, t, v * 0.9, 0.55, 0.006);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.65);
  }
  function crackle(count, spread) {
    if (!on()) return;
    var t0 = ctx.currentTime + 0.25;
    for (var i = 0; i < (count || 24); i++) {
      var t = t0 + Math.random() * (spread || 1.2);
      var n = noise();
      var hp = filt('highpass', rand(3000, 6500), 0.8);
      var g = out(0.35);
      hit(g, t, rand(0.04, 0.14), rand(0.015, 0.045), 0.001);
      n.connect(hp);
      hp.connect(g);
      n.start(t, Math.random() * 1.8, 0.07);
    }
  }

  /* ---------- 介面小音效 ---------- */
  function blip(up) {
    if (!on()) return;
    var t = ctx.currentTime + 0.005;
    var o = osc('sine', up ? 660 : 520);
    o.frequency.setValueAtTime(up ? 660 : 520, t);
    o.frequency.exponentialRampToValueAtTime(up ? 990 : 390, t + 0.08);
    var g = out(0.1);
    hit(g, t, 0.12, 0.12, 0.004);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.16);
  }
  function error() {
    if (!on()) return;
    var t = ctx.currentTime + 0.005;
    [0, 0.14].forEach(function (dt) {
      var o = osc('square', 180);
      var lp = filt('lowpass', 900, 1);
      var g = out(0);
      hit(g, t + dt, 0.12, 0.1, 0.004);
      o.connect(lp);
      lp.connect(g);
      o.start(t + dt);
      o.stop(t + dt + 0.13);
    });
  }

  /* ---------- 背景音樂：原創派對節奏（F 大調、120 BPM、16 小節循環） ---------- */
  var SONG = (function () {
    // 主旋律：[音高, 拍數]，'R' 為休止
    var mel = [
      ['C5', 0.5], ['A4', 0.5], ['C5', 1], ['D5', 0.5], ['C5', 0.5], ['A4', 1],
      ['G4', 0.5], ['C5', 0.5], ['E5', 1], ['D5', 1], ['C5', 1],
      ['D5', 0.5], ['F5', 0.5], ['D5', 1], ['C5', 0.5], ['A4', 0.5], ['F4', 1],
      ['F4', 1], ['G4', 0.5], ['A4', 0.5], ['Bb4', 1], ['D5', 1],
      ['C5', 0.5], ['A4', 0.5], ['C5', 1], ['F5', 1], ['E5', 0.5], ['F5', 0.5],
      ['G5', 1], ['E5', 1], ['C5', 1], ['G4', 1],
      ['F5', 0.5], ['D5', 0.5], ['Bb4', 1], ['C5', 0.5], ['E5', 0.5], ['G5', 1],
      ['E5', 1], ['D5', 1], ['C5', 2],
      ['D5', 1], ['F5', 1], ['D5', 0.5], ['C5', 0.5], ['Bb4', 1],
      ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1],
      ['A5', 1], ['G5', 0.5], ['E5', 0.5], ['C5', 1], ['E5', 1],
      ['F5', 1.5], ['E5', 0.5], ['D5', 1], ['A4', 1],
      ['Bb4', 0.5], ['D5', 0.5], ['F5', 1], ['D5', 1], ['Bb4', 1],
      ['C5', 0.5], ['E5', 0.5], ['G5', 1], ['A5', 0.5], ['G5', 0.5], ['E5', 1],
      ['F5', 1], ['C5', 1], ['A4', 1], ['C5', 1],
      ['F5', 3], ['R', 1]
    ];
    // 和弦：每小節一個；陣列代表前、後半小節各一個
    var bars = ['F', 'C', 'Dm', 'Bb', 'F', 'C', ['Bb', 'C'], 'C', 'Bb', 'C', 'Am', 'Dm', 'Bb', 'C', 'F', 'F'];
    var CH = {
      F: { root: 'F2', fifth: 'C3', tri: ['F4', 'A4', 'C5'] },
      C: { root: 'C3', fifth: 'G2', tri: ['E4', 'G4', 'C5'] },
      Dm: { root: 'D3', fifth: 'A2', tri: ['D4', 'F4', 'A4'] },
      Bb: { root: 'Bb2', fifth: 'F2', tri: ['D4', 'F4', 'Bb4'] },
      Am: { root: 'A2', fifth: 'E2', tri: ['E4', 'A4', 'C5'] }
    };
    var ev = [];
    var b = 0;
    mel.forEach(function (m) {
      if (m[0] !== 'R') ev.push({ b: b, k: 'mel', f: hz(m[0]), d: m[1] });
      b += m[1];
    });
    bars.forEach(function (c, i) {
      var o = i * 4;
      var first = CH[Array.isArray(c) ? c[0] : c];
      var second = CH[Array.isArray(c) ? c[1] : c];
      ev.push({ b: o, k: 'bass', f: hz(first.root) });
      ev.push({ b: o + 1.5, k: 'bass', f: hz(first.fifth), soft: true });
      ev.push({ b: o + 2, k: 'bass', f: hz(second.root) });
      ev.push({ b: o + 3.5, k: 'bass', f: hz(second.fifth), soft: true });
      ev.push({ b: o + 1, k: 'stab', fs: first.tri.map(hz) });
      ev.push({ b: o + 3, k: 'stab', fs: second.tri.map(hz) });
      ev.push({ b: o, k: 'kick' });
      ev.push({ b: o + 2, k: 'kick' });
      ev.push({ b: o + 1, k: 'clap' });
      ev.push({ b: o + 3, k: 'clap' });
    });
    for (var j = 0; j < 128; j++) ev.push({ b: j * 0.5, k: 'hat', acc: j % 2 === 1 });
    ev.sort(function (x, y) { return x.b - y.b; });
    return { ev: ev, beats: b };
  })();

  var bgm = { timer: 0, i: 0, t0: 0, beat: 60 / 120 };

  /** 明亮的撥弦主旋律 */
  function lead(t, f, dur, vol) {
    var g = out(0, music);
    var lp = filt('lowpass', 3200, 0.6);
    lp.connect(g);
    var o1 = osc('triangle', f);
    var o2 = osc('square', f * 2);
    var g2 = ctx.createGain();
    g2.gain.value = 0.12;
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    hit(g, t, vol, dur, 0.005);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.1);
    o2.stop(t + dur + 0.1);
  }
  function pluck(t, f, dur, vol) {
    var o = osc('triangle', f);
    var lp = filt('lowpass', 1300, 0.8);
    var g = out(0, music);
    hit(g, t, vol, dur, 0.005);
    o.connect(lp);
    lp.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function kick(t) {
    var o = osc('sine', 130);
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    var g = out(0, music);
    hit(g, t, 0.42, 0.2, 0.003);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.26);
  }
  function clap(t) {
    [0, 0.011, 0.022].forEach(function (d, i) {
      var n = noise();
      var bp = filt('bandpass', 1400, 0.9);
      var g = out(0, music);
      hit(g, t + d, i === 2 ? 0.16 : 0.1, i === 2 ? 0.13 : 0.02, 0.001);
      n.connect(bp);
      bp.connect(g);
      n.start(t + d, Math.random() * 1.5, 0.16);
    });
  }
  function hat(t, vol) {
    var n = noise();
    var hp = filt('highpass', 8000, 0.7);
    var g = out(0, music);
    hit(g, t, vol, 0.035, 0.001);
    n.connect(hp);
    hp.connect(g);
    n.start(t, Math.random() * 1.8, 0.06);
  }
  function playEvent(e, t) {
    if (e.k === 'mel') lead(t, e.f, Math.min(0.9, e.d * bgm.beat + 0.25), 0.15);
    else if (e.k === 'bass') pluck(t, e.f, e.soft ? 0.25 : 0.4, e.soft ? 0.14 : 0.24);
    else if (e.k === 'stab') e.fs.forEach(function (f) { pluck(t, f, 0.18, 0.045); });
    else if (e.k === 'kick') kick(t);
    else if (e.k === 'clap') clap(t);
    else hat(t, e.acc ? 0.06 : 0.035);
  }
  function bgmPump() {
    if (!ctx) return;
    var horizon = ctx.currentTime + 0.3;
    for (var guard = 0; guard < 80; guard++) {
      var e = SONG.ev[bgm.i];
      var t = bgm.t0 + e.b * bgm.beat;
      if (t > horizon) break;
      if (t > ctx.currentTime - 0.05) playEvent(e, t);
      bgm.i++;
      if (bgm.i >= SONG.ev.length) {
        bgm.i = 0;
        bgm.t0 += SONG.beats * bgm.beat;
      }
    }
  }
  function bgmStart() {
    if (bgm.timer || !ctx) return;
    bgm.i = 0;
    bgm.t0 = ctx.currentTime + 0.15;
    bgm.timer = setInterval(bgmPump, 50);
    bgmPump();
  }
  function bgmStop() {
    clearInterval(bgm.timer);
    bgm.timer = 0;
  }
  function musicTarget() { return musicOn && enabled ? (ducked ? MUSIC_DUCKED : MUSIC_LEVEL) : 0; }
  function applyMusic() {
    if (!ctx) return;
    var t = ctx.currentTime;
    music.gain.cancelScheduledValues(t);
    music.gain.setTargetAtTime(musicTarget(), t, 0.3);
    if (musicOn && enabled) bgmStart();
    else setTimeout(function () { if (!(musicOn && enabled)) bgmStop(); }, 1500);
  }
  function setMusic(v) {
    musicOn = !!v;
    if (musicOn && !ensure()) return;
    applyMusic();
  }
  function duck(v) {
    ducked = !!v;
    applyMusic();
  }

  /* ---------- 總開關 ---------- */
  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) rollStop();
    if (ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(enabled ? 0.85 : 0, ctx.currentTime, 0.05);
      applyMusic();
    }
  }

  LD.sound = {
    unlock: ensure,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    tick: tick,
    rollStart: rollStart,
    rollTo: rollTo,
    rollStop: rollStop,
    whoosh: whoosh,
    thunk: thunk,
    impact: impact,
    fanfare: fanfare,
    chimes: chimes,
    launch: launch,
    boom: boom,
    crackle: crackle,
    blip: blip,
    error: error,
    setMusic: setMusic,
    duck: duck
  };
})(window.LD = window.LD || {});
