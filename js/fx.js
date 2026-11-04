/* =========================================================
 * EMRD Lucky Draw — 視覺特效（Canvas）
 *  - 背景：星空、三層景深金粉、光斑、流星
 *  - 前景：煙火（球形 / 環形 / 柳枝 / 愛心 / 文字與 emoji 造型）、
 *          紙花砲、落地火花、衝擊波
 * ========================================================= */
(function (LD) {
  'use strict';

  var TAU = Math.PI * 2;
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  var PALETTES = [
    ['#ffd36b', '#fff2c4', '#ffb000'],
    ['#ff3b4f', '#ff8a96', '#ffd36b'],
    ['#2ee59d', '#b6ffdf', '#ffd36b'],
    ['#4da3ff', '#bfe6ff', '#ffffff'],
    ['#ff5fd2', '#ffd1f3', '#a78bfa'],
    ['#a78bfa', '#4da3ff', '#2ee59d'],
    ['#ff8a3d', '#ffd36b', '#ff3b4f']
  ];
  var CONFETTI = ['#ffd36b', '#ff3b4f', '#2ee59d', '#4da3ff', '#ffffff', '#ff8a3d', '#c084fc', '#f472b6'];
  var QUANT = ['#ff3b4f', '#2ee59d', '#ffd36b', '#4da3ff', '#fff2c4', '#ff8a3d', '#c084fc', '#f472b6', '#16a34a', '#b45309'];

  /* ---------- 色彩工具 ---------- */
  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) { var c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  var darkCache = {};
  function darker(hex) {
    if (darkCache[hex]) return darkCache[hex];
    var c = rgb(hex);
    return (darkCache[hex] = 'rgb(' + ((c[0] * 0.62) | 0) + ',' + ((c[1] * 0.62) | 0) + ',' + ((c[2] * 0.62) | 0) + ')');
  }
  var quantRGB = QUANT.map(rgb);
  function quantize(r, g, b) {
    var best = 0;
    var bd = Infinity;
    for (var i = 0; i < quantRGB.length; i++) {
      var q = quantRGB[i];
      var d = (q[0] - r) * (q[0] - r) + (q[1] - g) * (q[1] - g) + (q[2] - b) * (q[2] - b);
      if (d < bd) { bd = d; best = i; }
    }
    return QUANT[best];
  }

  /* ---------- 預先畫好的發光粒子貼圖 ---------- */
  var glowCache = {};
  function glow(color) {
    if (glowCache[color]) return glowCache[color];
    var s = document.createElement('canvas');
    s.width = s.height = 64;
    var g = s.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.14, rgba(color, 1));
    grd.addColorStop(0.38, rgba(color, 0.42));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return (glowCache[color] = s);
  }
  var discCache = {};
  function disc(color) {
    if (discCache[color]) return discCache[color];
    var s = document.createElement('canvas');
    s.width = s.height = 128;
    var g = s.getContext('2d');
    var grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, rgba(color, 0.9));
    grd.addColorStop(0.55, rgba(color, 0.55));
    grd.addColorStop(0.85, rgba(color, 0.12));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return (discCache[color] = s);
  }

  /* ---------- Canvas 圖層 ---------- */
  function Layer(id, dprCap) {
    this.cv = document.getElementById(id);
    this.cx = this.cv.getContext('2d');
    this.cap = dprCap;
  }
  Layer.prototype.resize = function () {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.cap);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.cx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  var bgL, backL, frontL;
  var W = 0, H = 0, unit = 1;

  /* =========================================================
   * 背景：星空 / 金粉飄落 / 光斑 / 流星
   * ========================================================= */
  var stars = [];
  var flakes = [[], [], []];
  var bokeh = [];
  var meteors = [];
  var nextMeteor = 4;
  var boost = 0, boostTarget = 0;
  var bgClock = 0, lastBg = 0;
  // 三層金粉：遠（細小）、中、近（會閃爍的四芒星）
  var FLAKE = [
    { r: [0.5, 1.1], vy: [10, 24], a: 0.38, color: '#fff2c4' },
    { r: [0.9, 1.7], vy: [20, 40], a: 0.6, color: '#ffd36b' },
    { r: [1.8, 3.2], vy: [28, 52], a: 0.95, color: '#ffe9a8' }
  ];

  function flake(layer, anywhere) {
    var c = FLAKE[layer];
    return {
      x: rand(0, W), y: anywhere ? rand(0, H) : rand(-30, -4),
      r: rand(c.r[0], c.r[1]), vy: rand(c.vy[0], c.vy[1]),
      sw: rand(0.5, 1.6), ph: rand(0, TAU), amp: rand(8, 26), sp: rand(1.5, 4.5)
    };
  }

  function seedBg() {
    var area = (W * H) / (1920 * 1080);
    stars = [];
    for (var i = 0; i < Math.round(150 * area); i++) {
      stars.push({ x: rand(0, W), y: rand(0, H * 0.85), r: rand(0.6, 1.7), ph: rand(0, TAU), sp: rand(0.6, 2.4) });
    }
    var counts = [95, 55, 22];
    for (var L = 0; L < 3; L++) {
      flakes[L] = [];
      for (var j = 0; j < Math.round(counts[L] * area); j++) flakes[L].push(flake(L, true));
    }
    bokeh = [];
    for (var k = 0; k < 14; k++) {
      bokeh.push({
        x: rand(0, W), y: rand(0, H), r: rand(40, 120) * unit,
        vx: rand(-6, 6), vy: rand(-12, -3),
        c: pick(['#ffd36b', '#4da3ff', '#ff3b4f', '#ffb347', '#a78bfa']),
        a: rand(0.05, 0.12), ph: rand(0, TAU)
      });
    }
  }

  function bgFrame() {
    var ts = performance.now();
    var dt = Math.max(0, Math.min(0.05, (ts - lastBg) / 1000 || 0.016));
    lastBg = ts;
    bgClock += dt;
    boost += (boostTarget - boost) * Math.min(1, dt * 2.5);
    var c = bgL.cx;
    c.clearRect(0, 0, W, H);

    // 星星閃爍
    c.fillStyle = '#ffffff';
    var tw = 1 + boost * 2.5;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      c.globalAlpha = 0.18 + 0.6 * (0.5 + 0.5 * Math.sin(bgClock * s.sp * tw + s.ph));
      c.fillRect(s.x, s.y, s.r, s.r);
    }

    // 柔焦光斑
    c.globalCompositeOperation = 'lighter';
    for (var b = 0; b < bokeh.length; b++) {
      var o = bokeh[b];
      o.x += o.vx * dt;
      o.y += o.vy * dt * (1 + boost * 4);
      if (o.y < -o.r) { o.y = H + o.r; o.x = rand(0, W); }
      if (o.x < -o.r) o.x = W + o.r; else if (o.x > W + o.r) o.x = -o.r;
      c.globalAlpha = o.a * (0.65 + 0.35 * Math.sin(bgClock * 0.6 + o.ph)) * (1 + boost * 0.8);
      c.drawImage(disc(o.c), o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
    }
    c.globalCompositeOperation = 'source-over';

    // 三層金粉（轉動時加速，像穿越時空）
    var spd = 1 + boost * 2.6;
    for (var L = 0; L < 3; L++) {
      var arr = flakes[L];
      var near = L === 2;
      c.fillStyle = FLAKE[L].color;
      c.globalAlpha = FLAKE[L].a;
      if (!near) c.beginPath();
      for (var f = 0; f < arr.length; f++) {
        var p = arr[f];
        p.y += p.vy * dt * spd;
        p.x += Math.cos(bgClock * p.sw + p.ph) * p.amp * dt;
        if (p.y > H + 6) { arr[f] = flake(L, false); continue; }
        if (!near) {
          c.moveTo(p.x + p.r, p.y);
          c.arc(p.x, p.y, p.r, 0, TAU);
          continue;
        }
        // 近景：一閃一閃的四芒星亮片
        var tw2 = 0.5 + 0.5 * Math.sin(bgClock * p.sp + p.ph);
        c.globalAlpha = FLAKE[L].a * (0.2 + 0.8 * tw2);
        var R = p.r * (1.6 + tw2 * 1.4), q = p.r * 0.45;
        c.beginPath();
        c.moveTo(p.x, p.y - R);
        c.lineTo(p.x + q, p.y - q);
        c.lineTo(p.x + R, p.y);
        c.lineTo(p.x + q, p.y + q);
        c.lineTo(p.x, p.y + R);
        c.lineTo(p.x - q, p.y + q);
        c.lineTo(p.x - R, p.y);
        c.lineTo(p.x - q, p.y - q);
        c.closePath();
        c.fill();
      }
      if (!near) c.fill();
    }

    // 流星
    nextMeteor -= dt;
    if (nextMeteor <= 0) {
      nextMeteor = rand(7, 15);
      var dir = Math.random() < 0.5 ? -1 : 1;
      meteors.push({ x: rand(W * 0.15, W * 0.85), y: rand(-20, H * 0.25), vx: dir * rand(700, 1000) * unit, vy: rand(260, 420) * unit, life: 0.9, max: 0.9 });
    }
    c.lineCap = 'round';
    for (var m = meteors.length - 1; m >= 0; m--) {
      var e = meteors[m];
      e.life -= dt;
      if (e.life <= 0) { meteors.splice(m, 1); continue; }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      var k = e.life / e.max;
      var tx = e.x - e.vx * 0.16, ty = e.y - e.vy * 0.16;
      var gr = c.createLinearGradient(e.x, e.y, tx, ty);
      gr.addColorStop(0, 'rgba(255,255,255,' + (0.9 * k) + ')');
      gr.addColorStop(1, 'rgba(160,200,255,0)');
      c.globalAlpha = 1;
      c.strokeStyle = gr;
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(e.x, e.y);
      c.lineTo(tx, ty);
      c.stroke();
    }
    c.globalAlpha = 1;
    requestAnimationFrame(bgFrame);
  }

  /* =========================================================
   * 前景特效
   * ========================================================= */
  var sparks = [];
  var rockets = [];
  var rings = [];
  var confetti = [];
  var shapes = [];
  var fxRunning = false;
  var lastFx = 0;
  var showUntil = 0, nextLaunch = 0, showMin = 0.3, showMax = 0.6;

  function swapRemove(arr, i) {
    arr[i] = arr[arr.length - 1];
    arr.pop();
  }

  function kick() {
    if (fxRunning) return;
    fxRunning = true;
    lastFx = performance.now();
    requestAnimationFrame(fxFrame);
  }

  function spark(x, y, vx, vy, color, o) {
    var p = {
      x: x, y: y, vx: vx, vy: vy, color: color,
      life: rand(1.1, 1.8), max: 1.8, size: rand(14, 20) * unit,
      drag: 1.25, grav: 150 * unit, alpha: 1, fade: true, shrink: true, tw: false
    };
    if (o) for (var k in o) p[k] = o[k];
    p.max = Math.max(p.max, p.life);
    sparks.push(p);
  }

  /** 發射一枚煙火（可指定位置、樣式、造型文字） */
  function launch(o) {
    o = o || {};
    if (!W) return;
    var x = o.x != null ? o.x : rand(W * 0.1, W * 0.9);
    var ty = o.y != null ? o.y : rand(H * 0.1, H * 0.4);
    var g = 900 * unit;
    var vy = -Math.sqrt(2 * g * (H + 10 - ty));
    rockets.push({
      x: x, y: H + 10, vx: (o.x != null ? 0 : rand(-40, 40)) * unit, vy: vy, g: g, ty: ty,
      pattern: o.pattern, colors: o.colors || pick(PALETTES), shape: o.shape, shapeColor: o.shapeColor,
      size: o.size || rand(0.85, 1.2)
    });
    if (LD.sound) LD.sound.launch();
    kick();
  }

  function sphere(x, y, n, S, colors, o) {
    for (var i = 0; i < n; i++) {
      var z = rand(-1, 1), th = rand(0, TAU), rr = Math.sqrt(1 - z * z);
      var sp = S * rand(0.9, 1.05);
      spark(x, y, rr * Math.cos(th) * sp, rr * Math.sin(th) * sp, colors[i % colors.length], o);
    }
  }

  function explode(x, y, r) {
    var size = r.size || 1;
    var S = 340 * unit * size;
    var cols = r.colors;
    var pattern = r.pattern || pick(['peony', 'peony', 'ring', 'willow', 'heart', 'double', 'glitter', 'palm']);
    var i, n;

    if (r.shape) {
      shapeBurst(x, y, r.shape, r.shapeColor);
      sphere(x, y, 40, S * 0.5, ['#fff2c4', '#ffd36b']);
    } else if (pattern === 'ring') {
      n = 72;
      var tilt = rand(0.35, 1), rot = rand(0, TAU), cr = Math.cos(rot), sr = Math.sin(rot);
      for (i = 0; i < n; i++) {
        var a = (i / n) * TAU, vx = Math.cos(a) * S, vy = Math.sin(a) * S * tilt;
        spark(x, y, vx * cr - vy * sr, vx * sr + vy * cr, cols[i % 2]);
      }
      sphere(x, y, 30, S * 0.35, [cols[2] || '#fff']);
    } else if (pattern === 'willow') {
      sphere(x, y, 100, S * 0.85, ['#ffcf6b', '#ffe6a8', '#ffb347'], { life: rand(2.6, 3.4), drag: 1.5, grav: 120 * unit, size: rand(11, 15) * unit });
      if (LD.sound) LD.sound.crackle(18, 1.8);
    } else if (pattern === 'heart') {
      n = 96;
      for (i = 0; i < n; i++) {
        var t = (i / n) * TAU;
        var hx = 16 * Math.pow(Math.sin(t), 3);
        var hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        spark(x, y, (hx / 17) * S * 1.05, (hy / 17) * S * 1.05, pick(['#ff3b4f', '#ff8aa0', '#ffd1dc']), { grav: 90 * unit });
      }
    } else if (pattern === 'double') {
      sphere(x, y, 90, S, [cols[0]]);
      sphere(x, y, 50, S * 0.5, [cols[1]]);
    } else if (pattern === 'glitter') {
      sphere(x, y, 120, S, ['#fff2c4', '#ffd36b', '#ffffff'], { tw: true, life: rand(1.8, 2.4) });
      if (LD.sound) LD.sound.crackle(30, 1.6);
    } else if (pattern === 'palm') {
      var arms = 9;
      for (var k = 0; k < arms; k++) {
        var aa = (k / arms) * TAU + rand(-0.1, 0.1);
        for (var j = 0; j < 12; j++) {
          var sp = S * (0.45 + j * 0.055);
          spark(x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, cols[k % cols.length], { size: rand(12, 18) * unit, drag: 1.1 });
        }
      }
    } else {
      sphere(x, y, 120, S, cols);
    }

    spark(x, y, 0, 0, '#fff3d6', { life: 0.22, max: 0.22, size: 260 * unit * size, drag: 0, grav: 0, alpha: 0.85, shrink: false });
    rings.push({ x: x, y: y, r: 6, vr: 560 * unit * size, life: 0.5, max: 0.5, color: '#fff0d2', w: 3 });
    if (LD.sound) LD.sound.boom(size);
  }

  /* ---------- 文字 / emoji 造型煙火 ---------- */
  var shapeCache = {};
  function shapeData(key) {
    if (shapeCache[key]) return shapeCache[key];
    var ascii = /^[\x20-\x7e]+$/.test(key);
    var fs = 200;
    var font = ascii
      ? '900 ' + fs + 'px Orbitron, "Arial Black", Impact, sans-serif'
      : fs + 'px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Microsoft JhengHei", sans-serif';
    var cv = document.createElement('canvas');
    var g = cv.getContext('2d');
    g.font = font;
    var w = Math.ceil(g.measureText(key).width) + 40;
    var h = Math.ceil(fs * 1.35);
    cv.width = w;
    cv.height = h;
    g = cv.getContext('2d', { willReadFrequently: true });
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(key, w / 2, h / 2);
    var data = g.getImageData(0, 0, w, h).data;
    var pts = [];
    var gap = 7;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var y = 0; y < h; y += gap) {
      for (var x = 0; x < w; x += gap) {
        var idx = (y * w + x) * 4;
        if (data[idx + 3] > 150) {
          var col = ascii ? null : quantize(data[idx], data[idx + 1], data[idx + 2]);
          if (col === '#fff2c4' && !ascii) col = '#ffe9a8';
          pts.push({ x: x, y: y, c: col });
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    pts.forEach(function (p) { p.x -= cx; p.y -= cy; });
    return (shapeCache[key] = { pts: pts, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), gap: gap, emoji: !ascii });
  }

  function shapeBurst(x, y, key, color) {
    var d = shapeData(key);
    if (!d.pts.length) return;
    var sc = d.emoji ? Math.min((W * 0.3) / d.w, (H * 0.23) / d.h) : Math.min((W * 0.42) / d.w, (H * 0.17) / d.h);
    var step = Math.max(1, Math.ceil(d.pts.length / 700));
    // 粒子大小跟著點距走：太大會互相疊加成一團白光，看不出形狀與顏色
    var dot = d.gap * sc * Math.sqrt(step) * (d.emoji ? 1.55 : 1.9);
    for (var i = 0; i < d.pts.length; i += step) {
      var p = d.pts[i];
      shapes.push({
        sx: x, sy: y, tx: x + p.x * sc, ty: y + p.y * sc, x: x, y: y,
        t: -rand(0, 0.08), fly: rand(0.55, 0.8), hold: rand(1.3, 1.6) + (d.emoji ? 0.4 : 0), fall: rand(1.0, 1.6),
        vx: rand(-20, 20) * unit, vy: 0,
        color: p.c || color || pick(['#ffd36b', '#fff2c4', '#ffb000']),
        size: dot * rand(0.9, 1.1),
        emoji: d.emoji
      });
    }
    if (LD.sound) LD.sound.crackle(26, 1.4);
  }

  /* ---------- 紙花 ---------- */
  function piece(x, y, vx, vy) {
    var r = Math.random();
    return {
      x: x, y: y, vx: vx, vy: vy,
      w: rand(10, 17) * unit, h: rand(6, 10) * unit,
      rot: rand(0, TAU), vr: rand(-10, 10), fl: rand(0, TAU), vf: rand(5, 14),
      color: pick(CONFETTI), life: rand(5.5, 8),
      kind: r < 0.14 ? 'circle' : r < 0.32 ? 'strip' : 'rect',
      sw: rand(1.5, 3.5), ph: rand(0, TAU)
    };
  }
  function cannon(x, y, ang, spread, n, power) {
    for (var i = 0; i < n; i++) {
      var a = ang + rand(-spread, spread), s = power * rand(0.45, 1.05);
      confetti.push(piece(x, y, Math.cos(a) * s, Math.sin(a) * s));
    }
    kick();
  }
  function confettiCannons(scale) {
    var k = scale || 1;
    var power = 1650 * unit * k;
    cannon(-10, H + 10, -Math.PI / 3.2, 0.3, Math.round(150 * k), power);
    cannon(W + 10, H + 10, -Math.PI + Math.PI / 3.2, 0.3, Math.round(150 * k), power);
  }
  function confettiRain(n) {
    for (var i = 0; i < n; i++) confetti.push(piece(rand(0, W), rand(-H * 0.4, -10), rand(-60, 60) * unit, rand(60, 200) * unit));
    kick();
  }

  /** 滾筒停下時的金色火花 + 衝擊波 */
  function burstAt(x, y, o) {
    o = o || {};
    var n = o.count || 40, S = (o.power || 1) * 460 * unit;
    for (var i = 0; i < n; i++) {
      var a = rand(0, TAU), s = S * rand(0.35, 1);
      spark(x, y, Math.cos(a) * s, Math.sin(a) * s, pick(['#ffd36b', '#fff2c4', '#ffb000', '#ffffff']), {
        life: rand(0.5, 1.0), max: 1, size: rand(12, 18) * unit, drag: 2.8, grav: 260 * unit
      });
    }
    rings.push({ x: x, y: y, r: 10, vr: 950 * unit * (o.power || 1), life: 0.55, max: 0.55, color: '#ffe9a8', w: 4 });
    kick();
  }

  /* ---------- 主迴圈 ---------- */
  function fxFrame() {
    var ts = performance.now();
    var dt = Math.max(0, Math.min(0.05, (ts - lastFx) / 1000));
    lastFx = ts;
    var now = ts / 1000;

    if (now < showUntil && now >= nextLaunch) {
      launch();
      if (Math.random() < 0.3) launch();
      nextLaunch = now + rand(showMin, showMax);
    }

    var b = backL.cx;
    b.globalCompositeOperation = 'destination-out';
    b.fillStyle = 'rgba(0,0,0,0.3)';
    b.fillRect(0, 0, W, H);
    b.globalCompositeOperation = 'lighter';

    var i, p;
    // 火箭
    for (i = rockets.length - 1; i >= 0; i--) {
      var r = rockets[i];
      r.vy += r.g * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      spark(r.x + rand(-1.5, 1.5), r.y + rand(0, 4), rand(-20, 20) * unit, rand(30, 90) * unit, '#ffd9a0', {
        life: rand(0.25, 0.5), max: 0.5, size: rand(9, 15) * unit, drag: 2, grav: 60 * unit, alpha: 0.75
      });
      b.globalAlpha = 1;
      var rs = 22 * unit;
      b.drawImage(glow('#fff2c4'), r.x - rs / 2, r.y - rs / 2, rs, rs);
      if (r.vy >= -40 * unit || r.y <= r.ty) {
        explode(r.x, r.y, r);
        swapRemove(rockets, i);
      }
    }
    // 火花
    for (i = sparks.length - 1; i >= 0; i--) {
      p = sparks[i];
      p.life -= dt;
      if (p.life <= 0) { swapRemove(sparks, i); continue; }
      var dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy = p.vy * dr + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      var k = p.life / p.max;
      var a = (p.fade ? k : 1) * p.alpha;
      if (p.tw && Math.random() < 0.35) a *= 0.15;
      b.globalAlpha = Math.min(1, a);
      var sz = p.size * (p.shrink ? 0.45 + 0.55 * k : 1);
      b.drawImage(glow(p.color), p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    // 造型煙火
    for (i = shapes.length - 1; i >= 0; i--) {
      p = shapes[i];
      p.t += dt;
      if (p.t < 0) continue;
      var al = 1;
      if (p.t < p.fly) {
        var u = p.t / p.fly, e = 1 - Math.pow(1 - u, 3);
        p.x = p.sx + (p.tx - p.sx) * e;
        p.y = p.sy + (p.ty - p.sy) * e;
      } else if (p.t < p.fly + p.hold) {
        p.x = p.tx;
        p.y = p.ty;
        if (Math.random() < 0.08) al = 0.35;
      } else {
        var ft = p.t - p.fly - p.hold;
        if (ft > p.fall) { swapRemove(shapes, i); continue; }
        p.vy += 160 * unit * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        al = 1 - ft / p.fall;
      }
      b.globalAlpha = p.emoji ? al * 0.9 : al;
      b.drawImage(glow(p.color), p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    // 衝擊波
    b.globalCompositeOperation = 'source-over';
    for (i = rings.length - 1; i >= 0; i--) {
      var g = rings[i];
      g.life -= dt;
      if (g.life <= 0) { swapRemove(rings, i); continue; }
      g.r += g.vr * dt;
      g.vr *= Math.exp(-3 * dt);
      var kk = g.life / g.max;
      b.globalAlpha = kk * 0.8;
      b.strokeStyle = g.color;
      b.lineWidth = g.w * kk * 2 + 0.5;
      b.beginPath();
      b.arc(g.x, g.y, g.r, 0, TAU);
      b.stroke();
    }
    b.globalAlpha = 1;

    // 紙花（前景，不留殘影）
    var f = frontL.cx, dpr = frontL.dpr;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, frontL.cv.width, frontL.cv.height);
    var grav = 680 * unit;
    for (i = confetti.length - 1; i >= 0; i--) {
      p = confetti[i];
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 40) { swapRemove(confetti, i); continue; }
      var cd = Math.exp(-2.1 * dt);
      p.vx *= cd;
      p.vy = p.vy * cd + grav * dt;
      p.x += (p.vx + Math.sin(now * p.sw + p.ph) * 40 * unit) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.fl += p.vf * dt;
      var sy = Math.cos(p.fl), cr = Math.cos(p.rot), sr = Math.sin(p.rot);
      f.setTransform(cr * dpr, sr * dpr, -sr * sy * dpr, cr * sy * dpr, p.x * dpr, p.y * dpr);
      f.globalAlpha = Math.min(1, p.life / 1.2);
      f.fillStyle = sy < 0 ? darker(p.color) : p.color;
      if (p.kind === 'circle') {
        f.beginPath();
        f.arc(0, 0, p.h * 0.6, 0, TAU);
        f.fill();
      } else if (p.kind === 'strip') {
        f.fillRect(-p.w, -p.h * 0.22, p.w * 2, p.h * 0.44);
      } else {
        f.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
    }
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    f.globalAlpha = 1;

    if (sparks.length || rockets.length || rings.length || confetti.length || shapes.length || now < showUntil) {
      requestAnimationFrame(fxFrame);
    } else {
      fxRunning = false;
      b.clearRect(0, 0, W, H);
    }
  }

  /* ---------- 對外 API ---------- */
  function resize() {
    [bgL, backL, frontL].forEach(function (l) { l.resize(); });
    W = bgL.W;
    H = bgL.H;
    unit = Math.min(W, H) / 1000;
    seedBg();
  }

  function init() {
    bgL = new Layer('bg-canvas', 1.25);
    backL = new Layer('fx-back', 1.5);
    frontL = new Layer('fx-front', 1.5);
    resize();
    var t = 0;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(resize, 120);
    });
    requestAnimationFrame(bgFrame);
  }

  /** 連續煙火秀 */
  function show(seconds, o) {
    o = o || {};
    var now = performance.now() / 1000;
    showUntil = Math.max(showUntil, now + seconds);
    nextLaunch = now;
    showMin = o.min || 0.3;
    showMax = o.max || 0.6;
    kick();
  }

  /** 造型煙火：飛上天空後拼出文字或 emoji */
  function shapeFirework(key, o) {
    o = o || {};
    launch({ x: o.x != null ? o.x : W / 2, y: o.y != null ? o.y : H * 0.16, shape: key, shapeColor: o.color, size: 1.2 });
  }

  /** 全部抽完的大結局 */
  function finale() {
    show(9, { min: 0.16, max: 0.36 });
    confettiCannons(1.2);
    confettiRain(140);
    setTimeout(function () { shapeFirework('EMRD', { y: H * 0.24 }); }, 500);
    setTimeout(function () { shapeFirework('🏆', { y: H * 0.26 }); }, 3300);
    setTimeout(function () { confettiCannons(1); }, 4200);
    setTimeout(function () { shapeFirework('2026', { y: H * 0.24, color: '#ffd36b' }); }, 6100);
  }

  LD.fx = {
    init: init,
    launch: launch,
    show: show,
    shapeFirework: shapeFirework,
    burstAt: burstAt,
    confettiCannons: confettiCannons,
    confettiRain: confettiRain,
    finale: finale,
    setBoost: function (v) { boostTarget = v; },
    size: function () { return { W: W, H: H }; }
  };
})(window.LD = window.LD || {});
