/* =========================================================
 * EMRD Lucky Draw — 抽獎核心邏輯（純函式，不碰畫面）
 *  - 使用 crypto.getRandomValues 產生公平亂數
 *  - 交換禮物：抽獎人 ID !== 禮物 ID，且保證最後不會卡在「只剩自己的禮物」
 * ========================================================= */
(function (LD) {
  'use strict';

  var cryptoObj = (typeof window !== 'undefined' && (window.crypto || window.msCrypto)) || null;
  var u32 = new Uint32Array(1);

  /** 0 ~ n-1 的均勻亂數（拒絕取樣，避免取餘數偏差） */
  function randInt(n) {
    if (n <= 1) return 0;
    if (!cryptoObj || !cryptoObj.getRandomValues) return Math.floor(Math.random() * n);
    var limit = Math.floor(4294967296 / n) * n;
    var x;
    do {
      cryptoObj.getRandomValues(u32);
      x = u32[0];
    } while (x >= limit);
    return x % n;
  }

  /** Fisher–Yates 洗牌（回傳新陣列） */
  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function sample(list, k) {
    return shuffle(list).slice(0, Math.max(0, Math.min(k, list.length)));
  }

  function without(list, id) {
    return list.filter(function (x) { return x !== id; });
  }

  /** 是否可以把這份禮物給這位抽獎人（核心規則：不能抽到自己的禮物） */
  function canTake(drawerId, giftId) {
    return drawerId !== giftId;
  }

  /**
   * 二分圖最大匹配（Kuhn 演算法）：
   * 剩下的抽獎人最多能有幾位「各自分到一份不是自己的禮物」。
   */
  function maxMatching(drawerIds, giftIds) {
    var holder = new Map(); // giftId -> drawerId
    function tryAssign(drawerId, seen) {
      for (var i = 0; i < giftIds.length; i++) {
        var giftId = giftIds[i];
        if (!canTake(drawerId, giftId) || seen.has(giftId)) continue;
        seen.add(giftId);
        if (!holder.has(giftId) || tryAssign(holder.get(giftId), seen)) {
          holder.set(giftId, drawerId);
          return true;
        }
      }
      return false;
    }
    var size = 0;
    for (var k = 0; k < drawerIds.length; k++) {
      if (tryAssign(drawerIds[k], new Set())) size++;
    }
    return size;
  }

  /** 目前狀態是否還能「全部分完」 */
  function isFeasible(drawerIds, giftIds) {
    return maxMatching(drawerIds, giftIds) === Math.min(drawerIds.length, giftIds.length);
  }

  /**
   * 為本輪的抽獎人分配禮物。
   * 每一位抽獎人：從「不是自己的、還沒被抽走的禮物」中均勻亂數挑選，
   * 並且只挑「挑完之後，剩下的人仍然分得完」的禮物 → 永遠不會在最後一位卡關。
   * @returns {Array<{drawer:number, gift:number}>|null}
   */
  function assignGifts(roundDrawers, drawersLeft, giftsLeft) {
    var restDrawers = drawersLeft.slice();
    var restGifts = giftsLeft.slice();
    var pairs = [];

    for (var i = 0; i < roundDrawers.length; i++) {
      var drawerId = roundDrawers[i];
      restDrawers = without(restDrawers, drawerId);

      // 抽獎人 ID !== 禮物 ID：自己的禮物不在候選名單內
      var options = shuffle(restGifts.filter(function (giftId) { return canTake(drawerId, giftId); }));
      if (!options.length) return null;

      var need = Math.min(restDrawers.length, restGifts.length - 1);
      var chosen = null;
      for (var j = 0; j < options.length; j++) {
        if (maxMatching(restDrawers, without(restGifts, options[j])) >= need) {
          chosen = options[j];
          break;
        }
      }
      if (chosen === null) chosen = options[0]; // 名單被手動改到無解時的後備（仍然不會抽到自己）

      restGifts = without(restGifts, chosen);
      pairs.push({ drawer: drawerId, gift: chosen });
    }
    return pairs;
  }

  /** 決定本輪抽獎人：先放入指定的（接力），不足再從尚未抽的人隨機補 */
  function pickRoundDrawers(drawersLeft, count, preferred) {
    var picked = [];
    (preferred || []).forEach(function (id) {
      if (picked.length < count && drawersLeft.indexOf(id) >= 0 && picked.indexOf(id) < 0) picked.push(id);
    });
    var rest = drawersLeft.filter(function (id) { return picked.indexOf(id) < 0; });
    return picked.concat(sample(rest, count - picked.length));
  }

  /** 交換禮物：抽出一輪（count 組；剩下的人不足時，只抽剩下的人） */
  function drawExchange(drawersLeft, giftsLeft, count, preferredDrawers) {
    var n = Math.min(count, drawersLeft.length);
    if (n <= 0) return { ok: false, reason: 'empty' };
    if (!giftsLeft.length) return { ok: false, reason: 'no-gift' };
    var drawers = pickRoundDrawers(drawersLeft, n, preferredDrawers);
    var pairs = assignGifts(drawers, drawersLeft, giftsLeft);
    if (!pairs) return { ok: false, reason: 'infeasible' };
    return { ok: true, pairs: pairs };
  }

  /** 接力模式：上一輪被抽走禮物的人，若還沒抽過，就是下一位抽獎人 */
  function chainCandidates(lastPairs, drawersLeft) {
    return (lastPairs || [])
      .map(function (p) { return p.gift; })
      .filter(function (id) { return drawersLeft.indexOf(id) >= 0; });
  }

  /** 抽禮物：從候選池抽出 k 位（不重複） */
  function drawWinners(pool, count) {
    return sample(pool, count);
  }

  /** 查核：交換禮物紀錄是否有人抽到自己、重複抽獎人、重複禮物 */
  function auditExchange(records) {
    var selfDraw = [], dupDrawer = [], dupGift = [];
    var seenDrawer = new Set(), seenGift = new Set();
    records.forEach(function (r) {
      if (!canTake(r.drawerId, r.giftId)) selfDraw.push(r);
      if (seenDrawer.has(r.drawerId)) dupDrawer.push(r); else seenDrawer.add(r.drawerId);
      if (seenGift.has(r.giftId)) dupGift.push(r); else seenGift.add(r.giftId);
    });
    return {
      selfDraw: selfDraw,
      dupDrawer: dupDrawer,
      dupGift: dupGift,
      ok: !selfDraw.length && !dupDrawer.length && !dupGift.length
    };
  }

  /** 查核：抽禮物紀錄是否有重複中獎 */
  function auditPrize(records) {
    var dup = [], seen = new Set();
    records.forEach(function (r) {
      if (seen.has(r.id)) dup.push(r); else seen.add(r.id);
    });
    return { dup: dup, ok: !dup.length };
  }

  LD.logic = {
    randInt: randInt,
    shuffle: shuffle,
    sample: sample,
    canTake: canTake,
    maxMatching: maxMatching,
    isFeasible: isFeasible,
    assignGifts: assignGifts,
    pickRoundDrawers: pickRoundDrawers,
    drawExchange: drawExchange,
    chainCandidates: chainCandidates,
    drawWinners: drawWinners,
    auditExchange: auditExchange,
    auditPrize: auditPrize
  };
})(window.LD = window.LD || {});
