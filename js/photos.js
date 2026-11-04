/* =========================================================
 * EMRD Lucky Draw — 學員照片
 *  照片來源（優先順序）：
 *   1. 在「名單」裡匯入 / 上傳的照片：裁成正方形 256×256，存在這台電腦瀏覽器的 localStorage
 *   2. photos 資料夾：檔名用姓名（例如 photos/林振川.jpg），開啟時自動帶入，可跟著資料夾帶去現場
 *   3. 都沒有時：用名字做成彩色圓形頭像
 * ========================================================= */
(function (LD) {
  'use strict';

  var KEY = LD.STORAGE_KEY + '-photos';
  var uploads = {}; // id -> { name, data }（data 為 dataURL，用來保存）
  var blobUrls = {}; // id -> blob: 網址（顯示用，比 dataURL 輕巧）
  var folder = {}; // 姓名 -> 'photos/姓名.jpg'（偵測到的檔案）
  var probed = {}; // 姓名 -> 已偵測過
  var keep = {}; // 預先載入的圖片，避免轉動時閃爍
  var listeners = [];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toBlobURL(dataURL) {
    try {
      var parts = dataURL.split(',');
      var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([arr], { type: mime }));
    } catch (e) {
      return dataURL;
    }
  }

  function preload(src) {
    if (!src || keep[src]) return;
    var img = new Image();
    img.decoding = 'async';
    img.src = src;
    keep[src] = img;
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      uploads = raw ? JSON.parse(raw) || {} : {};
    } catch (e) {
      uploads = {};
    }
    Object.keys(uploads).forEach(function (id) {
      if (uploads[id] && typeof uploads[id].data === 'string') {
        blobUrls[id] = toBlobURL(uploads[id].data);
        preload(blobUrls[id]);
      } else {
        delete uploads[id];
      }
    });
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(uploads));
      return true;
    } catch (e) {
      console.error('[EMRD] 照片儲存失敗（localStorage 空間不足？）', e);
      return false;
    }
  }

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  /** 某人的照片網址；沒有照片回傳 null */
  function url(person) {
    if (!person) return null;
    return blobUrls[person.id] || folder[person.name] || null;
  }

  /** 照片來源：'upload' | 'folder' | null */
  function source(person) {
    if (!person) return null;
    if (blobUrls[person.id]) return 'upload';
    if (folder[person.name]) return 'folder';
    return null;
  }

  function set(person, dataURL, noSave) {
    uploads[person.id] = { name: person.name, data: dataURL };
    if (blobUrls[person.id]) URL.revokeObjectURL(blobUrls[person.id]);
    blobUrls[person.id] = toBlobURL(dataURL);
    preload(blobUrls[person.id]);
    return noSave ? true : save();
  }

  function drop(id) {
    delete uploads[id];
    if (blobUrls[id]) URL.revokeObjectURL(blobUrls[id]);
    delete blobUrls[id];
  }

  function remove(id) {
    if (!uploads[id]) return;
    drop(id);
    save();
  }

  function clearUploads() {
    Object.keys(uploads).forEach(drop);
    save();
  }

  /** 改名時一併更新照片紀錄上的姓名 */
  function rename(person) {
    if (uploads[person.id]) {
      uploads[person.id].name = person.name;
      save();
    }
  }

  /** 名單換掉後（例如恢復預設），清掉編號與姓名對不上的舊照片 */
  function prune(participants) {
    var byId = {};
    participants.forEach(function (p) { byId[p.id] = p.name; });
    var changed = false;
    Object.keys(uploads).forEach(function (id) {
      if (byId[id] !== uploads[id].name) {
        drop(id);
        changed = true;
      }
    });
    if (changed) save();
  }

  function count() {
    return Object.keys(uploads).length;
  }

  function preloadAll(participants) {
    participants.forEach(function (p) { preload(url(p)); });
  }

  /* ---------- photos 資料夾：依姓名自動偵測 ---------- */
  function tryExts(name, i) {
    var exts = LD.PHOTO_EXTS || ['jpg'];
    if (i >= exts.length) return Promise.resolve(null);
    var src = (LD.PHOTO_DIR || 'photos/') + encodeURIComponent(name) + '.' + exts[i];
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        keep[src] = img;
        resolve(src);
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    }).then(function (found) {
      return found || tryExts(name, i + 1);
    });
  }

  /** 偵測 photos 資料夾裡有沒有這些人的照片；有找到新照片會通知畫面更新 */
  function probe(names) {
    var todo = names.filter(function (n) { return n && !probed[n]; });
    if (!todo.length) return Promise.resolve(0);
    var found = 0;
    return Promise.all(todo.map(function (name) {
      probed[name] = true;
      return tryExts(name, 0).then(function (src) {
        if (src) {
          folder[name] = src;
          found++;
        }
      });
    })).then(function () {
      if (found) emit();
      return found;
    });
  }

  /* ---------- 匯入照片：裁成正方形、縮小成 256×256 ---------- */
  function fileToDataURL(file, size) {
    size = size || 256;
    return new Promise(function (resolve, reject) {
      var src = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          var side = Math.min(w, h);
          var sx = (w - side) / 2;
          var sy = h > w ? (h - side) * 0.2 : 0; // 直式照片保留上方（臉通常在上半部）
          var cv = document.createElement('canvas');
          cv.width = cv.height = size;
          var g = cv.getContext('2d');
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, size, size);
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(cv.toDataURL('image/jpeg', 0.86));
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(src);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(src);
        reject(new Error('unreadable'));
      };
      img.src = src;
    });
  }

  /** 依檔名找對應的人：姓名完全相同 → 純編號 → 檔名包含姓名 → 開頭是編號 */
  function matchFile(fileName, participants) {
    var norm = function (s) { return String(s).replace(/[\s_\-－—.()（）[\]【】]+/g, '').toLowerCase(); };
    var b = norm(String(fileName).replace(/\.[^.]+$/, ''));
    if (!b) return null;
    var i, p;
    for (i = 0; i < participants.length; i++) if (norm(participants[i].name) === b) return participants[i];
    if (/^\d+$/.test(b)) {
      for (i = 0; i < participants.length; i++) if (participants[i].id === Number(b)) return participants[i];
    }
    var best = null;
    for (i = 0; i < participants.length; i++) {
      p = participants[i];
      var n = norm(p.name);
      if (n && b.indexOf(n) >= 0 && (!best || n.length > norm(best.name).length)) best = p;
    }
    if (best) return best;
    var m = b.match(/^(\d{1,3})(?=\D)/);
    if (m) {
      for (i = 0; i < participants.length; i++) if (participants[i].id === Number(m[1])) return participants[i];
    }
    return null;
  }

  /* ---------- 頭像 ---------- */
  function initials(name) {
    var s = String(name || '').trim();
    if (!s) return '?';
    if (/^[\x00-\x7f]+$/.test(s)) return s.charAt(0).toUpperCase();
    var chars = Array.from(s);
    return chars.length >= 3 ? chars.slice(-2).join('') : chars.slice(-1).join('');
  }

  /**
   * 頭像 HTML：有照片顯示照片，沒有就用名字做彩色頭像
   * @param {{id:number,name:string}} person
   * @param {string} [cls]   額外的 class（決定尺寸）
   * @param {string} [inner] 疊在頭像上的小標（編號、禮物圖示）
   */
  function avatar(person, cls, inner) {
    var c = 'ava' + (cls ? ' ' + cls : '');
    var u = url(person);
    if (u) return '<span class="' + c + '"><img src="' + esc(u) + '" alt="" draggable="false">' + (inner || '') + '</span>';
    var hue = Math.round((person.id * 137.508) % 360);
    return '<span class="' + c + ' ph" style="--h:' + hue + '"><b>' + esc(initials(person.name)) + '</b>' + (inner || '') + '</span>';
  }

  load();

  LD.photos = {
    url: url,
    source: source,
    set: set,
    remove: remove,
    clearUploads: clearUploads,
    rename: rename,
    prune: prune,
    count: count,
    save: save,
    probe: probe,
    preloadAll: preloadAll,
    fileToDataURL: fileToDataURL,
    matchFile: matchFile,
    avatar: avatar,
    on: function (fn) { listeners.push(fn); }
  };
})(window.LD = window.LD || {});
