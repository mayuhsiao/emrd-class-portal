/* =========================================================
 * EMRD Lucky Draw — 主程式（舞台流程、快捷鍵、紀錄、名單管理）
 * ========================================================= */
(function (LD) {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const L = LD.logic;
  const snd = LD.sound;
  const fx = LD.fx;
  const store = LD.store;
  const S = () => store.state;

  /* ---------- 執行狀態 ---------- */
  let phase = 'idle'; // idle 待機 | spinning 轉動中 | stopping 開獎中 | revealed 顯示結果
  let units = []; // 舞台上的每一組
  let reels = [];
  let stageSig = '';
  let pending = null; // 本輪結果
  let hiddenRound = null; // 開獎動畫結束前，紀錄面板先不劇透本輪
  let spinStartedAt = 0;
  let revealReadyAt = 0;
  let lastTriggerAt = 0;
  let currentTab = 'records';
  let musicPrimed = false;
  let wakeWanted = false;
  let wakeLock = null;
  let toastTimer = 0;
  let leaveTimer = 0;
  let finaleDue = false;
  let lastShape = '';
  let confirmDone = null;
  let zhVoice = null;
  let photosDirty = false; // 照片在抽獎進行中更新 → 回到待機再重畫
  let photoTarget = null; // 正在單獨上傳照片的人
  const modalStack = [];
  const photos = LD.photos;

  const SHAPES = ['EMRD', '2026', '🏆', '🧧', '🎉', '⭐', '🎁', '❤️'];
  const TRIGGER_KEYS = new Set([' ', 'Spacebar', 'Enter', 'PageDown', 'PageUp', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'MediaPlayPause']);

  /* ---------- 小工具 ---------- */
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const person = (id) => S().participants.find((p) => p.id === id) || null;
  const nameOf = (id, fallback) => (person(id) || {}).name || fallback || '#' + id;
  /** 紀錄裡的人（就算已從名單刪除，也能顯示頭像） */
  const pObj = (id, fallback) => person(id) || { id, name: nameOf(id, fallback) };
  const ava = (id, cls, fallback) => photos.avatar(pObj(id, fallback), cls);
  const itemOf = (id) => ({ id, name: nameOf(id) });
  const giftItemOf = (id) => ({ id, name: nameOf(id), gift: true });
  const maxRound = (recs) => recs.reduce((m, r) => Math.max(m, r.round), 0);
  function fmtTime(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDateTime(ts) { const d = new Date(ts); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${fmtTime(ts)}:${pad(d.getSeconds())}`; }
  function stamp() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; }
  function visibleRecords(mode) {
    const recs = S()[mode].records;
    if (!hiddenRound || hiddenRound.mode !== mode) return recs;
    return recs.filter((r) => r.round !== hiddenRound.no);
  }

  /* ---------- 候選池 ---------- */
  function drawersLeft() {
    const done = new Set(S().exchange.records.map((r) => r.drawerId));
    return S().participants.filter((p) => !done.has(p.id)).map((p) => p.id);
  }
  function giftsLeft() {
    const taken = new Set(S().exchange.records.map((r) => r.giftId));
    return S().participants.filter((p) => !taken.has(p.id)).map((p) => p.id);
  }
  function prizePool() {
    const won = new Set(S().prize.records.map((r) => r.id));
    return S().participants.filter((p) => !won.has(p.id)).map((p) => p.id);
  }
  function chainNext() {
    const recs = S().exchange.records;
    const R = maxRound(recs);
    if (!R) return [];
    const last = recs.filter((r) => r.round === R).map((r) => ({ drawer: r.drawerId, gift: r.giftId }));
    return L.chainCandidates(last, drawersLeft());
  }

  /** 下一輪要怎麼抽（或為什麼不能抽） */
  function plan() {
    const s = S();
    if (!s.participants.length) return { kind: 'empty-list' };
    if (s.mode === 'prize') {
      const pool = prizePool();
      if (!pool.length) return { kind: 'finished' };
      return { kind: 'prize', n: Math.min(s.count, pool.length), pool };
    }
    const D = drawersLeft();
    const G = giftsLeft();
    if (!D.length) return { kind: 'finished' };
    if (s.participants.length < 2) return { kind: 'too-few' };
    if (!G.length) return { kind: 'no-gift' };
    if (!G.some((g) => D.some((d) => L.canTake(d, g)))) return { kind: 'stuck' };
    const n = Math.min(s.count, D.length);
    const fixed = s.exchange.drawerMode === 'chain' ? chainNext().slice(0, n) : [];
    return { kind: 'exchange', n, fixed, D, G, feasible: L.isFeasible(D, G) };
  }
  function signature(p) {
    if (p.kind === 'prize') return 'prize|' + p.n;
    if (p.kind === 'exchange') {
      const parts = [];
      for (let i = 0; i < p.n; i++) parts.push(p.fixed[i] != null ? 'F' + p.fixed[i] : 'R');
      return 'ex|' + p.n + '|' + parts.join(',');
    }
    return p.kind + '|' + S().mode + '|' + Date.now();
  }

  /* =========================================================
   * 舞台
   * ========================================================= */
  function prepareStage(force) {
    const p = plan();
    if (force || signature(p) !== stageSig) buildStage(p);
    else refreshItems(p);
    updateUI();
  }

  function buildStage(p) {
    const stage = $('#stage');
    stage.innerHTML = '';
    reels = [];
    units = [];
    stageSig = signature(p);
    if (p.kind === 'prize') {
      const row = el('div', 'reel-row cols-' + p.n);
      for (let i = 0; i < p.n; i++) {
        const r = new LD.Reel({ kind: 'prize', caption: p.n > 1 ? `幸運得主 ${i + 1}` : '幸運得主', index: i, faceRatio: 2.55 });
        row.appendChild(r.el);
        reels.push(r);
        units.push({ reel: r });
      }
      stage.appendChild(row);
    } else if (p.kind === 'exchange') {
      const rows = el('div', 'pair-rows rows-' + p.n);
      const ratio = p.n > 1 ? 2.3 : 2.7;
      for (let j = 0; j < p.n; j++) {
        const fixedId = p.fixed[j] != null ? p.fixed[j] : null;
        const row = el('div', 'pair-row');
        const u = { fixedId, drawerReel: null, giftReel: null };
        if (fixedId != null) {
          row.appendChild(lockedCard(fixedId));
        } else {
          u.drawerReel = new LD.Reel({ kind: 'drawer', caption: '抽獎人', index: j * 2, faceRatio: ratio });
          row.appendChild(u.drawerReel.el);
          reels.push(u.drawerReel);
        }
        row.appendChild(connector(j, p.n));
        u.giftReel = new LD.Reel({ kind: 'gift', caption: '抽中誰的禮物', index: j * 2 + 1, faceRatio: ratio });
        row.appendChild(u.giftReel.el);
        reels.push(u.giftReel);
        units.push(u);
        rows.appendChild(row);
      }
      stage.appendChild(rows);
    } else {
      stage.appendChild(stageMessage(p));
    }
    reels.forEach((r) => { r.onTick = () => snd.tick(r.index); });
    refreshItems(p);
    LD.Reel.setActive(reels);
    requestAnimationFrame(layoutReels);
  }

  function refreshItems(p) {
    if (p.kind === 'prize') {
      const items = p.pool.map(itemOf);
      reels.forEach((r) => r.setItems(items));
    } else if (p.kind === 'exchange') {
      const fixed = p.fixed.filter((id) => id != null);
      const drawerItems = p.D.filter((id) => !fixed.includes(id)).map(itemOf);
      units.forEach((u) => {
        if (u.drawerReel) u.drawerReel.setItems(drawerItems);
        // 抽獎人 ID !== 禮物 ID：接力模式下，自己的禮物不會出現在自己的轉盤上
        u.giftReel.setItems(p.G.filter((id) => id !== u.fixedId).map(giftItemOf));
      });
    }
  }

  function layoutReels() { reels.forEach((r) => r.layout()); }

  function lockedCard(id) {
    return el('div', 'reel reel-locked',
      `<div class="reel-cap">🔗 接力抽獎人</div>
       <div class="reel-window">
         <div class="locked-body">
           <div class="locked-name">${photos.avatar(pObj(id), '', `<span class="no">${pad(id)}</span>`)}<span class="tx">${esc(nameOf(id))}</span></div>
           <div class="locked-tip">請上台抽禮物！</div>
         </div>
         <div class="reel-glass"></div>
       </div>`);
  }

  function connector(j, n) {
    return el('div', 'connector',
      `<div class="gift">🎁</div><div class="lbl">抽中</div><div class="chev"><b></b><b></b><b></b></div>` +
      (n > 1 ? `<div class="pairno">第 ${j + 1} 組</div>` : ''));
  }

  function stageMessage(p) {
    const s = S();
    let icon = '🎊', title = '', desc = '', acts = '';
    const peopleBtn = '<button type="button" class="btn primary big" data-act="people">👥 編輯名單</button>';
    if (p.kind === 'finished') {
      if (s.mode === 'exchange') {
        const a = L.auditExchange(s.exchange.records);
        title = '交換禮物全部完成！';
        desc = `共 ${s.exchange.records.length} 人完成交換 · ` +
          (a.ok ? '✅ 沒有人抽到自己的禮物，也沒有重複' : '⚠️ 紀錄有異常，請到「名單查核」確認');
      } else {
        title = '候選池已全部抽完！';
        desc = `共 ${s.prize.records.length} 人中獎，每人最多中一次`;
      }
      acts = '<button type="button" class="btn primary big" data-act="summary">📜 查看總表</button>' +
        '<button type="button" class="btn big" data-act="export">⬇ 匯出 CSV</button>';
    } else if (p.kind === 'empty-list') {
      icon = '📝'; title = '名單是空的'; desc = '請先新增參加的學員'; acts = peopleBtn;
    } else if (p.kind === 'too-few') {
      icon = '👥'; title = '交換禮物至少需要 2 位參加者'; desc = '請先到名單新增學員'; acts = peopleBtn;
    } else if (p.kind === 'no-gift') {
      icon = '⚠️'; title = '禮物已經抽完，但還有人沒抽到'; desc = '名單可能在抽獎途中被刪減，請到「名單查核」確認'; acts = peopleBtn;
    } else if (p.kind === 'stuck') {
      icon = '⚠️'; title = '剩下的禮物只有抽獎人自己的'; desc = '依規則不能抽到自己的禮物。請「撤銷上一輪」重抽，或調整名單。';
      acts = '<button type="button" class="btn primary big" data-act="undo">↶ 撤銷上一輪</button>' + peopleBtn;
    }
    return el('div', 'stage-msg', `<div class="big">${icon}</div><h2>${title}</h2><p>${desc}</p><div class="msg-actions">${acts}</div>`);
  }

  /* =========================================================
   * 抽獎流程：開始 → 停止 → 逐一停輪 → 開獎慶祝
   * ========================================================= */
  function trigger() {
    snd.unlock();
    primeMusic();
    if (modalStack.length) return;
    const now = performance.now();
    if (now - lastTriggerAt < 220) return; // 簡報筆連按防抖
    lastTriggerAt = now;
    if (phase === 'idle') startRound();
    else if (phase === 'spinning') { if (now - spinStartedAt >= 600) stopRound(); }
    else if (phase === 'revealed') { if (now >= revealReadyAt) closeCelebration(true); }
  }

  function canDraw(p) { return p.kind === 'prize' || p.kind === 'exchange'; }

  function startRound() {
    const p = plan();
    if (!canDraw(p)) {
      snd.error();
      toast(p.kind === 'finished' ? '🎊 已經全部抽完囉！可以到紀錄面板查核' : '⚠️ 目前無法抽獎，請先確認名單');
      return;
    }
    if (signature(p) !== stageSig) buildStage(p);
    else refreshItems(p);
    phase = 'spinning';
    spinStartedAt = performance.now();
    wakeWanted = true;
    keepAwake();
    document.body.classList.add('is-spinning', 'is-busy');
    reels.forEach((r, i) => r.start(i * 0.07));
    snd.whoosh();
    snd.rollStart(0.38);
    snd.duck(true);
    fx.setBoost(1);
    updateUI();
  }

  function stopRound() {
    const s = S();
    const p = plan();
    let round;
    const order = [];
    if (p.kind === 'prize') {
      const winners = L.drawWinners(p.pool, reels.length);
      round = { mode: 'prize', no: maxRound(s.prize.records) + 1, prize: (s.prize.prizeName || '').trim(), winners };
      winners.forEach((id, i) => order.push({ reel: reels[i], item: itemOf(id) }));
    } else if (p.kind === 'exchange') {
      const fixed = units.map((u) => u.fixedId).filter((id) => id != null);
      const res = L.drawExchange(p.D, p.G, units.length, fixed);
      if (!res.ok || res.pairs.length !== units.length) { abortRound(res.reason); return; }
      round = { mode: 'exchange', no: maxRound(s.exchange.records) + 1, pairs: res.pairs };
      res.pairs.forEach((pr, j) => {
        const u = units[j];
        if (u.drawerReel) order.push({ reel: u.drawerReel, item: itemOf(pr.drawer) });
        order.push({ reel: u.giftReel, item: giftItemOf(pr.gift) });
      });
    } else {
      abortRound('empty');
      return;
    }

    commitRound(round); // 結果一決定就先存檔（萬一中途重新整理也不會重抽）
    pending = round;
    hiddenRound = { mode: round.mode, no: round.no };
    phase = 'stopping';
    snd.rollTo(0.95);
    const GAP = 0.85, DEC = 1.9, LAST = 2.9;
    order.forEach((o, i) => {
      const last = i === order.length - 1;
      o.reel.stopAt(o.item, i * GAP, last ? LAST : DEC, (reel) => onLanded(reel, i, last));
    });
    updateUI();
  }

  function onLanded(reel, i, last) {
    snd.thunk(i);
    const c = reel.center();
    fx.burstAt(c.x, c.y, { power: last ? 1.35 : 1, count: last ? 70 : 42 });
    if (last) finishRound();
  }

  function finishRound() {
    const round = pending;
    phase = 'revealed';
    revealReadyAt = performance.now() + 1300;
    hiddenRound = null;
    document.body.classList.remove('is-spinning', 'is-busy');
    document.body.classList.add('is-revealed');
    snd.rollStop();
    snd.impact();
    snd.fanfare();
    setTimeout(() => snd.chimes(16), 650);
    fx.setBoost(0);
    flash();
    shake();
    fx.confettiCannons();
    fx.show(4.2);
    setTimeout(() => fx.shapeFirework(pickShape()), 900);
    setTimeout(() => { if (phase === 'revealed') showCelebration(round); }, 600);
    speakRound(round);
    renderPanel(round.no);
    if (plan().kind === 'finished') finaleDue = true;
    updateUI();
  }

  function abortRound(reason) {
    snd.rollStop();
    snd.error();
    snd.duck(false);
    fx.setBoost(0);
    phase = 'idle';
    document.body.classList.remove('is-spinning', 'is-busy');
    toast(reason === 'infeasible' ? '⚠️ 剩下的禮物只有抽獎人自己的，無法分配，請檢查名單' : '⚠️ 目前沒有可以抽的人');
    prepareStage(true);
  }

  function commitRound(round) {
    const s = S();
    const time = Date.now();
    if (round.mode === 'prize') {
      round.winners.forEach((id) => s.prize.records.push({ round: round.no, id, name: nameOf(id), prize: round.prize, time }));
    } else {
      round.pairs.forEach((p) => s.exchange.records.push({
        round: round.no, drawerId: p.drawer, drawerName: nameOf(p.drawer), giftId: p.gift, giftName: nameOf(p.gift), time
      }));
    }
    store.saveNow();
  }

  function pickShape() {
    let k;
    do { k = SHAPES[(Math.random() * SHAPES.length) | 0]; } while (k === lastShape);
    lastShape = k;
    return k;
  }

  /* ---------- 開獎慶祝畫面 ---------- */
  const charSpans = (name) => Array.from(name).map((ch, i) => `<i style="--i:${i}">${esc(ch)}</i>`).join('');

  function showCelebration(round) {
    clearTimeout(leaveTimer);
    const wrap = $('#celeWrap');
    wrap.classList.remove('leaving');
    const ex = round.mode === 'exchange';
    const n = ex ? round.pairs.length : round.winners.length;
    $('#celeTitle').textContent = ex ? '🎁 交換成功' : round.prize ? `🏆 ${round.prize}` : '🎉 恭喜中獎';
    $('#celeSub').textContent = ex ? `第 ${round.no} 輪 · 抽到誰的禮物就帶走！` : `第 ${round.no} 輪 · 恭喜幸運得主`;
    const list = $('#celeList');
    list.className = 'cele-list n' + n;
    list.innerHTML = ex
      ? round.pairs.map((p, i) => `
        <div class="cele-pair" style="--d:${(i * 0.35).toFixed(2)}s">
          <div class="side"><small>抽獎人 · No.${pad(p.drawer)}</small><div class="who-row">${ava(p.drawer, 'cele-ava')}<div class="cele-name">${charSpans(nameOf(p.drawer))}</div></div></div>
          <div class="arrow"><span>抽中</span><div class="chev"><b></b><b></b><b></b></div></div>
          <div class="side"><small>🎁 No.${pad(p.gift)}</small><div class="who-row">${ava(p.gift, 'cele-ava')}<div class="cele-name">${charSpans(nameOf(p.gift))}</div></div><em>的禮物</em></div>
        </div>`).join('')
      : round.winners.map((id, i) => `
        <div class="cele-item" style="--d:${(i * 0.3).toFixed(2)}s">
          ${photos.avatar(pObj(id), 'cele-ava', `<span class="no">${pad(id)}</span>`)}<div class="cele-name nm">${charSpans(nameOf(id))}</div>
        </div>`).join('');

    const p = plan();
    let next;
    if (p.kind === 'finished') next = ex ? '🎊 全部交換完成！沒有人抽到自己的禮物' : '🎊 候選池已全部抽完！';
    else if (ex && p.fixed && p.fixed.length) next = `🔗 下一位抽獎人：${p.fixed.map((id) => `<b>${esc(nameOf(id))}</b>`).join('、')}　請準備上台！`;
    else if (ex && p.D) next = `還有 <b>${p.D.length}</b> 人尚未抽禮物`;
    else if (p.pool) next = `候選池還有 <b>${p.pool.length}</b> 人`;
    else next = '';
    $('#celeNext').innerHTML = next;
    const more = canDraw(p);
    $('#celeNextBtn').hidden = !more;
    $('.cele-hint').innerHTML = more
      ? '按 <kbd>Space</kbd> / <kbd>Enter</kbd> 直接開始下一輪 · <kbd>Esc</kbd> 關閉'
      : '按 <kbd>Esc</kbd> 或點一下關閉';
    $('#celebrate').classList.add('show');
    wrap.classList.add('show');
  }

  function closeCelebration(startNext) {
    if (phase !== 'revealed') return;
    const wrap = $('#celeWrap');
    if (wrap.classList.contains('show')) {
      wrap.classList.add('leaving');
      leaveTimer = setTimeout(() => wrap.classList.remove('show', 'leaving'), 340);
    }
    $('#celebrate').classList.remove('show');
    document.body.classList.remove('is-revealed');
    phase = 'idle';
    pending = null;
    snd.duck(false);
    prepareStage(photosDirty);
    if (photosDirty) {
      photosDirty = false;
      renderPanel();
    }
    if (finaleDue) {
      finaleDue = false;
      fx.finale();
      snd.chimes(24);
      return;
    }
    if (startNext && canDraw(plan())) startRound();
    else updateUI();
  }

  /* ---------- 語音播報 ---------- */
  function pickVoice() {
    const vs = window.speechSynthesis.getVoices();
    zhVoice = vs.find((v) => /zh[-_]TW/i.test(v.lang)) || vs.find((v) => /zh[-_](HK|Hant)/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }
  function speak(text) {
    if (!S().settings.voice || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (zhVoice) { u.voice = zhVoice; u.lang = zhVoice.lang; } else u.lang = 'zh-TW';
      u.rate = 0.95;
      u.pitch = 1.05;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 不支援就算了 */ }
  }
  function speakRound(round) {
    if (!S().settings.voice) return;
    const text = round.mode === 'prize'
      ? `恭喜 ${round.winners.map((id) => nameOf(id)).join('、')}${round.prize ? '，獲得' + round.prize : '，中獎'}！`
      : round.pairs.map((p) => `${nameOf(p.drawer)}，抽中 ${nameOf(p.gift)} 的禮物`).join('。') + '！';
    setTimeout(() => speak(text), 2100);
  }

  /* =========================================================
   * 畫面更新
   * ========================================================= */
  function updateUI() {
    updateGo();
    updateStatus();
    updateRibbon();
  }

  function updateGo() {
    const p = plan();
    let label = '開始抽獎', key = 'SPACE · ENTER', cls = 'idle-pulse';
    if (phase === 'spinning') { label = '停！'; key = '再按一次 SPACE 停止'; cls = 'stop'; }
    else if (phase === 'stopping') { label = '開獎中…'; key = '屏息以待'; cls = 'busy'; }
    else if (phase === 'revealed') { label = canDraw(p) ? '下一輪' : '全部抽完 🎊'; cls = ''; }
    else if (p.kind === 'finished') { label = '全部抽完 🎊'; key = '可到紀錄面板查核'; cls = 'done'; }
    else if (!canDraw(p)) { label = '請先確認名單'; key = '點右上角「名單」'; cls = 'done'; }
    $('#btnGo').className = 'go ' + cls;
    $('#goLabel').textContent = label;
    $('#goKey').textContent = key;
  }

  function updateStatus() {
    const s = S();
    let html;
    if (phase === 'stopping') {
      html = '🥁 開獎中……';
    } else if (s.mode === 'exchange') {
      const D = drawersLeft().length, G = giftsLeft().length;
      html = `尚未抽獎 <b>${D}</b> 人 · 剩餘禮物 <b>${G}</b> 份` + (s.exchange.drawerMode === 'chain' ? ' · 🔗 接力模式' : '');
      if (D !== G) html += ' · <span class="warn">⚠️ 人數與禮物數不一致，請查核名單</span>';
    } else {
      html = `候選池 <b>${prizePool().length}</b> 人 · 已中獎 <b>${s.prize.records.length}</b> 人`;
    }
    $('#status').innerHTML = html;
  }

  function updateRibbon() {
    const s = S();
    const label = s.mode === 'exchange' ? '🎁 交換禮物' : `🏆 ${esc(s.prize.prizeName.trim() || '抽禮物')}`;
    const done = plan().kind === 'finished' && phase === 'idle';
    $('#stageRibbon').innerHTML = done ? `${label} · 全部完成` : `${label} · 第 <b>${maxRound(visibleRecords(s.mode)) + 1}</b> 輪`;
  }

  function syncControls() {
    const s = S();
    document.body.dataset.mode = s.mode;
    $$('.mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
    $$('.count-seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.count) === s.count));
    $$('.drawer-seg button').forEach((b) => b.classList.toggle('on', b.dataset.drawer === s.exchange.drawerMode));
    const pz = $('#prizeName');
    if (document.activeElement !== pz) pz.value = s.prize.prizeName;
    const t = $('#eventTitle');
    if (t.contentEditable !== 'true') t.textContent = s.title;
    document.title = s.title + '｜幸運大抽獎';
  }

  function applySettings() {
    const st = S().settings;
    const sb = $('#btnSound');
    sb.querySelector('span').textContent = st.sound ? '🔊' : '🔇';
    sb.classList.toggle('off', !st.sound);
    $('#btnBgm').classList.toggle('off', !st.bgm);
    $('#btnVoice').classList.toggle('off', !st.voice);
    $('#btnPanel').classList.toggle('off', !st.panel);
    document.body.classList.toggle('panel-hidden', !st.panel);
    snd.setEnabled(st.sound);
  }

  /* ---------- 紀錄面板 ---------- */
  function renderPanel(newRound) {
    const s = S();
    const mode = s.mode;
    const recs = visibleRecords(mode);
    let a, b, aL, bL;
    if (mode === 'exchange') {
      const drawn = new Set(recs.map((r) => r.drawerId));
      a = recs.length; aL = '已抽';
      b = s.participants.filter((p) => !drawn.has(p.id)).length; bL = '未抽';
    } else {
      const won = new Set(recs.map((r) => r.id));
      a = recs.length; aL = '已中獎';
      b = s.participants.filter((p) => !won.has(p.id)).length; bL = '候選';
    }
    setStat('#statA', a, newRound);
    setStat('#statB', b, newRound);
    setStat('#statC', maxRound(recs), newRound);
    $('#statALabel').textContent = aL;
    $('#statBLabel').textContent = bL;
    renderRecords(mode, recs, newRound);
    renderCheck();
  }

  function setStat(sel, v, bump) {
    const e = $(sel);
    if (e.textContent === String(v)) return;
    e.textContent = v;
    if (bump) {
      e.classList.remove('bump');
      void e.offsetWidth;
      e.classList.add('bump');
    }
  }

  function renderRecords(mode, recs, newRound) {
    const groups = new Map();
    recs.forEach((r) => {
      if (!groups.has(r.round)) groups.set(r.round, []);
      groups.get(r.round).push(r);
    });
    const order = Array.from(groups.keys()).sort((x, y) => y - x);
    const list = $('#recordList');
    if (!order.length) {
      list.innerHTML = '<li class="empty">還沒有紀錄<br><small>按 <kbd>Space</kbd> 開始第一輪！</small></li>';
      return;
    }
    list.innerHTML = order.map((R) => {
      const rows = groups.get(R);
      const head = `<div class="rec-head"><span class="rd">R${R}</span><span>${fmtTime(rows[0].time)}</span>` +
        (mode === 'prize' && rows[0].prize ? `<span class="pz">🏆 ${esc(rows[0].prize)}</span>` : '') + '</div>';
      const lines = rows.map((r) => mode === 'exchange'
        ? `<div class="rec-line"><span class="who">${ava(r.drawerId, 'xs', r.drawerName)}<em class="no">${pad(r.drawerId)}</em><span class="nmx">${esc(nameOf(r.drawerId, r.drawerName))}</span></span><i class="arrow">➜</i><span class="gift">${ava(r.giftId, 'xs', r.giftName)}<span class="nmx">🎁 ${esc(nameOf(r.giftId, r.giftName))}</span></span></div>`
        : `<div class="rec-line${r.void ? ' void' : ''}"><span class="who">${ava(r.id, 'xs', r.name)}<em class="no">${pad(r.id)}</em><span class="nmx">${esc(nameOf(r.id, r.name))}</span></span>` +
          (r.void ? '<span class="tag">未到</span>' : '') +
          `<button type="button" class="mini" data-void="${r.round}:${r.id}" title="得主不在現場：標記作廢（不放回候選池），可再抽一位補上">${r.void ? '復原' : '未到'}</button></div>`
      ).join('');
      return `<li class="rec${R === newRound ? ' new' : ''}">${head}${lines}</li>`;
    }).join('');
    if (newRound) $('.panel-body').scrollTop = 0;
  }

  function chips(list, icon) {
    if (!list.length) return '<span class="none">（無）</span>';
    return list.map((p) => `<span class="chip">${photos.avatar(p, 'tiny')}<i>${pad(p.id)}</i>${icon || ''}${esc(p.name)}</span>`).join('');
  }

  function renderCheck() {
    const s = S();
    const box = $('#checkView');
    if (s.mode === 'exchange') {
      const recs = visibleRecords('exchange');
      const a = L.auditExchange(recs);
      const drawn = new Set(recs.map((r) => r.drawerId));
      const taken = new Set(recs.map((r) => r.giftId));
      const notDrawn = s.participants.filter((p) => !drawn.has(p.id));
      const notTaken = s.participants.filter((p) => !taken.has(p.id));
      const allDone = !notDrawn.length && !notTaken.length;
      box.innerHTML = `
        <div class="audit ${a.ok && notDrawn.length === notTaken.length ? '' : 'bad'}">
          <div>${a.selfDraw.length ? '❌' : '✅'} 沒有人抽到自己的禮物</div>
          <div>${a.dupDrawer.length ? '❌' : '✅'} 每人只抽一次（無重複抽獎人）</div>
          <div>${a.dupGift.length ? '❌' : '✅'} 每份禮物只被抽走一次</div>
          <div>${notDrawn.length === notTaken.length ? '✅' : '⚠️'} 未抽 ${notDrawn.length} 人 ＝ 剩餘禮物 ${notTaken.length} 份</div>
          <div>${allDone ? '🎊 全部完成' : `📊 進度 ${recs.length} / ${s.participants.length}`}</div>
        </div>
        <h4>尚未抽獎（${notDrawn.length}）</h4><div class="chips">${chips(notDrawn)}</div>
        <h4>禮物尚未被抽走（${notTaken.length}）</h4><div class="chips">${chips(notTaken, '🎁 ')}</div>`;
    } else {
      const recs = visibleRecords('prize');
      const a = L.auditPrize(recs);
      const won = new Set(recs.map((r) => r.id));
      const pool = s.participants.filter((p) => !won.has(p.id));
      const voided = recs.filter((r) => r.void);
      box.innerHTML = `
        <div class="audit ${a.ok ? '' : 'bad'}">
          <div>${a.ok ? '✅' : '❌'} 沒有人重複中獎</div>
          <div>🏆 已抽出 ${recs.length} 人${voided.length ? `（其中 ${voided.length} 人未到）` : ''}</div>
          <div>👥 候選池剩 ${pool.length} 人</div>
        </div>
        <h4>候選池（${pool.length}）</h4><div class="chips">${chips(pool)}</div>`;
    }
  }

  /* ---------- 模式 / 人數 / 抽獎人方式 ---------- */
  function idleOnly() {
    if (phase === 'revealed') closeCelebration(false);
    return phase === 'idle';
  }
  function setMode(m) {
    if (!idleOnly() || S().mode === m) return;
    S().mode = m;
    store.save();
    snd.blip(true);
    syncControls();
    prepareStage(true);
    renderPanel();
  }
  function setCount(n) {
    if (!idleOnly() || S().count === n) return;
    S().count = n;
    store.save();
    snd.blip(n === 2);
    syncControls();
    prepareStage();
    toast(`一次抽 ${n} 人`);
  }
  function setDrawerMode(m) {
    if (!idleOnly() || S().exchange.drawerMode === m) return;
    S().exchange.drawerMode = m;
    store.save();
    snd.blip(true);
    syncControls();
    prepareStage();
    toast(m === 'chain' ? '🔗 接力：禮物被抽走的人，下一輪接著上台抽' : '🎲 隨機：每輪由轉盤抽出抽獎人');
  }

  /* ---------- 撤銷 / 重置 / 未到 ---------- */
  async function undoLast() {
    if (!idleOnly()) return;
    const s = S();
    const mode = s.mode;
    const recs = s[mode].records;
    const R = maxRound(recs);
    if (!R) { toast('目前沒有紀錄可以撤銷'); return; }
    const rows = recs.filter((r) => r.round === R);
    const desc = rows.map((r) => mode === 'exchange'
      ? `${nameOf(r.drawerId, r.drawerName)} ➜ ${nameOf(r.giftId, r.giftName)} 的禮物`
      : nameOf(r.id, r.name)).join('\n');
    const ok = await confirmDlg({ title: `撤銷第 ${R} 輪？`, message: `${desc}\n\n撤銷後，這些人會回到候選池。`, ok: '撤銷', danger: true });
    if (!ok) return;
    s[mode].records = recs.filter((r) => r.round !== R);
    store.saveNow();
    prepareStage(true);
    renderPanel();
    toast(`已撤銷第 ${R} 輪`);
  }

  async function resetMode() {
    if (!idleOnly()) return;
    const s = S();
    const mode = s.mode;
    const label = mode === 'exchange' ? '交換禮物' : '抽禮物';
    const count = s[mode].records.length;
    if (!count) { toast('目前沒有紀錄'); return; }
    const ok = await confirmDlg({
      title: `重置「${label}」？`,
      message: `將清除 ${count} 筆紀錄，所有人回到候選池。\n重置後 10 秒內可以按「復原」。`,
      ok: '確定重置', danger: true
    });
    if (!ok) return;
    store.backup();
    const saved = JSON.stringify(s[mode].records);
    s[mode].records = [];
    store.saveNow();
    prepareStage(true);
    renderPanel();
    toast(`已重置「${label}」`, {
      label: '復原',
      fn: () => {
        S()[mode].records = JSON.parse(saved);
        store.saveNow();
        prepareStage(true);
        renderPanel();
        toast('已復原紀錄');
      }
    });
  }

  function toggleVoid(key) {
    const parts = key.split(':').map(Number);
    const r = S().prize.records.find((x) => x.round === parts[0] && x.id === parts[1]);
    if (!r) return;
    r.void = !r.void;
    store.saveNow();
    renderPanel();
    toast(r.void ? `已標記「${nameOf(r.id, r.name)}」未到（不放回候選池），可以再抽一位補上` : '已取消未到標記');
  }

  /* ---------- 匯出 / 總表 ---------- */
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // 避免被 Excel 當成公式
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function exportCSV() {
    const s = S();
    const mode = s.mode;
    const recs = visibleRecords(mode).slice().sort((x, y) => x.round - y.round || x.time - y.time);
    if (!recs.length) { toast('目前沒有紀錄可以匯出'); return; }
    const rows = mode === 'exchange'
      ? [['輪次', '時間', '抽獎人編號', '抽獎人', '禮物編號', '抽到誰的禮物']].concat(recs.map((r) =>
        [r.round, fmtDateTime(r.time), r.drawerId, nameOf(r.drawerId, r.drawerName), r.giftId, nameOf(r.giftId, r.giftName)]))
      : [['輪次', '時間', '獎項', '編號', '姓名', '備註']].concat(recs.map((r) =>
        [r.round, fmtDateTime(r.time), r.prize || '', r.id, nameOf(r.id, r.name), r.void ? '未到（作廢）' : '']));
    const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `EMRD_${mode === 'exchange' ? '交換禮物' : '抽禮物'}_${stamp()}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('已下載 CSV（可直接用 Excel 開啟）');
  }

  function openSummary() {
    if (!idleOnly()) return;
    const s = S();
    const mode = s.mode;
    const recs = visibleRecords(mode).slice().sort((x, y) => x.round - y.round || x.time - y.time);
    $('#summaryTitle').textContent = mode === 'exchange' ? `📜 交換禮物總表（${recs.length} / ${s.participants.length}）` : `📜 抽禮物得獎總表（${recs.length} 人）`;
    $('#summaryBody').innerHTML = recs.length
      ? '<ol class="sum-grid">' + recs.map((r) => mode === 'exchange'
        ? `<li><span class="rd">R${r.round}</span>${ava(r.drawerId, 'sum', r.drawerName)}<b>${esc(nameOf(r.drawerId, r.drawerName))}</b><i>➜</i>${ava(r.giftId, 'sum', r.giftName)}<span class="gift">🎁 ${esc(nameOf(r.giftId, r.giftName))}</span></li>`
        : `<li class="${r.void ? 'void' : ''}"><span class="rd">R${r.round}</span>${r.prize ? `<em>${esc(r.prize)}</em>` : ''}${ava(r.id, 'sum', r.name)}<b>${esc(nameOf(r.id, r.name))}</b>${r.void ? '<small>未到</small>' : ''}</li>`
      ).join('') + '</ol>'
      : '<p class="sum-empty">尚無紀錄</p>';
    showModal($('#summaryModal'));
  }

  /* =========================================================
   * 名單管理
   * ========================================================= */
  function openPeople() {
    if (!idleOnly()) return;
    $('#peopleSearch').value = '';
    renderPeople();
    showModal($('#peopleModal'));
    setTimeout(() => $('#addNames').focus(), 80);
  }

  function renderPeople(freshIds) {
    const s = S();
    const q = $('#peopleSearch').value.trim().toLowerCase();
    const drawn = new Set(s.exchange.records.map((r) => r.drawerId));
    const taken = new Set(s.exchange.records.map((r) => r.giftId));
    const won = new Set(s.prize.records.map((r) => r.id));
    $('#peopleCount').textContent = `共 ${s.participants.length} 人`;
    const qNum = /^\d+$/.test(q) ? Number(q) : null;
    const list = s.participants.filter((p) => !q || p.name.toLowerCase().includes(q) || p.id === qNum);
    const n = photos.count();
    const withPhoto = s.participants.filter((p) => photos.url(p)).length;
    $('#photoCount').textContent = `有照片 ${withPhoto} / ${s.participants.length} 人` + (n ? `（匯入 ${n} 張）` : '');
    $('#btnClearPhotos').hidden = !n;
    $('#peopleList').innerHTML = list.length
      ? list.map((p) => `<li data-id="${p.id}"${freshIds && freshIds.includes(p.id) ? ' class="fresh"' : ''}>
          <span class="ava-wrap">
            <button type="button" class="ava-btn" title="${photos.source(p) === 'folder' ? '照片來自 photos 資料夾；點一下可改用上傳的照片' : '點一下上傳 / 更換照片'}">${photos.avatar(p, 'roster')}<i class="cam">📷</i></button>
            ${photos.source(p) === 'upload' ? '<button type="button" class="ava-del" title="移除這張照片">×</button>' : ''}
          </span>
          <span class="pid">${pad(p.id)}</span>
          <input class="pname" value="${esc(p.name)}" maxlength="20" spellcheck="false" aria-label="姓名">
          <span class="flags">${drawn.has(p.id) ? '<i title="已抽禮物">🎁</i>' : ''}${taken.has(p.id) ? '<i title="禮物已被抽走">📦</i>' : ''}${won.has(p.id) ? '<i title="已中獎">🏆</i>' : ''}</span>
          <button type="button" class="del" title="刪除">✕</button>
        </li>`).join('')
      : `<li class="empty">${q ? '找不到符合的名字' : '名單是空的，請在上方輸入姓名新增'}</li>`;
  }

  function afterRosterChange() {
    prepareStage(true);
    renderPanel();
  }

  function addNames() {
    const ta = $('#addNames');
    const names = ta.value.split(/[\n\r,，、;；\t]+/).map((x) => x.trim().slice(0, 20)).filter(Boolean);
    if (!names.length) { ta.focus(); return; }
    const s = S();
    const existing = new Set(s.participants.map((p) => p.name));
    const added = [];
    const skipped = [];
    names.forEach((nm) => {
      if (existing.has(nm)) { skipped.push(nm); return; }
      existing.add(nm);
      const id = s.nextId++;
      s.participants.push({ id, name: nm });
      added.push(id);
    });
    store.saveNow();
    ta.value = '';
    $('#peopleSearch').value = '';
    renderPeople(added);
    afterRosterChange();
    photos.probe(added.map((id) => nameOf(id)));
    let msg = added.length ? `已新增 ${added.length} 位` : '沒有新增任何人';
    if (skipped.length) msg += `（略過重複：${skipped.slice(0, 5).join('、')}${skipped.length > 5 ? '…' : ''}）`;
    toast(msg);
    if (added.length) {
      snd.blip(true);
      const li = $(`#peopleList li[data-id="${added[added.length - 1]}"]`);
      if (li) li.scrollIntoView({ block: 'nearest' });
    }
  }

  function renamePerson(input) {
    const id = Number(input.closest('li').dataset.id);
    const p = person(id);
    if (!p) return;
    const v = input.value.trim().slice(0, 20);
    if (!v) { input.value = p.name; return; }
    if (v === p.name) return;
    p.name = v;
    store.saveNow();
    photos.rename(p);
    afterRosterChange();
    photos.probe([v]);
    toast(`已改名為「${v}」`);
  }

  async function deletePerson(btn) {
    const li = btn.closest('li');
    const id = Number(li.dataset.id);
    const p = person(id);
    if (!p) return;
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = '刪除?';
      setTimeout(() => {
        if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = '✕'; }
      }, 2600);
      return;
    }
    const s = S();
    const involved = s.exchange.records.some((r) => r.drawerId === id || r.giftId === id);
    if (involved) {
      const ok = await confirmDlg({
        title: `刪除「${p.name}」？`,
        message: '此人已經參與交換禮物。\n刪除後，他「還沒被抽走的禮物」會從禮物池移除；已抽出的紀錄會保留。',
        ok: '確定刪除', danger: true
      });
      if (!ok) return;
    }
    s.participants = s.participants.filter((x) => x.id !== id);
    store.saveNow();
    photos.remove(id);
    renderPeople();
    afterRosterChange();
    toast(`已刪除「${p.name}」`);
  }

  async function restoreDefault() {
    const s = S();
    const hasRecords = s.exchange.records.length > 0 || s.prize.records.length > 0;
    const ok = await confirmDlg({
      title: '恢復預設名單？',
      message: `名單會換回預設的 ${LD.DEFAULT_NAMES.length} 位學員。` +
        (hasRecords ? '\n\n⚠️ 目前已有抽獎紀錄，為避免編號錯亂，會一併清空「交換禮物」與「抽禮物」的所有紀錄。' : ''),
      ok: '恢復預設', danger: hasRecords
    });
    if (!ok) return;
    store.backup();
    s.participants = store.defaultParticipants();
    s.nextId = LD.DEFAULT_NAMES.length + 1;
    if (hasRecords) {
      s.exchange.records = [];
      s.prize.records = [];
    }
    store.saveNow();
    photos.prune(s.participants);
    renderPeople();
    afterRosterChange();
    photos.probe(s.participants.map((p) => p.name));
    toast('已恢復預設名單');
  }

  /* ---------- 照片 ---------- */
  function afterPhotoChange() {
    photos.preloadAll(S().participants);
    if (modalStack.includes($('#peopleModal'))) renderPeople();
    if (phase === 'idle') afterRosterChange();
    else photosDirty = true;
  }

  async function uploadOne(file) {
    const p = photoTarget && person(photoTarget);
    photoTarget = null;
    if (!file || !p) return;
    try {
      const data = await photos.fileToDataURL(file);
      if (!photos.set(p, data)) { toast('⚠️ 瀏覽器儲存空間不足，照片沒有存起來'); return; }
      afterPhotoChange();
      toast(`已更新「${p.name}」的照片`);
    } catch (e) {
      toast('⚠️ 無法讀取這張圖片（iPhone 的 HEIC 請先轉成 JPG）');
    }
  }

  /** 一次匯入多張：依檔名對應到人 */
  async function importPhotos(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const s = S();
    const missed = [];
    const failed = [];
    let ok = 0;
    toast(`照片處理中…（共 ${files.length} 張）`);
    for (const f of files) {
      const p = photos.matchFile(f.name, s.participants);
      if (!p) { missed.push(f.name); continue; }
      try {
        photos.set(p, await photos.fileToDataURL(f), true);
        ok++;
      } catch (e) {
        failed.push(f.name);
      }
    }
    const saved = photos.save();
    afterPhotoChange();
    let msg = `📷 已匯入 ${ok} 張照片`;
    if (missed.length) msg += `；找不到對應的人：${missed.slice(0, 4).join('、')}${missed.length > 4 ? ` 等 ${missed.length} 張` : ''}`;
    if (failed.length) msg += `；無法讀取：${failed.slice(0, 3).join('、')}（HEIC 請先轉成 JPG）`;
    toast(saved ? msg : '⚠️ 瀏覽器儲存空間不足，部分照片沒有存起來。' + msg);
  }

  async function clearPhotos() {
    const n = photos.count();
    if (!n) return;
    const ok = await confirmDlg({
      title: '清除匯入的照片？',
      message: `將移除在畫面上匯入的 ${n} 張照片（photos 資料夾裡的照片不受影響）。`,
      ok: '清除', danger: true
    });
    if (!ok) return;
    photos.clearUploads();
    afterPhotoChange();
    toast('已清除匯入的照片');
  }

  async function clearPeople() {
    const s = S();
    if (!s.participants.length) return;
    const ok = await confirmDlg({
      title: '清空整份名單？',
      message: `將刪除全部 ${s.participants.length} 位參加者（抽獎紀錄會保留）。\n之後可以用「恢復預設名單」找回預設學員。`,
      ok: '全部清空', danger: true
    });
    if (!ok) return;
    store.backup();
    s.participants = [];
    store.saveNow();
    renderPeople();
    afterRosterChange();
    toast('名單已清空');
  }

  /* =========================================================
   * 對話框 / 提示
   * ========================================================= */
  function showModal(m) {
    if (!m.classList.contains('open')) {
      m.classList.add('open');
      modalStack.push(m);
    }
  }
  function hideModal(m) {
    m.classList.remove('open');
    const i = modalStack.indexOf(m);
    if (i >= 0) modalStack.splice(i, 1);
    if (m.id === 'confirmModal' && confirmDone) confirmDone(false);
    if (m.id === 'peopleModal') prepareStage();
  }
  function confirmDlg(o) {
    return new Promise((resolve) => {
      $('#confirmTitle').textContent = o.title;
      $('#confirmMsg').textContent = o.message || '';
      const okBtn = $('#confirmOk');
      okBtn.textContent = o.ok || '確定';
      okBtn.className = 'btn ' + (o.danger ? 'danger-solid' : 'primary');
      const modal = $('#confirmModal');
      confirmDone = (v) => {
        confirmDone = null;
        hideModal(modal);
        resolve(v);
      };
      showModal(modal);
      setTimeout(() => (o.danger ? $('#confirmCancel') : okBtn).focus(), 60);
    });
  }

  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
    if (action) {
      t.querySelector('button').onclick = () => {
        t.classList.remove('show');
        action.fn();
      };
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 10000 : 2800);
  }
  LD.ui = { toast };

  function flash() {
    const f = $('#flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }
  function shake() {
    const a = $('#app');
    a.classList.remove('shake');
    void a.offsetWidth;
    a.classList.add('shake');
  }

  /* =========================================================
   * 裝飾：派對燈串、舞台跑馬燈
   * ========================================================= */
  function buildGarland() {
    const host = $('#garland');
    const W = host.clientWidth || window.innerWidth;
    const H = host.clientHeight || 30;
    const sags = Math.max(3, Math.round(W / 360));
    const seg = W / sags;
    const top = 2;
    const low = H - 10;
    const cy = low * 2 - top;
    const colors = ['#ffd36b', '#fff2c4', '#ff4d5e', '#ffb347', '#ffe08a', '#ff8a96'];
    let d = `M0,${top}`;
    let bulbs = '';
    let n = 0;
    for (let i = 0; i < sags; i++) {
      const x0 = i * seg, x1 = x0 + seg, cx = x0 + seg / 2;
      d += ` Q${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${top}`;
      const k = Math.max(3, Math.round(seg / 48));
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k, mt = 1 - t;
        const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
        const y = mt * mt * top + 2 * mt * t * cy + t * t * top;
        const c = colors[n % colors.length];
        bulbs += `<i style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;--c:${c};--d:${(-Math.random() * 2).toFixed(2)}s;--t:${(1.4 + Math.random() * 1.2).toFixed(2)}s"></i>`;
        n++;
      }
    }
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path class="wire" d="${d}"/></svg>${bulbs}`;
  }

  function buildMarquee() {
    const frame = $('#stageFrame');
    const m = $('#marquee');
    const w = frame.clientWidth, h = frame.clientHeight;
    if (!w || !h) return;
    const inset = 11, gap = 34;
    const W2 = w - inset * 2, H2 = h - inset * 2;
    const per = 2 * (W2 + H2);
    const n = Math.max(20, Math.round(per / gap));
    const colors = ['#ffd36b', '#ff4d5e', '#ffd36b', '#fff2c4'];
    let html = '';
    for (let i = 0; i < n; i++) {
      let dd = (i / n) * per, x, y;
      if (dd < W2) { x = inset + dd; y = inset; }
      else if ((dd -= W2) < H2) { x = w - inset; y = inset + dd; }
      else if ((dd -= H2) < W2) { x = w - inset - dd; y = h - inset; }
      else { dd -= W2; x = inset; y = h - inset - dd; }
      html += `<i style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;--i:${i};--c:${colors[i % colors.length]}"></i>`;
    }
    m.innerHTML = html;
  }

  let layoutRaf = 0;
  function scheduleLayout() {
    cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(() => {
      layoutReels();
      buildMarquee();
    });
  }

  /* =========================================================
   * 其他：全螢幕、不休眠、背景音樂、標題編輯
   * ========================================================= */
  function toggleFullscreen() {
    const d = document;
    const root = d.documentElement;
    try {
      if (!(d.fullscreenElement || d.webkitFullscreenElement)) {
        const r = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
        if (r && r.catch) r.catch(() => {});
      } else {
        (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      }
    } catch (e) { toast('此瀏覽器不支援全螢幕，請按 F11'); }
  }

  function keepAwake() {
    if (wakeLock || !('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then((l) => {
      wakeLock = l;
      l.addEventListener('release', () => { wakeLock = null; });
    }).catch(() => {});
  }

  function primeMusic() {
    if (musicPrimed) return;
    musicPrimed = true;
    if (S().settings.bgm) snd.setMusic(true);
  }

  function beginTitleEdit() {
    if (phase !== 'idle') return;
    const t = $('#eventTitle');
    t.contentEditable = 'true';
    t.classList.add('editing');
    t.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(t);
  }
  function endTitleEdit(save) {
    const t = $('#eventTitle');
    if (t.contentEditable !== 'true') return;
    t.contentEditable = 'false';
    t.classList.remove('editing');
    if (save) {
      const v = t.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
      S().title = v || LD.DEFAULT_TITLE;
      store.save();
    }
    syncControls();
  }

  /* =========================================================
   * 事件
   * ========================================================= */
  const isEditable = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  function onEscape(e) {
    if (document.activeElement && document.activeElement.id === 'eventTitle') return;
    if (modalStack.length) {
      e.preventDefault();
      const top = modalStack[modalStack.length - 1];
      if (top.id === 'confirmModal' && confirmDone) confirmDone(false);
      else hideModal(top);
      return;
    }
    if (phase === 'revealed') closeCelebration(false);
  }

  function bindEvents() {
    // ---- 鍵盤（含簡報筆：PageDown / PageUp / 方向鍵） ----
    document.addEventListener('keydown', (e) => {
      snd.unlock();
      primeMusic();
      if (e.isComposing || e.keyCode === 229) return; // 中文輸入法選字中
      if (e.key === 'Escape') { onEscape(e); return; }
      if (isEditable(e.target)) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.blur(); }
        return;
      }
      if (modalStack.length) return; // 對話框開著：讓按鈕照常運作
      if (TRIGGER_KEYS.has(e.key) || e.code === 'Space' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (!e.repeat) trigger();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case '1': setCount(1); break;
        case '2': setCount(2); break;
        case 'm': $('#btnSound').click(); break;
        case 'b': $('#btnBgm').click(); break;
        case 'f': toggleFullscreen(); break;
        case 'p': $('#btnPanel').click(); break;
        default: break;
      }
    }, true);
    document.addEventListener('keyup', (e) => {
      if ((e.key === ' ' || e.code === 'Space') && !isEditable(e.target) && !modalStack.length) e.preventDefault();
    }, true);
    document.addEventListener('pointerdown', () => { snd.unlock(); primeMusic(); }, true);
    // 滑鼠點完按鈕就移開焦點，避免之後按空白鍵重複觸發
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && !b.closest('.modal')) b.blur();
    });

    // ---- 主要按鈕 ----
    $('#btnGo').addEventListener('click', trigger);
    $('.mode-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
    $('.count-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setCount(Number(b.dataset.count)); });
    $('.drawer-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setDrawerMode(b.dataset.drawer); });
    $('#prizeName').addEventListener('input', (e) => {
      S().prize.prizeName = e.target.value;
      store.save();
      updateRibbon();
    });

    // ---- 工具列 ----
    $('#btnPeople').addEventListener('click', openPeople);
    $('#btnSound').addEventListener('click', () => {
      const st = S().settings;
      st.sound = !st.sound;
      store.save();
      applySettings();
      if (st.sound) snd.blip(true);
      toast(st.sound ? '🔊 音效已開啟' : '🔇 音效已關閉');
    });
    $('#btnBgm').addEventListener('click', () => {
      const st = S().settings;
      st.bgm = !st.bgm;
      store.save();
      applySettings();
      snd.setMusic(st.bgm);
      toast(st.bgm ? (st.sound ? '🎵 背景音樂已開啟' : '🎵 背景音樂已開啟（目前音效為靜音）') : '🎵 背景音樂已關閉');
    });
    $('#btnVoice').addEventListener('click', () => {
      const st = S().settings;
      st.voice = !st.voice;
      store.save();
      applySettings();
      if (st.voice) {
        toast(zhVoice ? `🗣️ 語音播報已開啟（${zhVoice.name}）` : '🗣️ 語音播報已開啟（此電腦可能沒有中文語音）');
        speak('語音播報已開啟');
      } else {
        toast('🗣️ 語音播報已關閉');
      }
    });
    $('#btnPanel').addEventListener('click', () => {
      if (window.matchMedia('(max-width: 1100px)').matches) {
        document.body.classList.toggle('drawer-open'); // 窄螢幕：抽屜式面板
        return;
      }
      const st = S().settings;
      st.panel = !st.panel;
      store.save();
      applySettings();
    });
    $('#btnFull').addEventListener('click', toggleFullscreen);

    // ---- 紀錄面板 ----
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      currentTab = t.dataset.tab;
      $$('.tab').forEach((x) => x.classList.toggle('on', x === t));
      $('#recordList').hidden = currentTab !== 'records';
      $('#checkView').hidden = currentTab !== 'check';
    }));
    $('#btnUndo').addEventListener('click', undoLast);
    $('#btnSummary').addEventListener('click', openSummary);
    $('#btnExport').addEventListener('click', exportCSV);
    $('#btnReset').addEventListener('click', resetMode);
    $('#recordList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-void]');
      if (b && phase === 'idle') toggleVoid(b.dataset.void);
    });

    // ---- 舞台訊息上的按鈕 ----
    $('#stage').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'summary') openSummary();
      else if (act === 'export') exportCSV();
      else if (act === 'people') openPeople();
      else if (act === 'undo') undoLast();
    });

    // ---- 開獎畫面 ----
    $('#celeClose').addEventListener('click', () => closeCelebration(false));
    $('#celeNextBtn').addEventListener('click', () => closeCelebration(true));
    $('#celebrate').addEventListener('click', () => {
      if (performance.now() >= revealReadyAt) closeCelebration(false);
    });

    // ---- 名單 ----
    $('#btnAddNames').addEventListener('click', addNames);
    $('#addNames').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        addNames();
      }
    });
    $('#peopleSearch').addEventListener('input', () => renderPeople());
    $('#peopleList').addEventListener('change', (e) => { if (e.target.classList.contains('pname')) renamePerson(e.target); });
    $('#peopleList').addEventListener('click', (e) => {
      const avaBtn = e.target.closest('.ava-btn');
      if (avaBtn) {
        photoTarget = Number(avaBtn.closest('li').dataset.id);
        $('#photoPick').click();
        return;
      }
      const delPhoto = e.target.closest('.ava-del');
      if (delPhoto) {
        photos.remove(Number(delPhoto.closest('li').dataset.id));
        afterPhotoChange();
        toast('已移除照片');
        return;
      }
      const b = e.target.closest('.del');
      if (b) deletePerson(b);
    });
    $('#photoPick').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      uploadOne(f);
    });
    $('#btnImportPhotos').addEventListener('click', () => $('#photoBulk').click());
    $('#photoBulk').addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      importPhotos(files);
    });
    $('#btnClearPhotos').addEventListener('click', clearPhotos);
    $('#btnRestoreDefault').addEventListener('click', restoreDefault);
    $('#btnClearPeople').addEventListener('click', clearPeople);

    // ---- 對話框共用 ----
    $$('.modal').forEach((m) => {
      m.addEventListener('click', (e) => {
        if (e.target === m || e.target.closest('[data-close]')) hideModal(m);
      });
    });
    $('#confirmOk').addEventListener('click', () => confirmDone && confirmDone(true));
    $('#confirmCancel').addEventListener('click', () => confirmDone && confirmDone(false));

    // ---- 標題 ----
    const title = $('#eventTitle');
    title.addEventListener('dblclick', beginTitleEdit);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); endTitleEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); endTitleEdit(false); }
    });
    title.addEventListener('blur', () => endTitleEdit(true));

    // ---- 版面變化 ----
    if ('ResizeObserver' in window) new ResizeObserver(scheduleLayout).observe($('#stageFrame'));
    let gt = 0;
    window.addEventListener('resize', () => {
      scheduleLayout();
      clearTimeout(gt);
      gt = setTimeout(buildGarland, 150);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wakeWanted) keepAwake();
    });
    window.addEventListener('beforeunload', (e) => {
      if (phase === 'spinning' || phase === 'stopping') { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* =========================================================
   * 啟動
   * ========================================================= */
  /** 從入口首頁進來時，?mode=prize / ?mode=exchange 直接切到對應模式（只生效一次，之後重新整理不會蓋掉選擇） */
  function applyDeepLink() {
    const mode = new URLSearchParams(window.location.search).get('mode');
    if (mode === 'prize' || mode === 'exchange') {
      S().mode = mode;
      store.save();
    }
    if (mode) {
      try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* 部分環境不允許，略過 */ }
    }
  }

  function init() {
    applyDeepLink();
    fx.init();
    syncControls();
    applySettings();
    if ('speechSynthesis' in window) {
      pickVoice();
      window.speechSynthesis.onvoiceschanged = pickVoice;
    } else {
      $('#btnVoice').hidden = true;
    }
    bindEvents();
    buildGarland();
    prepareStage(true);
    renderPanel();
    // 照片：預先載入，並偵測 photos 資料夾（找到新照片會自動重畫）
    photos.on(afterPhotoChange);
    photos.preloadAll(S().participants);
    photos.probe(S().participants.map((p) => p.name));
    requestAnimationFrame(() => { layoutReels(); buildMarquee(); });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        reels.forEach((r) => r.measure());
        layoutReels();
        buildMarquee();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.LD);
