/* =========================================================
 * EMRD Lucky Draw — 資料儲存（localStorage）
 * ========================================================= */
(function (LD) {
  'use strict';

  function defaultParticipants() {
    return LD.DEFAULT_NAMES.map(function (name, i) { return { id: i + 1, name: name }; });
  }

  function defaultState() {
    return {
      version: 1,
      title: LD.DEFAULT_TITLE,
      participants: defaultParticipants(),
      nextId: LD.DEFAULT_NAMES.length + 1,
      mode: 'exchange', // exchange 交換禮物 | prize 抽禮物
      count: 1, // 一次抽 1 或 2 人
      exchange: { drawerMode: 'random', records: [] }, // random 隨機抽獎人 | chain 接力
      prize: { prizeName: '', records: [] },
      settings: { sound: true, bgm: false, voice: false, panel: true }
    };
  }

  /** 讀進來的資料逐欄檢查，壞掉的欄位用預設值補上 */
  function sanitize(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    var s = {
      version: 1,
      title: typeof raw.title === 'string' && raw.title.trim() && (LD.OLD_DEFAULT_TITLES || []).indexOf(raw.title) < 0
        ? raw.title
        : d.title,
      participants: Array.isArray(raw.participants)
        ? raw.participants.filter(function (p) {
            return p && typeof p.id === 'number' && typeof p.name === 'string' && p.name.trim();
          })
        : d.participants,
      nextId: typeof raw.nextId === 'number' ? raw.nextId : d.nextId,
      mode: raw.mode === 'prize' ? 'prize' : 'exchange',
      count: raw.count === 2 ? 2 : 1,
      exchange: {
        drawerMode: raw.exchange && raw.exchange.drawerMode === 'chain' ? 'chain' : 'random',
        records: raw.exchange && Array.isArray(raw.exchange.records) ? raw.exchange.records : []
      },
      prize: {
        prizeName: raw.prize && typeof raw.prize.prizeName === 'string' ? raw.prize.prizeName : '',
        records: raw.prize && Array.isArray(raw.prize.records) ? raw.prize.records : []
      },
      settings: Object.assign({}, d.settings, raw.settings || {})
    };
    var maxId = s.participants.reduce(function (m, p) { return Math.max(m, p.id); }, 0);
    if (s.nextId <= maxId) s.nextId = maxId + 1;
    return s;
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(LD.STORAGE_KEY);
      if (raw) return sanitize(JSON.parse(raw));
    } catch (e) {
      console.warn('[EMRD] 讀取 localStorage 失敗，改用預設值', e);
    }
    return defaultState();
  }

  var state = load();
  var timer = 0;

  function saveNow() {
    clearTimeout(timer);
    try {
      window.localStorage.setItem(LD.STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('[EMRD] 寫入 localStorage 失敗', e);
      if (LD.ui && LD.ui.toast) LD.ui.toast('⚠️ 無法寫入瀏覽器儲存空間（localStorage），請匯出 CSV 備份');
      return false;
    }
  }

  function save() {
    clearTimeout(timer);
    timer = setTimeout(saveNow, 120);
  }

  /** 重要操作前另存一份快照，萬一按錯還找得回來 */
  function backup() {
    try { window.localStorage.setItem(LD.BACKUP_KEY, JSON.stringify(state)); } catch (e) { /* 空間不足時略過 */ }
  }

  LD.store = {
    get state() { return state; },
    save: save,
    saveNow: saveNow,
    backup: backup,
    defaultState: defaultState,
    defaultParticipants: defaultParticipants
  };
})(window.LD = window.LD || {});
