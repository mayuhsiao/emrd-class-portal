/* =========================================================
 * EMRD 同學任職企業：Logo 牆動畫（離線算圖，不會載入網站）
 *
 * 分鏡：
 *   0.0–4.0 秒  61 張企業卡片散布在深藍空間，彼此以金色訊號相連
 *   4.0–8.2 秒  卡片翻轉、匯聚（背面是晶片走線）
 *   8.2–14 秒   拼成弧形 Logo 牆，標題牌點亮、光線掃過
 *
 * 每一格都疊加多個取樣（時間、鏡頭光圈、像素），所以景深、動態模糊、
 * 地面模糊倒影與反鋸齒都是真的累積出來的。由 render.mjs 驅動。
 * ========================================================= */
(async function () {
  'use strict';

  const Q = new URLSearchParams(location.search);
  const num = (k, d) => (Q.has(k) ? Number(Q.get(k)) : d);
  const W = num('w', 1920), H = num('h', 1080);
  const FPS = num('fps', 30), DUR = num('dur', 14), SAMPLES = num('samples', 64);
  const STILLS = Q.get('stills') ? Q.get('stills').split(',').map(Number) : null;
  const PORTRAIT = H > W;
  const post = (path, body) => fetch(path, { method: 'POST', body });
  const log = (m) => post('/log', String(m)).catch(() => {});
  window.addEventListener('error', (e) => log('ERROR ' + e.message + ' @' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => log('REJECT ' + (e.reason && e.reason.stack || e.reason)));

  /* ---------- 數學 ---------- */
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeInOut = (t) => (t < 0.5 ? Math.pow(2 * t, 3.4) / 2 : 1 - Math.pow(2 - 2 * t, 3.4) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const qAxis = (ax, ang) => { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; };
  const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  function qSlerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map((x) => -x); d = -d; }
    if (d > 0.9995) { const r = a.map((x, i) => mix(x, b[i], t)); const l = Math.hypot(...r); return r.map((x) => x / l); }
    const th = Math.acos(d), s = Math.sin(th);
    return a.map((x, i) => (x * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
  }
  /** 四元數 + 位置 + 縮放 → 3×4 矩陣（三個 vec4 列） */
  function rows(q, p, s, out, o) {
    const [x, y, z, w] = q;
    out[o] = (1 - 2 * (y * y + z * z)) * s; out[o + 1] = 2 * (x * y - z * w) * s; out[o + 2] = 2 * (x * z + y * w) * s; out[o + 3] = p[0];
    out[o + 4] = 2 * (x * y + z * w) * s; out[o + 5] = (1 - 2 * (x * x + z * z)) * s; out[o + 6] = 2 * (y * z - x * w) * s; out[o + 7] = p[1];
    out[o + 8] = 2 * (x * z - y * w) * s; out[o + 9] = 2 * (y * z + x * w) * s; out[o + 10] = (1 - 2 * (x * x + y * y)) * s; out[o + 11] = p[2];
  }
  function m4mul(a, b) { // column-major
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) r[c * 4 + i] = a[i] * b[c * 4] + a[4 + i] * b[c * 4 + 1] + a[8 + i] * b[c * 4 + 2] + a[12 + i] * b[c * 4 + 3];
    return r;
  }

  /* ---------- 版面：卡片與牆 ---------- */
  const CW = 1.5, CH = 1.0, GAP = 0.1, PX = CW + GAP, PY = CH + GAP;
  const COLS = PORTRAIT ? 6 : 11, ROWS = PORTRAIT ? 11 : 6, R = PORTRAIT ? 12 : 15;
  const TITLE = PORTRAIT ? { row: 3, c0: 1, c1: 4 } : { row: 2, c0: 3, c1: 7 }; // 標題牌佔用的格子
  const DTH = PX / R;
  const FLOOR = -(ROWS * PY) / 2 - 0.26;
  const logos = window.PORTAL.logos;
  const N = logos.length;

  function slotPose(col, row) {
    const th = (col - (COLS - 1) / 2) * DTH;
    const y = ((ROWS - 1) / 2 - row) * PY;
    return { p: [R * Math.sin(th), y, -R * Math.cos(th)], q: qAxis([0, 1, 0], -th), th, y };
  }
  const slots = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (r === TITLE.row && c >= TITLE.c0 && c <= TITLE.c1) continue;
      slots.push(Object.assign({ c, r }, slotPose(c, r)));
    }
  }
  const titleCol = (TITLE.c0 + TITLE.c1) / 2;
  const titleSlot = slotPose(titleCol, TITLE.row);
  const TITLE_W = (TITLE.c1 - TITLE.c0 + 1) * PX - GAP;

  /* ---------- 散布位置：從開場鏡頭看出去平均分布、互不遮擋 ---------- */
  const FOV = PORTRAIT ? 46 : 34;
  const TANY = Math.tan((FOV * Math.PI) / 360), TANX = TANY * (W / H);
  const EYE0 = PORTRAIT ? [0, -4.2, 10.3] : [0, -1.75, 10.3];
  const rand = rng(PORTRAIT ? 41 : 20261124);
  const lowRes = new Set();
  logos.forEach((l, i) => { if (l.text) lowRes.add(i); });

  const images = await Promise.all(logos.map((l) => l.text ? null : new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('logo ' + l.src));
    im.src = '/' + l.src;
  })));
  images.forEach((im, i) => { if (im && im.naturalWidth < 520) lowRes.add(i); });

  // 解析度高的 Logo 放近處，其餘放遠處
  const hi = [], lo = [];
  logos.forEach((_, i) => (lowRes.has(i) ? lo : hi).push(i));
  for (const list of [hi, lo]) for (let i = list.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; }
  const order = hi.concat(lo);
  const depthOf = (k) => {
    if (k < 3) return mix(5.0, 5.8, k / 2);
    if (k < 13) return mix(6.8, 9.6, (k - 3) / 9);
    if (k < 33) return mix(10, 16.5, (k - 13) / 19);
    return mix(17, 30, (k - 33) / (N - 34));
  };
  const cards = new Array(N);
  const placed = [];
  const XR = PORTRAIT ? 1.5 : 1.12;
  order.forEach((idx, k) => {
    const d = depthOf(k) * (0.98 + 0.04 * rand());
    const rad = Math.hypot(CW, CH) / 2 / (d * TANY);
    let best = null, bestScore = -1e9;
    for (let a = 0; a < 500; a++) {
      const x = (rand() * 2 - 1) * XR, y = mix(PORTRAIT ? -0.12 : -0.30, 0.98, rand());
      if (k < 3) { // 最近的幾張放在畫面邊緣，被邊框切到一部分
        const e = Math.max(Math.abs(x), Math.abs(y * 1.02));
        if (e < 0.6 || e > (PORTRAIT ? 1.12 : 0.98) || Math.abs(x) < 0.3 || y < 0.05) continue;
      }
      const px = x * TANX * d, py = EYE0[1] + y * TANY * d;
      if (py < FLOOR + 0.85) continue;
      let s = 9;
      for (const q of placed) s = Math.min(s, Math.hypot((x - q.x) * (W / H), y - q.y) / (rad + q.rad));
      s -= 0.06 * Math.hypot(x, y * 0.8);
      if (s > bestScore) { bestScore = s; best = { x, y, rad, p: [px, py, EYE0[2] - d] }; }
    }
    placed.push(best);
    cards[idx] = { p0: best.p, d };
  });
  cards.forEach((c, i) => {
    const r2 = rng(900 + i * 17);
    c.slot = slots[i];
    c.yaw = (r2() - 0.5) * 0.62 - c.p0[0] * 0.03;
    c.pitch = (r2() - 0.5) * 0.30 + c.p0[1] * 0.03;
    c.roll = (r2() - 0.5) * 0.16;
    c.ph = r2() * 6.283;
    c.sp = 0.5 + r2() * 0.5;
    const far = Math.hypot((c.slot.th - titleSlot.th) * R / (COLS * PX / 2), (c.slot.y - titleSlot.y) / (ROWS * PY / 2));
    c.rank = clamp(far / 1.35);
    const deep = clamp((c.d - 5) / 25); // 近的先出發，鏡頭前很快就清空
    c.start = 3.3 + 0.95 * deep + 0.80 * c.rank + 0.22 * r2();
    c.dur = 2.6 + 0.45 * (1 - deep) + 0.15 * r2();
    c.arrive = c.start + c.dur;
    c.dir = r2() < 0.5 ? -1 : 1;
    c.swirl = 0.55 + 0.35 * r2();
    c.layer = i;
    c.chip = (r2() * 6) | 0;
  });

  function cardPose(c, t) {
    const a = t * c.sp + c.ph;
    const p0 = [c.p0[0] + 0.10 * Math.sin(a * 0.9), c.p0[1] + 0.08 * Math.sin(a * 1.1 + 1), c.p0[2] + 0.12 * Math.sin(a * 0.7 + 2)];
    const q0 = qMul(qAxis([0, 1, 0], c.yaw + 0.10 * Math.sin(a * 0.8)), qMul(qAxis([1, 0, 0], c.pitch + 0.06 * Math.sin(a + 0.5)), qAxis([0, 0, 1], c.roll)));
    const u = clamp((t - c.start) / c.dur);
    if (u <= 0) return { p: p0, q: q0, e: 0, flash: 0 };
    const e = easeInOut(u);
    let p = [mix(p0[0], c.slot.p[0], e), mix(p0[1], c.slot.p[1], e), mix(p0[2], c.slot.p[2], e)];
    const ang = c.swirl * Math.sin(Math.PI * e) * (1 - 0.35 * e); // 繞著畫面中心旋進去
    const cs = Math.cos(ang), sn = Math.sin(ang);
    p = [p[0] * cs - p[1] * sn, p[0] * sn + p[1] * cs, p[2]];
    p[1] = Math.max(p[1], FLOOR + 0.62);
    let q = qSlerp(q0, c.slot.q, e);
    q = qMul(q, qAxis([0, 1, 0], c.dir * 2 * Math.PI * e)); // 翻一整圈，途中看得到晶片背面
    const since = t - c.arrive;
    const flash = since > 0 ? Math.exp(-since * 2.6) : smooth(0.86, 1, u);
    if (since > 0) { // 就位後的一點回彈，以及之後由標題往外擴散的微波
      const k = 0.06 * Math.exp(-since * 5) * Math.sin(since * 18);
      const wave = 0.09 * Math.exp(-Math.pow((t - 8.35 - c.rank * 1.1) / 0.28, 2));
      const n = [-Math.sin(c.slot.th), 0, Math.cos(c.slot.th)];
      p = add(p, mul(n, k + wave));
    }
    return { p, q, e, flash };
  }

  /** 飛行途中互相避讓，卡片才不會穿插在一起（越接近定位越不會被推開） */
  function separate(poses) {
    const D0 = 1.85, n = poses.length;
    const mob = poses.map((p) => 0.2 * (1 - p.e) + Math.sin(Math.PI * p.e));
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const mi = mob[i], mj = mob[j];
          if (mi + mj < 0.02) continue;
          const a = poses[i].p, b = poses[j].p;
          const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
          const d = Math.hypot(dx, dy, dz);
          if (d >= D0 || d < 1e-4) continue;
          const s = 1 - d / D0, k = s * s * (3 - 2 * s) * 0.8 * D0 / d / (mi + mj + 0.15);
          a[0] -= dx * k * mi; a[1] -= dy * k * mi; a[2] -= dz * k * mi;
          b[0] += dx * k * mj; b[1] += dy * k * mj; b[2] += dz * k * mj;
        }
      }
    }
    poses.forEach((p) => { p.p[1] = Math.max(p.p[1], FLOOR + 0.6); });
  }

  /* ---------- 鏡頭 ---------- */
  const CAM = PORTRAIT ? [
    { t: 0.0, p: [-0.35, -4.10, 11.4], l: [0.15, -4.20, -6] },
    { t: 4.0, p: [0.30, -4.20, 9.9], l: [0.0, -4.25, -8] },
    { t: 6.4, p: [0.30, -4.20, 13.0], l: [0.0, -4.00, -12] },
    { t: 9.2, p: [0.0, -4.20, 17.0], l: [0.0, -4.20, -12] },
    { t: 14.0, p: [0.0, -4.20, 16.2], l: [0.0, -4.20, -12] }
  ] : [
    { t: 0.0, p: [-0.85, -1.60, 11.3], l: [0.45, -1.80, -6] },
    { t: 4.0, p: [0.60, -1.75, 9.7], l: [0.05, -1.85, -8] },
    { t: 6.4, p: [0.95, -1.55, 8.9], l: [0.0, -1.50, -12] },
    { t: 9.2, p: [0.0, -1.18, 5.9], l: [0.0, -1.18, -15] },
    { t: 14.0, p: [0.0, -1.18, 4.9], l: [0.0, -1.18, -15] }
  ];
  function hermite(keys, t, f) { // 單調、速度連續的 Catmull-Rom（不等間距）
    const n = keys.length;
    let i = 0;
    while (i < n - 2 && t > keys[i + 1].t) i++;
    const k0 = keys[Math.max(i - 1, 0)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(i + 2, n - 1)];
    const h = k2.t - k1.t, u = clamp((t - k1.t) / h);
    const out = [];
    for (let c = 0; c < 3; c++) {
      const m1 = i === 0 ? (f(k2)[c] - f(k1)[c]) / h * 0.9 : (f(k2)[c] - f(k0)[c]) / (k2.t - k0.t);
      const m2 = i === n - 2 ? (f(k2)[c] - f(k1)[c]) / h : (f(k3)[c] - f(k1)[c]) / (k3.t - k1.t);
      const u2 = u * u, u3 = u2 * u;
      out.push((2 * u3 - 3 * u2 + 1) * f(k1)[c] + (u3 - 2 * u2 + u) * h * m1 + (-2 * u3 + 3 * u2) * f(k2)[c] + (u3 - u2) * h * m2);
    }
    return out;
  }
  function camera(t) {
    const p = hermite(CAM, t, (k) => k.p), l = hermite(CAM, t, (k) => k.l);
    const fwd = norm(sub(l, p));
    const roll = (PORTRAIT ? 0.012 : 0.022) * Math.sin(t * 0.55 + 0.6) * (1 - smooth(5.5, 8.6, t));
    let right = norm(cross(fwd, [Math.sin(roll), Math.cos(roll), 0]));
    const up = cross(right, fwd);
    // 對焦：開場在中景卡片，收尾在牆面
    const wall = Math.abs(-R * Math.cos(0.25) - p[2]);
    const focus = mix(8.0, wall, smooth(4.4, 7.6, t));
    const aperture = mix(0.11, 0.02, smooth(4.2, 8.2, t));
    return { p, fwd, right, up, focus, aperture };
  }

  /* ---------- WebGL ---------- */
  const canvas = document.getElementById('c');
  canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  if (!gl) { await log('ERROR no webgl2'); return; }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  await log('GPU ' + (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?'));
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_float_blend');
  gl.getExtension('OES_texture_float_linear');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');

  function program(vs, fs, name) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, '#version 300 es\nprecision highp float;\nprecision highp sampler2DArray;\n' + src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { log('SHADER ' + name + ' ' + gl.getShaderInfoLog(s)); throw new Error(name); }
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { log('LINK ' + name + ' ' + gl.getProgramInfoLog(p)); throw new Error(name); }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  /* ---------- 貼圖 ---------- */
  const TW = 768, TH = 512;
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /** 小圖先放大再收邊，近看不會糊成一團 */
  async function upscale(im, w, h) {
    const bmp = await createImageBitmap(im, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const c = canvasOf(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const k = w / im.naturalWidth;
    if (k < 1.6) return c;
    const d = g.getImageData(0, 0, w, h), a = d.data;
    const src = new Uint8ClampedArray(a);
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = 0;
    const rad = Math.max(1, Math.round(k * 0.55)), amt = 1.1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad), y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
        for (let ch = 0; ch < 4; ch++) {
          const m = (src[(y * w + x0) * 4 + ch] + src[(y * w + x1) * 4 + ch] + src[(y0 * w + x) * 4 + ch] + src[(y1 * w + x) * 4 + ch]) / 4;
          a[o + ch] = src[o + ch] + amt * (src[o + ch] - m);
        }
        const al = src[o + 3] / 255; // 透明底的小圖：邊緣收緊
        if (al > 0 && al < 1) a[o + 3] = 255 * smooth(0.28, 0.72, al);
      }
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  await document.fonts.load('900 80px "Noto Serif TC"', 'EMRD同學任職企業家');
  await document.fonts.load('700 60px "Noto Sans TC"', '耀鑫有限公司湯瑪士車業同學任職企業家級');
  await document.fonts.load('500 80px "JetBrains Mono"', '0123456789–');

  const logoTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, logoTex);
  const levels = Math.floor(Math.log2(TW)) + 1;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.SRGB8_ALPHA8, TW, TH, N + 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (let i = 0; i <= N; i++) {
    const c = canvasOf(TW, TH), g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, TW, TH);
    const l = logos[i];
    if (!l) { // 備用格：EMRD 徽章
      const b = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = '/assets/emrd-logo.png'; });
      g.drawImage(b, TW / 2 - 190, TH / 2 - 190, 380, 380);
    } else if (l.text) {
      g.fillStyle = '#0f2350';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let fs = 92;
      do { g.font = `700 ${fs}px "Noto Sans TC"`; fs -= 4; } while (g.measureText(l.name).width > TW * 0.8);
      g.fillText(l.name, TW / 2, TH / 2 + 4);
    } else {
      const im = images[i];
      let w = (l.w / 100) * TW, h = (w * im.naturalHeight) / im.naturalWidth;
      const k = Math.min(1, (TW * 0.86) / w, (TH * 0.72) / h);
      w = Math.round(w * k); h = Math.round(h * k);
      const up = await upscale(im, w, h);
      g.drawImage(up, Math.round((TW - w) / 2), Math.round((TH - h) / 2));
    }
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TW, TH, 1, gl.RGBA, gl.UNSIGNED_BYTE, c);
  }
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 16);

  /** 晶片背面：深藍底、金色走線、四邊金手指 */
  function chip(seed) {
    const c = canvasOf(TW, TH), g = c.getContext('2d'), r = rng(seed);
    const bg = g.createLinearGradient(0, 0, TW, TH);
    bg.addColorStop(0, '#12305f'); bg.addColorStop(1, '#081a3c');
    g.fillStyle = bg; g.fillRect(0, 0, TW, TH);
    g.strokeStyle = 'rgba(110,160,255,.16)'; g.lineWidth = 1.5;
    for (let x = 0; x <= TW; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, TH); g.stroke(); }
    for (let y = 0; y <= TH; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(TW, y); g.stroke(); }
    const cx = TW / 2, cy = TH / 2, s = 86 + r() * 26;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const gold = (a) => `rgba(255,${205 + ((r() * 20) | 0)},120,${a})`;
    const pins = [];
    for (let k = -4; k <= 4; k++) {
      pins.push([cx + k * (s / 5), cy - s, 0, -1], [cx + k * (s / 5), cy + s, 0, 1], [cx - s, cy + k * (s / 5), -1, 0], [cx + s, cy + k * (s / 5), 1, 0]);
    }
    pins.forEach(([x, y, dx, dy]) => {
      g.strokeStyle = gold(0.95); g.lineWidth = 5;
      g.beginPath(); g.moveTo(x, y);
      let px = x + dx * (18 + r() * 26), py = y + dy * (18 + r() * 26);
      g.lineTo(px, py);
      const turn = (r() < 0.5 ? -1 : 1) * (14 + r() * 60);
      if (dx) { px += dx * Math.abs(turn); py += turn; } else { px += turn; py += dy * Math.abs(turn); }
      g.lineTo(px, py);
      px += dx * (30 + r() * 220); py += dy * (20 + r() * 110);
      px = clamp(px, 26, TW - 26); py = clamp(py, 26, TH - 26);
      g.lineTo(px, py); g.stroke();
      g.fillStyle = gold(1); g.beginPath(); g.arc(px, py, 7.5, 0, 7); g.fill();
      g.fillStyle = '#0a1c40'; g.beginPath(); g.arc(px, py, 3, 0, 7); g.fill();
    });
    for (let k = 0; k < 34; k++) {
      g.fillStyle = gold(0.9);
      const w = 12, h = 20, x = 24 + k * ((TW - 60) / 33);
      g.fillRect(x, 6, w, h); g.fillRect(x, TH - 6 - h, w, h);
    }
    g.fillStyle = '#0b2350'; g.strokeStyle = gold(1); g.lineWidth = 5;
    g.fillRect(cx - s, cy - s, 2 * s, 2 * s); g.strokeRect(cx - s, cy - s, 2 * s, 2 * s);
    g.lineWidth = 2; g.strokeStyle = gold(0.6);
    g.strokeRect(cx - s * 0.72, cy - s * 0.72, s * 1.44, s * 1.44);
    g.fillStyle = gold(0.95); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '500 44px "JetBrains Mono"'; g.fillText('EMRD', cx, cy);
    return c;
  }
  const chipTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, chipTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.SRGB8_ALPHA8, TW, TH, 6);
  for (let i = 0; i < 6; i++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TW, TH, 1, gl.RGBA, gl.UNSIGNED_BYTE, chip(77 + i * 31));
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 16);

  /** 標題牌 */
  async function titleCanvas() {
    const h = 384, w = Math.round(h * TITLE_W / CH);
    const c = canvasOf(w, h), g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0f2c63'); bg.addColorStop(0.5, '#0a1f49'); bg.addColorStop(1, '#071531');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(127,176,255,.15)'; g.lineWidth = 2;
    for (let x = 0; x <= w; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = 'rgba(255,214,130,.85)'; g.lineWidth = 5; g.strokeRect(16, 16, w - 32, h - 32);
    const badge = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = '/assets/emrd-logo.png'; });
    const B = 262, bx = 62;
    g.save(); g.fillStyle = '#fff'; g.beginPath(); g.arc(bx + B / 2, h / 2, B / 2 + 5, 0, 7); g.fill();
    g.drawImage(badge, bx, h / 2 - B / 2, B, B); g.restore();
    const left = bx + B + 56, right = w - 70;
    const gold = g.createLinearGradient(0, h * 0.2, 0, h * 0.85);
    gold.addColorStop(0, '#fff3cf'); gold.addColorStop(0.5, '#f1cf85'); gold.addColorStop(1, '#d2a24e');
    g.textBaseline = 'alphabetic';
    const NUM = PORTRAIT ? 206 : 250, UNIT = PORTRAIT ? 78 : 92;
    g.fillStyle = gold; g.textAlign = 'right';
    g.font = `700 ${UNIT}px "Noto Sans TC"`;
    const uw = g.measureText('家企業').width;
    g.fillText('家企業', right, h * 0.70);
    g.font = `500 ${NUM}px "JetBrains Mono"`;
    g.fillText('61', right - uw - 24, h * 0.5 + NUM * 0.345);
    const limit = right - uw - 24 - g.measureText('61').width - (PORTRAIT ? 56 : 70);
    g.fillStyle = '#fff'; g.textAlign = 'left';
    let fs = 220;
    do { fs -= 2; g.font = `900 ${fs}px "Noto Serif TC"`; } while (g.measureText('EMRD 同學任職企業').width > limit - left);
    g.fillText('EMRD 同學任職企業', left, h * 0.5 + fs * 0.36);
    g.strokeStyle = 'rgba(255,214,130,.5)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(limit + 30, h * 0.24); g.lineTo(limit + 30, h * 0.76); g.stroke();
    return c;
  }
  const titleTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, titleTex);
  const tc = await titleCanvas();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, tc);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 16);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  /* ---------- 卡片幾何：圓角、有厚度、45° 倒角 ---------- */
  function cardMesh(w, h, bend) {
    const rad = 0.075, bev = 0.014, th = 0.062, SEG = 6;
    const xs = []; // 由左到右的切分點：兩端圓角較密，中間視需要彎曲
    for (let i = 0; i <= SEG; i++) xs.push(-w / 2 + rad * (1 - Math.cos(((i / SEG) * Math.PI) / 2)));
    const mid = bend ? 48 : 1;
    for (let i = 1; i < mid; i++) xs.push(mix(-w / 2 + rad, w / 2 - rad, i / mid));
    for (let i = SEG; i >= 0; i--) xs.push(w / 2 - rad * (1 - Math.cos(((i / SEG) * Math.PI) / 2)));
    const over = (x) => Math.max(Math.abs(x) - (w / 2 - rad), 0);
    const half = (x) => h / 2 - rad + Math.sqrt(Math.max(rad * rad - over(x) * over(x), 0));
    const edgeN = (x) => { const c = clamp(over(x) / rad); return [Math.sign(x) * c, Math.sqrt(1 - c * c)]; };
    const top = xs.map((x) => { const n = edgeN(x); return [x, half(x), n[0], n[1]]; });
    const outer = top.concat(top.slice().reverse().map((p) => [p[0], -p[1], p[2], -p[3]]));
    const inner = outer.map((p) => [p[0] - p[2] * bev, p[1] - p[3] * bev, p[2], p[3]]);
    const v = [], n = outer.length, m = top.length;
    const push = (x, y, z, nx, ny, nz, mat) => {
      let X = x, Z = z, NX = nx, NZ = nz;
      if (bend) { // 沿著牆面的弧度彎曲
        const a = x / bend, c = Math.cos(a), sn = Math.sin(a);
        X = (bend - z) * sn; Z = bend - (bend - z) * c;
        NX = nx * c - nz * sn; NZ = nx * sn + nz * c;
      }
      v.push(X, y, Z, NX, ny, NZ, x / w + 0.5, y / h + 0.5, mat, x, y);
    };
    const tri = (a, b, c) => { push(...a); push(...b); push(...c); };
    const quad = (p, q, r, t) => { tri(p, q, r); tri(p, r, t); };
    const zf = th / 2, zb = -th / 2, zi = zf - bev, zj = zb + bev, s = Math.SQRT1_2;
    for (let i = 0; i < m - 1; i++) {
      const a = inner[i], b = inner[i + 1], c = inner[n - 2 - i], d = inner[n - 1 - i];
      quad([a[0], a[1], zf, 0, 0, 1, 0], [d[0], d[1], zf, 0, 0, 1, 0], [c[0], c[1], zf, 0, 0, 1, 0], [b[0], b[1], zf, 0, 0, 1, 0]);
      quad([a[0], a[1], zb, 0, 0, -1, 1], [b[0], b[1], zb, 0, 0, -1, 1], [c[0], c[1], zb, 0, 0, -1, 1], [d[0], d[1], zb, 0, 0, -1, 1]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, A = inner[i], B = inner[j], a = outer[i], b = outer[j];
      quad([A[0], A[1], zf, A[2] * s, A[3] * s, s, 2], [a[0], a[1], zi, a[2] * s, a[3] * s, s, 2], [b[0], b[1], zi, b[2] * s, b[3] * s, s, 2], [B[0], B[1], zf, B[2] * s, B[3] * s, s, 2]);
      quad([a[0], a[1], zi, a[2], a[3], 0, 2], [a[0], a[1], zj, a[2], a[3], 0, 2], [b[0], b[1], zj, b[2], b[3], 0, 2], [b[0], b[1], zi, b[2], b[3], 0, 2]);
      quad([a[0], a[1], zj, a[2] * s, a[3] * s, -s, 2], [A[0], A[1], zb, A[2] * s, A[3] * s, -s, 2], [B[0], B[1], zb, B[2] * s, B[3] * s, -s, 2], [b[0], b[1], zj, b[2] * s, b[3] * s, -s, 2]);
    }
    return new Float32Array(v);
  }
  const INST = 16; // 3×4 矩陣 + (layer, flash, chip, e)
  function cardVao(mesh, cap) {
    const vao = gl.createVertexArray(), vb = gl.createBuffer(), ib = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 1, 32], [8, 2, 36]].forEach(([l, s, o]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, s, gl.FLOAT, false, 44, o); });
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, cap * INST * 4, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 4; k++) { gl.enableVertexAttribArray(4 + k); gl.vertexAttribPointer(4 + k, 4, gl.FLOAT, false, INST * 4, k * 16); gl.vertexAttribDivisor(4 + k, 1); }
    gl.bindVertexArray(null);
    return { vao, ib, count: mesh.length / 11, data: new Float32Array(cap * INST) };
  }
  const extra = slots.length - N; // 直式版多一格放 EMRD 徽章
  const cardGeo = cardVao(cardMesh(CW, CH), N + Math.max(extra, 0));
  const titleGeo = cardVao(cardMesh(TITLE_W, CH, R), 1);

  const COMMON = `
    uniform vec3 uEye; uniform float uTime, uFog, uMirror, uFloor;
    const vec3 FOG = vec3(.0035, .0085, .026);
    vec3 env(vec3 r) {
      vec3 c = mix(vec3(.004,.009,.024), vec3(.035,.075,.18), smoothstep(-.2, 1., r.y));
      float box = smoothstep(.46,.56,r.y) * smoothstep(.99,.92,r.y) * smoothstep(.95,.6,abs(r.x));
      c += vec3(.86,.93,1.) * 1.5 * box;
      float az = atan(r.x, r.z);
      c += vec3(1.,.76,.42) * 1.9 * smoothstep(.16,.0,abs(az+1.12)) * smoothstep(.85,.25,abs(r.y));
      c += vec3(.42,.66,1.) * 1.7 * smoothstep(.18,.0,abs(az-1.18)) * smoothstep(.85,.25,abs(r.y));
      return c;
    }`;
  const cardProg = program(`
    layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec2 aUv; layout(location=3) in float aMat;
    layout(location=4) in vec4 m0; layout(location=5) in vec4 m1; layout(location=6) in vec4 m2; layout(location=7) in vec4 aData; layout(location=8) in vec2 aLoc;
    uniform mat4 uVP; uniform float uMirror, uFloor; uniform vec2 uRough;
    out vec3 vP, vN; out vec2 vUv; flat out float vMat; flat out vec4 vD; out float vH; out vec2 vL;
    void main() {
      vec3 p = vec3(dot(m0, vec4(aPos,1.)), dot(m1, vec4(aPos,1.)), dot(m2, vec4(aPos,1.)));
      vec3 n = vec3(dot(m0.xyz,aNor), dot(m1.xyz,aNor), dot(m2.xyz,aNor));
      vH = p.y - uFloor;
      if (uMirror > .5) { p.y = 2.*uFloor - p.y; n.y = -n.y; p.xz += uRough * vH; }
      vP = p; vN = n; vUv = aUv; vMat = aMat; vD = aData; vL = aLoc;
      gl_Position = uVP * vec4(p, 1.);
    }`, COMMON + `
    in vec3 vP, vN; in vec2 vUv; flat in float vMat; flat in vec4 vD; in float vH; in vec2 vL;
    uniform sampler2DArray uLogo, uChip; uniform sampler2D uTitle; uniform float uIsTitle, uSweep, uR, uRep; uniform vec2 uHalf;
    out vec4 o;
    void main() {
      if (vH < 0.) discard;
      vec3 V = normalize(uEye - vP), N = normalize(vN);
      if (uMirror > .5) { V.y = -V.y; N.y = -N.y; }
      float nv = clamp(dot(N, V), 0., 1.);
      vec3 R = reflect(-V, N);
      vec3 E = env(R);
      float F = .035 + .965 * pow(1. - nv, 5.);
      vec3 L1 = normalize(vec3(-.35, .85, .55)), L2 = normalize(vec3(.6, .25, .8));
      float d = .60 + .30 * max(dot(N, L1), 0.) + .20 * max(dot(N, L2), 0.);
      float yy = uMirror > .5 ? 2.*uFloor - vP.y : vP.y;
      float th = atan(vP.x, -vP.z);
      float sw = exp(-pow((th * uR + yy * .55 - uSweep) / .85, 2.));      // 掃過牆面的光
      float flash = vD.y;
      vec3 c;
      if (vMat < .5) {
        vec3 tex = uIsTitle > .5 ? texture(uTitle, vUv).rgb : texture(uLogo, vec3(vUv, vD.x)).rgb;
        vec2 q = abs(vL) / uHalf;
        float edge = 1. - .10 * smoothstep(.72, 1., max(q.x, q.y));
        if (uIsTitle > .5) {
          float lum = dot(tex, vec3(.33));
          c = tex * d * 1.05 * (1.-F) + E * (F + .05) + tex * lum * (.55 + 1.4 * flash) + tex * sw * .6;
        } else {
          float grad = mix(.78, 1., vUv.y);                                  // 上亮下暗的棚燈漸層
          c = tex * 1.07 * d * grad * edge * (1.-F) + E * F * .9 + E * .03;
          c += tex * (.16 * sw + .20 * flash);
        }
      } else if (vMat < 1.5) {
        vec2 cu = vec2((1.-vUv.x) * uRep, vUv.y);
        vec3 tex = textureGrad(uChip, vec3(fract(cu.x), cu.y, vD.z), dFdx(cu), dFdy(cu)).rgb;
        float m = smoothstep(.06, .40, tex.r - tex.b * .55);
        float pulse = .5 + .5 * sin(uTime * 5. + vUv.x * 9. - vUv.y * 5. + vD.x);
        c = tex * (.45 + .5 * d) + E * (.05 + .55 * m) + vec3(1.,.72,.32) * m * (.35 + .75 * pulse * pulse);
      } else {
        c = vec3(1.,.80,.46) * (E * 1.25 + .05 + .10 * d) + vec3(1.,.70,.28) * (3.6 * flash + 1.5 * sw * vD.w);
      }
      float dist = length(uEye - vP);
      if (uMirror > .5) {
        float k = mix(.10, .46, pow(1. - clamp(abs(V.y), 0., 1.), 2.5)) * exp(-vH * .42);
        c *= k;
      }
      c = mix(c, FOG, 1. - exp(-max(dist - 5., 0.) * uFog));
      o = vec4(c, 1.);
    }`, 'card');

  const fsQuad = gl.createVertexArray();
  const FSV = 'out vec2 uv; void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); uv = p; gl_Position = vec4(p*2.-1., 0., 1.); }';

  const bgProg = program(FSV, `
    in vec2 uv; out vec4 o; uniform vec3 uRight, uUp, uFwd; uniform vec2 uTan; uniform float uTime, uHold;
    void main() {
      vec2 n = uv*2.-1.;
      vec3 d = normalize(uFwd + uRight*n.x*uTan.x + uUp*n.y*uTan.y);
      vec3 c = mix(vec3(.0010,.0024,.0070), vec3(.0026,.0070,.0215), smoothstep(-.35,.45,d.y));
      float glow = exp(-(pow(d.x*1.7,2.) + pow((d.y-.02)*3.0,2.)));
      c += vec3(.0062,.0185,.0560) * glow * mix(1.0, 1.35, uHold);
      o = vec4(c, 1.);
    }`, 'bg');

  /* 牆後的底板：藍圖格線與卡片縫隙中的金色走線 */
  function backMesh() {
    const v = [], n = 64, hw = (COLS * PX) / 2 + 3.2, hh = (ROWS * PY) / 2 + 0.14, r = R + 0.16;
    for (let i = 0; i < n; i++) {
      const u0 = -hw + (2 * hw * i) / n, u1 = -hw + (2 * hw * (i + 1)) / n;
      const P = (u, y) => [r * Math.sin(u / R), y, -r * Math.cos(u / R), u, y];
      const a = P(u0, -hh), b = P(u1, -hh), c = P(u1, hh), d = P(u0, hh);
      v.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    return new Float32Array(v);
  }
  const backData = backMesh();
  const backVao = gl.createVertexArray();
  gl.bindVertexArray(backVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, backData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.bindVertexArray(null);
  const backProg = program(`
    layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUv; uniform mat4 uVP; uniform float uMirror, uFloor; uniform vec2 uRough;
    out vec2 vUv; out vec3 vP; out float vH;
    void main(){ vec3 p = aPos; vH = p.y-uFloor; if (uMirror>.5) { p.y = 2.*uFloor-p.y; p.xz += uRough*vH; } vP = p; vUv = aUv; gl_Position = uVP*vec4(p,1.); }`, `
    in vec2 vUv; in vec3 vP; in float vH; out vec4 o;
    uniform float uTime, uBack, uMirror, uFloor; uniform vec2 uPitch, uGrid, uTitleC; uniform vec3 uEye;
    float line(float x, float w) { return exp(-pow(abs(x)/w, 1.6)); }
    void main() {
      if (vH < 0.) discard;
      vec2 half_ = uGrid * uPitch * .5;
      vec2 q = vUv / uPitch + uGrid*.5;                 // 格線在整數位置 = 卡片縫隙
      vec2 f = abs(fract(q + .5) - .5) * uPitch;
      float inside = step(abs(vUv.x), half_.x + .03) * step(abs(vUv.y), half_.y + .03);
      float g = max(line(f.x, .016), line(f.y, .016));
      float soft = max(line(f.x, .06), line(f.y, .06));
      float dist = length((vUv - uTitleC) * vec2(.82, 1.25));
      float wave = 0.;
      for (int k = 0; k < 3; k++) { float t0 = k == 0 ? 8.15 : (k == 1 ? 9.7 : 11.9); float r = (uTime - t0) * 6.2; wave += step(0., r) * exp(-pow((dist - r) / .75, 2.)) * exp(-r * .10); }
      vec3 gold = vec3(1.,.70,.30);
      vec3 c = vec3(.0012,.0034,.0100);
      c += inside * (gold * g * (.30 + 2.6 * wave) + gold * soft * (.022 + .36 * wave));
      vec2 fine = abs(fract(vUv * 2.5 + .5) - .5);
      float bp = max(line(fine.x, .02), line(fine.y, .02)) * (1. - inside);
      float fall = smoothstep(half_.x + 3.2, half_.x - .2, abs(vUv.x));
      c += vec3(.10,.26,.62) * bp * .045 * fall;
      if (uMirror > .5) c *= .34 * exp(-vH * .42);
      o = vec4(c * mix(fall, 1., inside) * uBack, uBack * mix(fall * .6, 1., inside));
    }`, 'back');

  /* 地面：藍圖格線與柔光 */
  const floorProg = program(`
    uniform mat4 uVP; uniform float uFloor; out vec3 vP;
    void main(){ vec2 p = vec2((gl_VertexID==1||gl_VertexID==2||gl_VertexID==4)?1.:-1., (gl_VertexID==2||gl_VertexID==4||gl_VertexID==5)?1.:-1.); vP = vec3(p.x*46., uFloor, p.y*34.-8.); gl_Position = uVP*vec4(vP,1.); }`, `
    in vec3 vP; out vec4 o; uniform vec3 uEye; uniform float uHold;
    void main(){
      vec2 f = abs(fract(vP.xz*.5+.5)-.5)*2.; vec2 w = fwidth(vP.xz)*.9+.012;
      float g = max(smoothstep(w.x,0.,f.x), smoothstep(w.y,0.,f.y));
      float d = length(vP - uEye); float fall = exp(-d*.085);
      float pool = exp(-pow(length((vP.xz - vec2(0.,-9.))*vec2(.12,.16)),2.));
      o = vec4(vec3(.16,.34,.78)*g*.040*fall + vec3(.0040,.0110,.0310)*pool*mix(.6,1.1,uHold), 1.);
    }`, 'floor');

  /* 連線（金色訊號） */
  const edges = [];
  {
    const seen = new Set();
    cards.forEach((c, i) => {
      const near = cards.map((o2, j) => [Math.hypot(...sub(c.p0, o2.p0)), j]).filter((x) => x[1] !== i).sort((a, b) => a[0] - b[0]).slice(0, 2);
      near.forEach(([, j]) => { const k = i < j ? i + '-' + j : j + '-' + i; if (!seen.has(k)) { seen.add(k); edges.push([i, j]); } });
    });
  }
  const lineVao = gl.createVertexArray(), lineBuf = gl.createBuffer(), lineData = new Float32Array(edges.length * 8);
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, lineData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  const lineProg = program(`
    layout(location=0) in vec4 aA; layout(location=1) in vec4 aB; uniform mat4 uVP; uniform vec2 uRes; uniform vec3 uLens;   // 光圈、對焦距離、tan(視角/2)
    out float vT, vS, vK; flat out vec2 vF;
    void main(){
      vec4 a = uVP*vec4(aA.xyz,1.), b = uVP*vec4(aB.xyz,1.);
      float t = (gl_VertexID&1)==0 ? 0. : 1., s = (gl_VertexID&2)==0 ? -1. : 1.;
      if (a.w < .2 || b.w < .2) { gl_Position = vec4(2.,2.,2.,1.); vT=0.; vS=0.; vK=0.; vF=vec2(0.); return; }
      vec2 d = normalize((b.xy/b.w - a.xy/a.w)*uRes + 1e-5);
      vec4 p = mix(a,b,t);
      float base = clamp(.012 * uRes.y / p.w, 1.0, 5.0) * 1.6;
      float coc = uLens.x * abs(p.w - uLens.y) / uLens.y / (p.w * uLens.z) * uRes.y * .5;
      float px = base + coc;
      vK = base / px;
      p.xy += vec2(-d.y,d.x)*s*px/uRes*p.w*2.;
      gl_Position = p; vT = t; vS = s; vF = vec2(aA.w, aB.w);
    }`, `
    in float vT, vS, vK; flat in vec2 vF; out vec4 o; uniform float uTime;
    void main(){
      float core = exp(-vS*vS*5.);
      float pos = fract(uTime*.42 + vF.x);
      float pulse = exp(-pow((vT-pos)/.06,2.)) + .5*exp(-pow((vT-fract(pos+.5))/.05,2.));
      vec3 c = vec3(.34,.54,1.)*.10 + vec3(1.,.72,.32)*(.07 + 2.0*pulse);
      o = vec4(c*core*vF.y*vK, 1.);
    }`, 'line');

  /* 金塵 */
  const DUST = 1100, dustData = new Float32Array(DUST * 8);
  {
    const r = rng(5150);
    for (let i = 0; i < DUST; i++) {
      const warm = r() < 0.62;
      dustData.set([mix(-13, 13, r()), mix(FLOOR + 0.1, FLOOR + (PORTRAIT ? 16 : 9), r()), mix(-14, 9, r()), 0.006 + 0.017 * Math.pow(r(), 3), warm ? 1 : 0.45, warm ? 0.76 : 0.68, warm ? 0.42 : 1, r() * 6.283], i * 8);
    }
  }
  const dustVao = gl.createVertexArray();
  gl.bindVertexArray(dustVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, dustData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  const dustProg = program(`
    layout(location=0) in vec4 aP; layout(location=1) in vec4 aC; uniform mat4 uVP; uniform vec3 uRight,uUp,uLens; uniform float uTime, uFloor;
    out vec2 vQ; flat out vec3 vC;
    void main(){
      vec2 q = vec2((gl_VertexID&1)*2-1, (gl_VertexID&2)-1);
      vec3 p = aP.xyz + vec3(sin(uTime*.35+aC.w)*.25, mod(uTime*.10+aC.w,6.283)*.12-.3, cos(uTime*.28+aC.w*1.7)*.25);
      float tw = .55+.45*sin(uTime*2.1+aC.w*5.);
      vC = aC.rgb*tw;
      vQ = q;
      float z = (uVP*vec4(p,1.)).w;
      float sz = aP.w*1.5, coc = uLens.x * abs(z - uLens.y) / uLens.y;
      vC *= pow(sz/(sz+coc), 1.7) * smoothstep(.4, 1.6, z);
      vec3 w = p + (uRight*q.x + uUp*q.y)*(sz+coc);
      gl_Position = uVP*vec4(w,1.);
    }`, `
    in vec2 vQ; flat in vec3 vC; out vec4 o; uniform float uDust;
    void main(){ float d = dot(vQ,vQ); if (d>1.) discard; o = vec4(vC*pow(1.-d,1.6)*1.7*uDust,1.); }`, 'dust');

  /* ---------- 畫布（浮點累積 → 光暈 → 色調） ---------- */
  function target(w, h, fmt, type, depth) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (depth) {
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) log('FBO incomplete ' + st);
    return { t, f, w, h };
  }
  const scene = target(W, H, gl.RGBA16F, 0, true);
  const accum = target(W, H, gl.RGBA32F);
  const outT = target(W, H, gl.RGBA8);
  const mips = [];
  for (let i = 0, w = W >> 1, h = H >> 1; i < 6; i++, w >>= 1, h >>= 1) mips.push([target(w, h, gl.RGBA16F), target(w, h, gl.RGBA16F)]);

  const copyProg = program(FSV, 'in vec2 uv; out vec4 o; uniform sampler2D uTex; uniform float uK; void main(){ o = min(texture(uTex,uv), vec4(24.))*uK; }', 'copy');
  const brightProg = program(FSV, `in vec2 uv; out vec4 o; uniform sampler2D uTex;
    void main(){ vec3 c = texture(uTex,uv).rgb; float l = max(c.r,max(c.g,c.b)); float k = max(l-1.02,0.)/max(l,1e-4); float warm = smoothstep(.10,.5,c.r-c.b)*smoothstep(.3,.9,l); o = vec4(c*max(k, warm*.35),1.); }`, 'bright');
  const downProg = program(FSV, `in vec2 uv; out vec4 o; uniform sampler2D uTex; uniform vec2 uPx;
    void main(){ vec3 c = texture(uTex,uv).rgb*.25; for (int i=0;i<4;i++){ vec2 d = vec2(i<2?-1.:1., (i&1)==0?-1.:1.); c += texture(uTex,uv+d*uPx).rgb*.125; c += texture(uTex,uv+d*uPx*2.).rgb*.0625; } o = vec4(c,1.); }`, 'down');
  const upProg = program(FSV, `in vec2 uv; out vec4 o; uniform sampler2D uTex, uPrev; uniform vec2 uPx; uniform float uMixK;
    void main(){ vec3 c = vec3(0.); float s=0.; for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++){ float w = (x==0?2.:1.)*(y==0?2.:1.); c += texture(uPrev,uv+vec2(x,y)*uPx*1.4).rgb*w; s+=w; } o = vec4(texture(uTex,uv).rgb + c/s*uMixK, 1.); }`, 'up');
  const finalProg = program(FSV, `in vec2 uv; out vec4 o; uniform sampler2D uTex, uBloom; uniform vec2 uRes; uniform float uSeed, uFade;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))+uSeed)*43758.5453); }
    vec3 tone(vec3 x){ vec3 a = x; vec3 s = .78 + .22*(1.-exp(-(x-.78)/.22)); return mix(a, s, step(.78, x)); }
    vec3 srgb(vec3 c){ return mix(12.92*c, 1.055*pow(max(c,1e-5), vec3(1./2.4))-.055, step(.0031308,c)); }
    void main(){
      vec2 p = vec2(uv.x, 1.-uv.y);                              // 讀出時由上到下
      vec3 c = texture(uTex,p).rgb + texture(uBloom,p).rgb*.62;
      vec2 q = (p-.5)*vec2(uRes.x/uRes.y,1.); float r = length(q)/length(vec2(uRes.x/uRes.y,1.)*.5);
      c *= 1.-.34*pow(r,2.6);
      c = srgb(clamp(tone(c),0.,1.))*uFade;
      c += (h(gl_FragCoord.xy)+h(gl_FragCoord.yx+3.7)-1.)*(1.1/255.);  // 抖色，避免深藍漸層出現色帶
      o = vec4(c,1.);
    }`, 'final');

  /* ---------- 畫一個取樣 ---------- */
  function radicalInverse(i, b) { let f = 1 / b, r = 0; while (i > 0) { r += f * (i % b); i = Math.floor(i / b); f /= b; } return r; }
  const GOLD = Math.PI * (3 - Math.sqrt(5));

  function drawSample(t, lens, jit, rough) {
    const cam = camera(t);
    const eye = add(cam.p, add(mul(cam.right, lens[0] * cam.aperture), mul(cam.up, lens[1] * cam.aperture)));
    const near = 0.1, far = 90, k = near / cam.focus;
    const sx = -lens[0] * cam.aperture * k, sy = -lens[1] * cam.aperture * k;
    const r = near * TANX, tp = near * TANY;
    const l0 = -r + sx, r0 = r + sx, b0 = -tp + sy, t0 = tp + sy;
    const P = new Float32Array([2 * near / (r0 - l0), 0, 0, 0, 0, 2 * near / (t0 - b0), 0, 0,
      (r0 + l0) / (r0 - l0) + jit[0] * 2 / W, (t0 + b0) / (t0 - b0) + jit[1] * 2 / H, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0]);
    const R_ = cam.right, U = cam.up, F = cam.fwd;
    const V = new Float32Array([R_[0], U[0], -F[0], 0, R_[1], U[1], -F[1], 0, R_[2], U[2], -F[2], 0, -dot(R_, eye), -dot(U, eye), dot(F, eye), 1]);
    const VP = m4mul(P, V);
    const P0 = new Float32Array([near / r, 0, 0, 0, 0, near / tp, 0, 0, jit[0] * 2 / W, jit[1] * 2 / H, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0]);
    const V0 = V.slice();
    V0[12] = -dot(R_, cam.p); V0[13] = -dot(U, cam.p); V0[14] = dot(F, cam.p);
    const VP0 = m4mul(P0, V0); // 不經過光圈取樣的鏡頭：金塵與連線自己算模糊
    const hold = smooth(5.2, 8.4, t);

    // 卡片矩陣
    const poses = cards.map((c) => cardPose(c, t));
    separate(poses);
    const D = cardGeo.data;
    cards.forEach((c, i) => {
      rows(poses[i].q, poses[i].p, 1, D, i * INST);
      D.set([c.layer, poses[i].flash, c.chip, poses[i].e], i * INST + 12);
    });
    let count = N;
    if (extra > 0) { // EMRD 徽章卡：跟著標題牌一起出現
      const s = slots[N], u = clamp((t - 7.0) / 1.3), e = easeInOut(u);
      rows(qMul(s.q, qAxis([0, 1, 0], Math.PI * (1 - e))), add(s.p, [0, 0, (1 - e) * 3.0]), Math.max(0.0001, smooth(0, 0.15, u)), D, N * INST);
      D.set([N, t > 8.3 ? Math.exp(-(t - 8.3) * 2.6) : smooth(0.86, 1, u), 0, 1], N * INST + 12);
      count = N + 1;
    }
    {
      const u = clamp((t - 6.75) / 1.45), e = easeInOut(u), back = 0.10 * Math.exp(-Math.max(t - 8.2, 0) * 5) * Math.sin(Math.max(t - 8.2, 0) * 15);
      const n = [-Math.sin(titleSlot.th), 0, Math.cos(titleSlot.th)];
      const q = qMul(titleSlot.q, qAxis([1, 0, 0], -Math.PI * (1 - e)));
      const p = add(titleSlot.p, mul(n, (1 - e) * 3.4 + back + 0.05 * e));
      rows(q, p, Math.max(0.0001, smooth(0, 0.12, u)), titleGeo.data, 0);
      titleGeo.data.set([0, t > 8.2 ? Math.exp(-(t - 8.2) * 1.5) + 0.10 * Math.exp(-Math.pow((t - 11.9) / 0.5, 2)) : smooth(0.8, 1, u), 2, 1], 12);
    }
    for (const g of [cardGeo, titleGeo]) { gl.bindBuffer(gl.ARRAY_BUFFER, g.ib); gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.data); }

    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.f);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(bgProg.p); gl.bindVertexArray(fsQuad);
    gl.uniform3fv(bgProg.u.uRight, R_); gl.uniform3fv(bgProg.u.uUp, U); gl.uniform3fv(bgProg.u.uFwd, F); gl.uniform2f(bgProg.u.uTan, TANX, TANY); gl.uniform1f(bgProg.u.uHold, hold);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const back = smooth(5.6, 8.0, t);
    const drawBack = (mirror) => {
      if (back <= 0.001) return;
      const u = backProg.u;
      gl.useProgram(backProg.p);
      gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform1f(u.uMirror, mirror); gl.uniform1f(u.uFloor, FLOOR); gl.uniform2fv(u.uRough, rough);
      gl.uniform1f(u.uTime, t); gl.uniform1f(u.uBack, back); gl.uniform2f(u.uPitch, PX, PY); gl.uniform2f(u.uGrid, COLS, ROWS); gl.uniform2f(u.uTitleC, titleSlot.th * R, titleSlot.y);
      gl.bindVertexArray(backVao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, backData.length / 5);
      gl.disable(gl.BLEND);
    };
    const drawCards = (mirror) => {
      const u = cardProg.u;
      gl.useProgram(cardProg.p);
      gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform3fv(u.uEye, eye); gl.uniform1f(u.uTime, t);
      gl.uniform1f(u.uFog, mix(0.060, 0.0035, smooth(4.8, 8.0, t))); gl.uniform1f(u.uMirror, mirror); gl.uniform1f(u.uFloor, FLOOR); gl.uniform2fv(u.uRough, rough);
      gl.uniform1i(u.uLogo, 0); gl.uniform1i(u.uChip, 1); gl.uniform1i(u.uTitle, 2); gl.uniform1f(u.uR, R);
      const span = (COLS * PX) / 2 + 4.5;
      gl.uniform1f(u.uSweep, t < 9.0 ? -99 : mix(-span, span, (t - 9.2) / 2.6));
      gl.uniform1f(u.uIsTitle, 0); gl.uniform1f(u.uRep, 1); gl.uniform2f(u.uHalf, CW / 2, CH / 2);
      gl.bindVertexArray(cardGeo.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, cardGeo.count, count);
      if (t > 6.76) {
        gl.uniform1f(u.uIsTitle, 1); gl.uniform1f(u.uRep, Math.round(TITLE_W / CW)); gl.uniform2f(u.uHalf, TITLE_W / 2, CH / 2);
        gl.bindVertexArray(titleGeo.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, titleGeo.count, 1);
      }
    };

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    drawBack(1); drawCards(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(floorProg.p); gl.bindVertexArray(fsQuad);
    gl.uniformMatrix4fv(floorProg.u.uVP, false, VP); gl.uniform1f(floorProg.u.uFloor, FLOOR); gl.uniform3fv(floorProg.u.uEye, eye); gl.uniform1f(floorProg.u.uHold, hold);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
    drawBack(0); drawCards(0);

    // 連線與金塵：加亮混合、不寫深度
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const lineFade = smooth(0, 0.6, t + 0.6) * (1 - smooth(4.4, 5.6, t));
    if (lineFade > 0.001) {
      edges.forEach(([i, j], k) => {
        const a = poses[i].p, b = poses[j].p, f = lineFade * (1 - smooth(0, 0.35, Math.max(poses[i].e, poses[j].e)));
        lineData.set([a[0], a[1], a[2], (k * 0.618) % 1, b[0], b[1], b[2], f], k * 8);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData);
      gl.useProgram(lineProg.p); gl.bindVertexArray(lineVao);
      gl.uniformMatrix4fv(lineProg.u.uVP, false, VP0); gl.uniform3f(lineProg.u.uLens, cam.aperture, cam.focus, TANY); gl.uniform2f(lineProg.u.uRes, W, H); gl.uniform1f(lineProg.u.uTime, t);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, edges.length);
    }
    gl.useProgram(dustProg.p); gl.bindVertexArray(dustVao);
    gl.uniformMatrix4fv(dustProg.u.uVP, false, VP0); gl.uniform3f(dustProg.u.uLens, cam.aperture, cam.focus, TANY); gl.uniform3fv(dustProg.u.uRight, R_); gl.uniform3fv(dustProg.u.uUp, U); gl.uniform1f(dustProg.u.uTime, t); gl.uniform1f(dustProg.u.uDust, mix(1, 0.6, hold));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, DUST);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
  }

  function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  function pass(prog, dst) { gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, dst.w, dst.h); gl.useProgram(prog.p); gl.bindVertexArray(fsQuad); }

  function renderFrame(t, frame) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.f);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const shutter = 0.5 / FPS;
    for (let s = 0; s < SAMPLES; s++) {
      const tj = t + ((s + radicalInverse(frame + 1, 2)) / SAMPLES - 0.5) * shutter;
      const perm = (s * 37 + 11) % SAMPLES; // 光圈與時間錯開，避免相關
      const rr = Math.sqrt((perm + 0.5) / SAMPLES), aa = perm * GOLD;
      const jit = [radicalInverse(s + 1, 2) - 0.5, radicalInverse(s + 1, 3) - 0.5];
      const ra = ((s * 23 + 5) % SAMPLES) * GOLD, rb = Math.sqrt((((s * 23 + 5) % SAMPLES) + 0.5) / SAMPLES) * 0.030;
      drawSample(Math.max(tj, 0), [rr * Math.cos(aa), rr * Math.sin(aa)], jit, [rb * Math.cos(ra), rb * Math.sin(ra) * 2.2]);
      pass(copyProg, accum);
      bindTex(3, scene.t); gl.uniform1i(copyProg.u.uTex, 3); gl.uniform1f(copyProg.u.uK, 1 / SAMPLES);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    }
    // 光暈
    pass(brightProg, mips[0][0]); bindTex(3, accum.t); gl.uniform1i(brightProg.u.uTex, 3); gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let i = 1; i < mips.length; i++) {
      pass(downProg, mips[i][0]); bindTex(3, mips[i - 1][0].t); gl.uniform1i(downProg.u.uTex, 3); gl.uniform2f(downProg.u.uPx, 1 / mips[i - 1][0].w, 1 / mips[i - 1][0].h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    let prev = mips[mips.length - 1][0];
    for (let i = mips.length - 2; i >= 0; i--) {
      pass(upProg, mips[i][1]); bindTex(3, mips[i][0].t); bindTex(4, prev.t);
      gl.uniform1i(upProg.u.uTex, 3); gl.uniform1i(upProg.u.uPrev, 4); gl.uniform2f(upProg.u.uPx, 1 / prev.w, 1 / prev.h); gl.uniform1f(upProg.u.uMixK, 0.82);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      prev = mips[i][1];
    }
    pass(finalProg, outT); bindTex(3, accum.t); bindTex(4, prev.t);
    gl.uniform1i(finalProg.u.uTex, 3); gl.uniform1i(finalProg.u.uBloom, 4); gl.uniform2f(finalProg.u.uRes, W, H); gl.uniform1f(finalProg.u.uSeed, (frame % 97) * 0.37); gl.uniform1f(finalProg.u.uFade, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const pixels = new Uint8Array(W * H * 4);
  function read() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, outT.f);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  const err = gl.getError();
  if (err) await log('GL error during setup ' + err);
  if (STILLS) {
    for (const t of STILLS) {
      renderFrame(t, Math.round(t * FPS));
      const px = read();
      const c = canvasOf(W, H), g = c.getContext('2d');
      g.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/' + (Q.get('type') || 'jpeg'), 0.93));
      await post('/still?t=' + t, blob);
    }
  } else {
    const total = Math.round(DUR * FPS), t0 = performance.now();
    for (let f = 0; f < total; f++) {
      renderFrame(f / FPS, f);
      await post('/frame?i=' + f, read());
      if (f % 30 === 0) await log(`frame ${f}/${total} ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    }
  }
  const e2 = gl.getError();
  if (e2) await log('GL error ' + e2);
  await post('/done', '');
})();
