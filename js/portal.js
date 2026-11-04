/* =========================================================
 * EMRD 班級入口首頁
 * 輪播、抽獎卡片（晶圓動畫）、影片、活動花絮燈箱、Logo 牆、班級網站連結
 * ========================================================= */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const D = window.PORTAL;
  const LD = window.LD || {};
  const CALM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CLASS_SITE = 'https://emrd115.netlify.app/';

  /* ---------- 導覽列 ---------- */
  function initNav() {
    const nav = $('#nav');
    const toggle = $('#navToggle');
    const onScroll = () => nav.classList.toggle('is-solid', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
    };
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
    $('#navLinks').addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  }

  /* ---------- 首屏輪播 ---------- */
  function initHero() {
    const hero = $('#top');
    const stage = $('#heroStage');
    const ticksEl = $('#heroTicks');
    const sweep = $('#heroSweep');
    const playBtn = $('#heroPlay');

    const items = D.hero.map((h) => Object.assign({ type: 'img', dur: 6500 }, h));
    items.splice(D.heroFilmAfter, 0, {
      type: 'film', src: 'assets/video/hero-bg.mp4', poster: 'assets/portal/film-poster.webp',
      title: '臺科大形象動畫', meta: 'NTUST · EMRD', dur: 15000, ox: 50, oy: 50
    });
    const n = items.length;
    let cur = 0;
    let token = 0;
    let userPaused = false;
    let offscreen = false;

    const els = items.map((it, i) => {
      let el = i === 0 ? $('.slide', stage) : null;
      if (!el) {
        el = document.createElement('div');
        el.className = 'slide' + (it.type === 'film' ? ' slide-film' : '');
        el.innerHTML = it.type === 'film'
          ? `<video muted playsinline preload="none" poster="${esc(it.poster)}" aria-label="${esc(it.title)}"></video>`
          : `<img alt="${esc(it.title)} · ${esc(it.meta)}" decoding="async">`;
        stage.appendChild(el);
      }
      el.style.setProperty('--ox', it.ox + '%');
      el.style.setProperty('--oy', it.oy + '%');
      el.setAttribute('role', 'group');
      el.setAttribute('aria-roledescription', 'slide');
      el.setAttribute('aria-label', `第 ${i + 1} 張，共 ${n} 張：${it.title}`);
      return el;
    });

    ticksEl.innerHTML = items.map((it, i) =>
      `<button type="button" class="tick${it.type === 'film' ? ' is-film' : ''}" data-i="${i}" aria-label="第 ${i + 1} 張：${esc(it.title)}"><i></i></button>`).join('');
    const ticks = $$('.tick', ticksEl);

    function load(i) {
      const it = items[i];
      const el = els[i];
      if (it.type === 'film') {
        const v = $('video', el);
        if (!v.getAttribute('src')) {
          v.src = it.src;
          v.preload = 'auto';
        }
        return Promise.resolve();
      }
      const img = $('img', el);
      if (!img.getAttribute('src')) img.src = it.src;
      const ready = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
      return Promise.race([ready, new Promise((r) => setTimeout(r, 1200))]);
    }

    function filmEl() {
      return items[cur].type === 'film' ? $('video', els[cur]) : null;
    }

    function syncPause() {
      const paused = userPaused || offscreen || document.hidden;
      hero.classList.toggle('is-paused', paused);
      hero.classList.toggle('user-paused', userPaused);
      playBtn.setAttribute('aria-label', userPaused ? '播放輪播' : '暫停輪播');
      const v = filmEl();
      if (v) {
        if (paused) v.pause();
        else v.play().catch(() => {});
      }
    }

    function renderCap() {
      const it = items[cur];
      const cap = $('#heroCap');
      cap.classList.remove('swap');
      void cap.offsetWidth;
      cap.innerHTML = `<span class="hero-idx"><b>${pad(cur + 1)}</b><i>/ ${n}</i></span>` +
        `<span class="hero-txt"><b>${esc(it.title)}</b><small>${esc(it.meta)}</small></span>`;
      cap.classList.add('swap');
    }

    function renderTicks() {
      ticks.forEach((t, k) => {
        t.classList.toggle('done', k < cur);
        t.classList.remove('on');
        if (k === cur) t.setAttribute('aria-current', 'true');
        else t.removeAttribute('aria-current');
      });
      void ticksEl.offsetWidth; // 讓進度條重新開始
      ticks[cur].style.setProperty('--dur', items[cur].dur + 'ms');
      ticks[cur].classList.add('on');
    }

    function apply(i) {
      const prevEl = els[cur];
      const prevFilm = filmEl();
      if (prevFilm) prevFilm.pause();
      const el = els[i];
      if (i !== cur) {
        prevEl.classList.remove('is-active');
        prevEl.classList.add('is-prev');
        setTimeout(() => { if (prevEl !== els[cur]) prevEl.classList.remove('is-prev'); }, 1700);
      }
      el.classList.remove('is-prev', 'is-active');
      void el.offsetWidth; // 讓緩慢推近的動畫重新開始
      el.classList.add('is-active');
      cur = i;
      hero.classList.toggle('on-film', items[cur].type === 'film');
      const v = filmEl();
      if (v) {
        try { v.currentTime = 0; } catch (e) { /* 影片尚未載入 */ }
      }
      if (!CALM) {
        sweep.classList.remove('go');
        void sweep.offsetWidth;
        sweep.classList.add('go');
      }
      renderCap();
      renderTicks();
      syncPause();
      load((cur + 1) % n);
    }

    function show(i) {
      const t = ++token;
      const target = (i + n) % n;
      load(target).then(() => { if (t === token) apply(target); });
    }

    // 進度條跑完就換下一張；暫停時進度條停住，時間不會跑掉
    ticksEl.addEventListener('animationend', (e) => { if (e.animationName === 'tickFill') show(cur + 1); });
    ticksEl.addEventListener('click', (e) => {
      const b = e.target.closest('.tick');
      if (b) show(Number(b.dataset.i));
    });
    $('#heroPrev').addEventListener('click', () => show(cur - 1));
    $('#heroNext').addEventListener('click', () => show(cur + 1));
    playBtn.addEventListener('click', () => {
      userPaused = !userPaused;
      syncPause();
    });
    document.addEventListener('keydown', (e) => {
      if (offscreen || $('dialog[open]')) return;
      if (e.key === 'ArrowLeft') show(cur - 1);
      else if (e.key === 'ArrowRight') show(cur + 1);
    });
    let touchX = null;
    hero.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 48) show(cur + (dx < 0 ? 1 : -1));
    }, { passive: true });

    new IntersectionObserver(([e]) => {
      offscreen = !e.isIntersecting;
      syncPause();
    }, { threshold: 0.2 }).observe(hero);
    document.addEventListener('visibilitychange', syncPause);

    renderCap();
    renderTicks();
    syncPause();
    load(1);
  }

  /* ---------- 捲動進場 ---------- */
  function initReveal() {
    const items = $$('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach((el) => io.observe(el));
  }

  /* ---------- 數字跑動 ---------- */
  function initCounts() {
    const els = $$('[data-count]');
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        const end = Number(e.target.dataset.count);
        const t0 = performance.now();
        const tick = (t) => {
          const u = clamp((t - t0) / 1300, 0, 1);
          e.target.textContent = Math.round(end * (1 - Math.pow(1 - u, 3)));
          if (u < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.6 });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- 抽獎卡片：讀取抽獎程式的名單與進度 ---------- */
  function readDrawState() {
    try {
      return JSON.parse(window.localStorage.getItem(LD.STORAGE_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  function initEntry() {
    const st = readDrawState();
    const people = (st && Array.isArray(st.participants) && st.participants.length)
      ? st.participants
      : (LD.DEFAULT_NAMES || []).map((name, i) => ({ id: i + 1, name }));
    const prize = (st && st.prize && st.prize.records) || [];
    const swap = (st && st.exchange && st.exchange.records) || [];
    const drawn = new Set(prize.map((r) => r.id));
    const left = people.filter((p) => !drawn.has(p.id)).length;
    $('#prizeStatus').textContent = prize.length ? `已抽出 ${prize.length} 人 · 候選 ${left} 人` : `名單 ${people.length} 人 · 尚未開始`;
    $('#swapStatus').textContent = swap.length ? `已交換 ${swap.length} / ${people.length} 人` : `名單 ${people.length} 人 · 尚未開始`;
    buildWafer($('#waferArt'), people, drawn);

    // 光線跟著滑鼠走，卡片微微傾斜（減少動態時只留光線）
    if (window.matchMedia('(hover: hover)').matches) {
      $$('.card').forEach((card) => {
        card.addEventListener('pointermove', (e) => {
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
          card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
          if (CALM) return;
          card.style.setProperty('--rx', ((0.5 - y) * 3.2).toFixed(2) + 'deg');
          card.style.setProperty('--ry', ((x - 0.5) * 3.2).toFixed(2) + 'deg');
        });
        card.addEventListener('pointerleave', () => {
          card.style.setProperty('--rx', '0deg');
          card.style.setProperty('--ry', '0deg');
        });
      });
    }
  }

  /** 每一顆晶粒代表一位同學：光點在晶圓上跳動後停在某一顆，就像抽獎；已中獎的晶粒會變暗 */
  function buildWafer(svg, people, drawn) {
    const R = 150;
    const N = Math.max(people.length, 1);
    let size = 60;
    let cells = [];
    for (; size > 10; size -= 1) {
      cells = [];
      const half = Math.ceil(R / size) + 1;
      for (let j = -half; j < half; j++) {
        for (let i = -half; i < half; i++) {
          const x = i * size;
          const y = j * size;
          const far = Math.max(Math.hypot(x, y), Math.hypot(x + size, y), Math.hypot(x, y + size), Math.hypot(x + size, y + size));
          if (far < R - 5) cells.push({ x, y, d: far });
        }
      }
      if (cells.length >= N) break;
    }
    cells = cells.sort((a, b) => a.d - b.d).slice(0, N).sort((a, b) => a.y - b.y || a.x - b.x);
    const gap = Math.max(1.6, size * 0.07);
    const dies = cells.map((c, k) => {
      const p = people[k];
      const off = drawn.has(p.id);
      return `<g class="die${off ? ' off' : ''}" data-k="${k}"><rect x="${c.x + gap / 2}" y="${c.y + gap / 2}" width="${size - gap}" height="${size - gap}" rx="2.5"/>` +
        `<text x="${c.x + size / 2}" y="${c.y + size / 2}">${pad(p.id)}</text></g>`;
    }).join('');
    // 晶圓邊緣沒有人的位置畫成淡淡的切割道
    let streets = '';
    for (let k = Math.floor(-R / size); k <= Math.ceil(R / size); k++) {
      streets += `M${k * size} ${-R}V${R}M${-R} ${k * size}H${R}`;
    }
    svg.innerHTML =
      `<defs><radialGradient id="waferSheen" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#2d62c9" stop-opacity=".55"/><stop offset=".6" stop-color="#0f2a66" stop-opacity=".5"/><stop offset="1" stop-color="#081534" stop-opacity=".7"/></radialGradient>` +
      `<clipPath id="waferClip"><circle r="148"/></clipPath></defs>` +
      `<circle class="w-ring" r="166"/><path class="w-cross" d="M-170 0h26M144 0h26M0-170v26M0 144v26"/>` +
      `<path class="w-disc" d="M-13-149.4A150 150 0 1 0 13-149.4L8-143h-16z" transform="rotate(180)"/>` +
      `<path class="w-streets" clip-path="url(#waferClip)" d="${streets}"/>` +
      `<g class="w-dies" style="--fs:${(size * 0.3).toFixed(1)}px">${dies}</g>`;

    const all = $$('.die', svg);
    const pool = all.filter((d) => !d.classList.contains('off'));
    if (!pool.length) return;
    let timer = 0;
    let running = false;
    let last = null;
    let hops = 0;
    const clear = () => { if (last) last.classList.remove('hot', 'win'); };
    const step = () => {
      if (!running) return;
      clear();
      let next = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1 && next === last) next = pool[(pool.indexOf(next) + 1) % pool.length];
      last = next;
      hops += 1;
      const TOTAL = 16;
      if (hops >= TOTAL) { // 停在這一顆，亮一下再重新開始
        next.classList.add('win');
        hops = 0;
        timer = setTimeout(step, 2100);
      } else {
        next.classList.add('hot');
        timer = setTimeout(step, 70 + Math.pow(hops / TOTAL, 3) * 430);
      }
    };
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !running) {
        running = true;
        step();
      } else if (!e.isIntersecting) {
        running = false;
        clearTimeout(timer);
      }
    }, { threshold: 0.2 }).observe(svg);
  }

  /* ---------- 影片區：捲動時由畫框放大到滿版 ---------- */
  function initFilm() {
    const film = $('#film');
    const frame = $('#filmFrame');
    const video = $('#filmVideo');
    const toggle = $('#filmToggle');
    const wide = window.matchMedia('(min-width: 900px)');
    let userPaused = false;
    let inView = false;

    const sync = () => {
      film.classList.toggle('user-paused', userPaused);
      toggle.setAttribute('aria-label', userPaused ? '播放影片' : '暫停影片');
      if (inView && !userPaused && !document.hidden) video.play().catch(() => {});
      else video.pause();
    };
    toggle.addEventListener('click', () => {
      userPaused = !userPaused;
      sync();
    });
    new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      sync();
    }, { threshold: 0.12 }).observe(film);
    document.addEventListener('visibilitychange', sync);

    let queued = false;
    const update = () => {
      queued = false;
      if (!wide.matches || CALM) {
        frame.style.removeProperty('--e');
        film.classList.add('open');
        return;
      }
      const vh = window.innerHeight;
      const top = film.getBoundingClientRect().top;
      const e = clamp(1 - top / (vh * 0.85), 0, 1); // 0 = 畫框，1 = 滿版
      const eased = 1 - Math.pow(1 - e, 1.4);
      frame.style.setProperty('--e', eased.toFixed(4));
      film.classList.toggle('open', e > 0.72);
    };
    const queue = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    update();
  }

  /* ---------- 活動花絮與燈箱 ---------- */
  function initGallery() {
    const all = D.gallery;
    const box = $('#masonry');
    const moreBtn = $('#moreBtn');
    const lb = $('#lightbox');
    const lbImg = $('#lbImg');
    let kind = 'all';
    let expanded = false;
    let list = all;
    let idx = 0;

    function render() {
      list = all.filter((g) => kind === 'all' || g.kind === kind);
      const shown = kind === 'all' && !expanded ? list.slice(0, D.galleryFirst) : list;
      box.innerHTML = shown.map((g, i) => `
        <button type="button" class="shot" data-i="${list.indexOf(g)}" style="--d:${(i % 8) * 45}ms" aria-label="放大檢視：${esc(g.cap)} ${esc(g.date)}">
          <img src="${esc(g.thumb)}" loading="lazy" decoding="async" width="${g.w}" height="${g.h}" alt="${esc(g.cap)} ${esc(g.date)}">
          <span class="shot-cap"><b>${esc(g.cap)}</b><small>${esc(g.date)}</small></span>
          <span class="corner tl"></span><span class="corner br"></span>
        </button>`).join('');
      moreBtn.hidden = shown.length >= list.length;
      moreBtn.textContent = `看全部 ${list.length} 張`;
    }

    function showShot() {
      const g = list[idx];
      lbImg.src = g.full;
      lbImg.alt = `${g.cap} ${g.date}`;
      $('#lbCap').textContent = g.cap;
      $('#lbMeta').textContent = `${g.date}　${pad(idx + 1)} / ${list.length}`;
      [idx + 1, idx - 1].forEach((k) => {
        const near = list[(k + list.length) % list.length];
        if (near) new Image().src = near.full;
      });
    }
    function move(d) {
      idx = (idx + d + list.length) % list.length;
      showShot();
    }

    box.addEventListener('click', (e) => {
      const b = e.target.closest('.shot');
      if (!b) return;
      idx = Number(b.dataset.i);
      showShot();
      lb.showModal();
      document.documentElement.classList.add('lb-open');
    });
    lb.addEventListener('close', () => {
      document.documentElement.classList.remove('lb-open');
      lbImg.removeAttribute('src');
    });
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target.tagName === 'FIGURE') lb.close(); });
    lb.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === 'ArrowRight') move(1);
    });
    $('#lbClose').addEventListener('click', () => lb.close());
    $('#lbPrev').addEventListener('click', () => move(-1));
    $('#lbNext').addEventListener('click', () => move(1));
    let touchX = null;
    lb.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 48) move(dx < 0 ? 1 : -1);
    }, { passive: true });

    moreBtn.addEventListener('click', () => {
      expanded = true;
      render();
    });
    $$('.seg button').forEach((b) => b.addEventListener('click', () => {
      kind = b.dataset.kind;
      $$('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    }));
    render();
  }

  /* ---------- Logo 牆 ---------- */
  function initLogos() {
    const wall = $('#logoWall');
    wall.innerHTML = D.logos.map((l, i) => {
      const delay = `--d:${(i % 9) * 35 + Math.floor(i / 9) * 35}ms`;
      return l.text
        ? `<li class="logo is-text" data-name="${esc(l.name)}" style="${delay}"><span>${esc(l.name)}</span></li>`
        : `<li class="logo" data-name="${esc(l.name)}" style="${delay}"><img src="${esc(l.src)}" alt="${esc(l.name)}" loading="lazy" decoding="async" style="width:${l.w}%"></li>`;
    }).join('');
    if (!('IntersectionObserver' in window)) {
      wall.classList.add('in');
      return;
    }
    new IntersectionObserver(([e], io) => {
      if (e.isIntersecting) {
        wall.classList.add('in');
        io.disconnect();
      }
    }, { threshold: 0.06 }).observe(wall);
  }

  /* ---------- 班級網站連結 ---------- */
  function initLinks() {
    const LINKS = [
      ['115 級成員', '自我介紹與名片', 'members-115.html', 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.4 4.2a3.5 3.5 0 0 1 0 6.6'],
      ['114 級學長姐', 'EMRD 與 SEMI-EMRD', 'members-114.html', 'M12 5 2.5 9.5 12 14l9.5-4.5L12 5zM6.5 11.5V16c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3v-4.5'],
      ['課程總表', '週課表與 16 週明細', 'courses.html', 'M4 5h16v15H4zM4 10h16M9 5v15'],
      ['行事曆', '學年度重要日程', 'calendar.html', 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM8 3.5V8M16 3.5V8M4 11h16'],
      ['校園地圖', '建築定位與教室', 'campus.html', 'M12 21s7-6.2 7-11.5A7 7 0 1 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
      ['歷屆論文', '105–114 學年度', 'thesis.html', 'M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5v-15zM19 18v3H7.5A1.5 1.5 0 0 1 6 19.5'],
      ['留言板', '班級即時留言', 'board.html', 'M4 5h16v11H9l-5 4V5z'],
      ['課程筆記', 'EMRD 115 Notes', 'https://sites.google.com/view/emrd115/%E9%A6%96%E9%A0%81', 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6']
    ];
    $('#linkGrid').innerHTML = LINKS.map((l, i) => `
      <a class="link-tile reveal" style="--d:${(i % 4) * 60}ms" href="${/^https?:/.test(l[2]) ? l[2] : CLASS_SITE + l[2]}" target="_blank" rel="noopener">
        <svg class="link-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${l[3]}"/></svg>
        <b>${esc(l[0])}</b><small>${esc(l[1])}</small>
        <svg class="link-out" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>
      </a>`).join('');
  }

  function init() {
    initNav();
    initLinks();
    initHero();
    initEntry();
    initFilm();
    initGallery();
    initLogos();
    initReveal();
    initCounts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
