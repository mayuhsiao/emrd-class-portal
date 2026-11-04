/* =========================================================
 * EMRD Lucky Draw — 3D 滾筒拉霸
 * CSS 3D 圓柱（12 面），名字虛擬化：轉到背面的格子才換字，
 * 因此候選人再多也只需要 12 個 DOM 節點。
 * ========================================================= */
(function (LD) {
  'use strict';

  var FACES = 12;
  var STEP = 360 / FACES;
  var NAME_FONT = '900 100px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif';
  var measureCtx = document.createElement('canvas').getContext('2d');
  var active = [];
  var lastTs = 0;

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mod(a, n) { return ((a % n) + n) % n; }

  /**
   * @param {{kind:'drawer'|'gift'|'prize', caption?:string, index?:number, faceRatio?:number}} opts
   */
  function Reel(opts) {
    this.kind = opts.kind || 'prize';
    this.caption = opts.caption || '';
    this.index = opts.index || 0;
    this.faceRatio = opts.faceRatio || 2.7;
    this.items = [];
    this.seq = [];
    this.over = new Map(); // 指定某一格顯示誰（中獎格、保留畫面上的格子）
    this.pos = Math.floor(Math.random() * 400);
    this.vel = 0;
    this.state = 'drift';
    this.t = 0;
    this.r = 200;
    this.blur = 0;
    this.maxW = 300;
    this.lastSlot = Math.round(this.pos);
    this.faceSlot = [];
    this.faceItem = [];
    this.stopReq = null;
    this.onTick = null;
    this.build();
  }

  Reel.prototype.build = function () {
    var el = (this.el = document.createElement('div'));
    el.className = 'reel reel-' + this.kind;
    el.innerHTML =
      (this.caption ? '<div class="reel-cap">' + esc(this.caption) + '</div>' : '') +
      '<div class="reel-window">' +
      '<div class="reel-persp"><div class="drum"></div></div>' +
      '<div class="reel-shade"></div>' +
      '<div class="payline"><i></i><i></i></div>' +
      '<div class="reel-glass"></div>' +
      '</div>';
    this.win = el.querySelector('.reel-window');
    this.persp = el.querySelector('.reel-persp');
    this.drum = el.querySelector('.drum');
    this.faces = [];
    for (var i = 0; i < FACES; i++) {
      var f = document.createElement('div');
      f.className = 'face';
      this.drum.appendChild(f);
      this.faces.push(f);
      this.faceSlot.push(NaN);
      this.faceItem.push(undefined);
    }
  };

  /** 一格的內容：照片（右下角編號、禮物轉盤左上角加 🎁）＋ 姓名 */
  Reel.prototype.html = function (it) {
    if (!it) return '';
    var badges = '<span class="no">' + pad(it.id) + '</span>' + (this.kind === 'gift' ? '<span class="gico">🎁</span>' : '');
    return '<span class="nm">' + LD.photos.avatar(it, '', badges) + '<span class="tx">' + esc(it.name) + '</span></span>';
  };

  Reel.prototype.slotItem = function (s) {
    if (this.over.has(s)) return this.over.get(s);
    var n = this.seq.length;
    return n ? this.seq[mod(s, n)] : null;
  };

  /** 換一批候選名單；畫面上看得到的格子維持原狀，避免名字突然跳掉 */
  Reel.prototype.setItems = function (items) {
    if (this.seq.length) {
      var c = Math.round(this.pos);
      for (var s = c - 4; s <= c + 4; s++) if (!this.over.has(s)) this.over.set(s, this.slotItem(s));
    }
    this.items = items.slice();
    this.seq = LD.logic.shuffle(this.items);
    this.measure();
    this.layout();
  };

  Reel.prototype.measure = function () {
    measureCtx.font = NAME_FONT;
    var m = 0;
    for (var i = 0; i < this.items.length; i++) {
      var w = measureCtx.measureText(this.items[i].name).width;
      if (w > m) m = w;
    }
    this.maxW = m || 200;
  };

  /** 依視窗大小計算面高、圓柱半徑與字級 */
  Reel.prototype.layout = function () {
    var w = this.win.clientWidth, h = this.win.clientHeight;
    if (!w || !h) { this.render(); return; }
    var faceH = h / this.faceRatio;
    var r = faceH / (2 * Math.tan(Math.PI / FACES));
    var em = this.maxW / 100 + 1.75; // 姓名寬 + 照片（1.3em）與間距
    var fs = Math.min(faceH * 0.6, (w * 0.86) / Math.max(em, 2.2));
    this.r = r;
    this.el.style.setProperty('--face-h', faceH.toFixed(1) + 'px');
    this.el.style.setProperty('--fs', fs.toFixed(1) + 'px');
    this.persp.style.perspective = (r * 3.4).toFixed(0) + 'px';
    for (var i = 0; i < FACES; i++) {
      this.faces[i].style.transform = 'rotateX(' + i * STEP + 'deg) translateZ(' + r.toFixed(1) + 'px)';
    }
    this.render();
  };

  Reel.prototype.render = function () {
    var p = this.pos;
    this.drum.style.transform = 'translateZ(' + (-this.r).toFixed(1) + 'px) rotateX(' + (-p * STEP).toFixed(2) + 'deg)';
    for (var i = 0; i < FACES; i++) {
      var s = i + FACES * Math.round((p - i) / FACES);
      if (s !== this.faceSlot[i]) {
        this.faceSlot[i] = s;
        var it = this.slotItem(s);
        if (it !== this.faceItem[i]) {
          this.faceItem[i] = it;
          this.faces[i].innerHTML = this.html(it);
          this.faces[i].classList.remove('win');
        }
      }
    }
    var v = Math.abs(this.vel);
    var b = v > 6 ? Math.min(3.2, (v - 6) * 0.18) : 0;
    if (Math.abs(b - this.blur) > 0.1 || (b === 0 && this.blur !== 0)) {
      this.blur = b;
      this.persp.style.filter = b ? 'blur(' + b.toFixed(1) + 'px)' : '';
    }
  };

  function clock() { return performance.now() / 1000; }

  /** 開始轉：先往回蓄力一下，再加速到全速 */
  Reel.prototype.start = function (delay) {
    this.clearWin();
    this.vmax = 16 + Math.random() * 6;
    this.state = 'windup';
    this.t0 = clock() + (delay || 0);
    this.stopReq = null;
    this.el.classList.add('spinning');
  };

  /**
   * 指定停在誰身上：wait 秒後開始減速，減速 dur 秒。
   * 時間以實際時鐘計算，就算瀏覽器掉幀，開獎時間也不會被拖長。
   */
  Reel.prototype.stopAt = function (item, wait, dur, cb) {
    this.stopReq = { item: item, at: clock() + wait, dur: dur, cb: cb };
  };

  Reel.prototype.beginStop = function (now) {
    var req = this.stopReq;
    this.stopReq = null;
    var v0 = Math.max(this.vel, 9);
    var dist = Math.max(FACES / 2 + 2.5, (v0 * req.dur) / 4);
    var T = Math.ceil(this.pos + dist); // 目標格在背面，換字不會被看到
    this.over.set(T, req.item);
    for (var d = -2; d <= 2; d++) {
      if (!d) continue;
      var it = this.slotItem(T + d);
      if (it && it.id === req.item.id) this.over.set(T + d, this.altItem(req.item.id));
    }
    this.p0 = this.pos;
    this.T = T;
    this.B = 0.16; // 稍微衝過頭再彈回，機械感
    this.dur = (4 * (T + this.B - this.pos)) / v0; // 起始速度與目前速度相同 → 減速連續不頓
    this.state = 'stop';
    this.ts = now;
    this.landCb = req.cb;
  };

  Reel.prototype.altItem = function (id) {
    var c = this.seq.filter(function (x) { return x.id !== id; });
    return c.length ? c[(Math.random() * c.length) | 0] : this.slotItem(this.T || 0);
  };

  Reel.prototype.step = function (dt, now) {
    var st = this.state;
    if (st === 'landed') return;
    if (st === 'drift') {
      this.vel = 0.45;
      this.pos += this.vel * dt;
    } else if (st === 'windup') {
      if (now < this.t0) {
        this.vel = 0;
      } else if (now < this.t0 + 0.18) {
        this.vel = -2.4;
        this.pos += this.vel * dt;
      } else {
        this.state = 'accel';
        this.t1 = now;
      }
    } else if (st === 'accel' || st === 'spin') {
      if (st === 'accel') {
        var k = Math.min(1, (now - this.t1) / 0.7);
        this.vel = this.vmax * k * k;
        if (k >= 1) this.state = 'spin';
      } else {
        this.vel = this.vmax;
      }
      this.pos += this.vel * dt;
      if (this.stopReq && now >= this.stopReq.at) this.beginStop(now);
    } else if (st === 'stop') {
      var t = now - this.ts;
      var np;
      if (t < this.dur) {
        var u = t / this.dur;
        np = this.p0 + (this.T + this.B - this.p0) * (1 - Math.pow(1 - u, 4));
      } else {
        var w = Math.min(1, (t - this.dur) / 0.34);
        np = this.T + this.B * (0.5 + 0.5 * Math.cos(Math.PI * w));
      }
      this.vel = (np - this.pos) / Math.max(dt, 1e-4);
      this.pos = np;
      if (t >= this.dur + 0.34) {
        this.pos = this.T;
        this.vel = 0;
        this.state = 'landed';
        this.render();
        this.markWin();
        if (this.landCb) this.landCb(this);
        return;
      }
    }
    this.tidy();
    this.render();
    var slot = Math.round(this.pos);
    if (slot !== this.lastSlot) {
      this.lastSlot = slot;
      if (this.onTick && st !== 'drift') this.onTick(this);
    }
  };

  Reel.prototype.tidy = function () {
    if (this.over.size < 24) return;
    var min = this.pos - FACES;
    var self = this;
    this.over.forEach(function (v, k) { if (k < min) self.over.delete(k); });
  };

  Reel.prototype.markWin = function () {
    this.el.classList.remove('spinning');
    this.el.classList.add('landed');
    for (var i = 0; i < FACES; i++) {
      if (this.faceSlot[i] === this.T) this.faces[i].classList.add('win');
    }
  };

  Reel.prototype.clearWin = function () {
    this.el.classList.remove('landed');
    for (var i = 0; i < FACES; i++) this.faces[i].classList.remove('win');
  };

  Reel.prototype.center = function () {
    var r = this.win.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  function frame() {
    var ts = performance.now();
    var dt = Math.max(0, Math.min(0.1, (ts - lastTs) / 1000 || 0.016));
    lastTs = ts;
    var now = ts / 1000;
    for (var i = 0; i < active.length; i++) active[i].step(dt, now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  Reel.setActive = function (list) { active = list.slice(); };
  Reel.NAME_FONT = NAME_FONT;

  LD.Reel = Reel;
})(window.LD = window.LD || {});
