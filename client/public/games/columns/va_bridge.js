// va: バーチャルゲームセンターの窓（親）とのやりとり（DESIGN §16.8）。元の columns には無いファイル。
//
// - Play を押してもすぐには始めない。親に {type:'va-columns:play', options} を送り、親がサーバに start を頼んで
//   {type:'va-columns:start', seed, gen, options} を返したら、その種の乱数・その設定で game.play()
// - ピースが固まるたびに {type:'va-columns:place', x, rot, bonus, t, gen}（列・回した回数 0〜2・そのピースの ↓ と落下の点・経過秒）
// - ゲームオーバーは {type:'va-columns:over', score, x, bonus, gen}（最後のピースの列と ↓ の点。そのピースは井戸に入らない）
// - Reset（ボタン・Backspace）は {type:'va-columns:reset', gen}、Esc は {type:'va-columns:close', gen}
// やりとりは同じオリジンの親の窓とだけ（受け取るときは送り主が親で、オリジンが同じかを確かめる）。
(function () {
  'use strict';

  // 32 bit の種から [0, 1) の数を作る乱数（mulberry32）。shared/src/game2048.ts と同じ式
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var inFrame = !!window.parent && window.parent !== window;
  var current = mulberry32(0); // 今のゲームの乱数
  var gen = 0; // 何回目のゲームか（親が決める）
  var game = null;
  var waiting = false; // Play を押して親の返事を待っている

  function post(msg) {
    if (inFrame) window.parent.postMessage(msg, location.origin);
  }

  function int(v, lo, hi, def) {
    var n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) return def;
    return n;
  }

  /** 今のオプション（画面の欄から読む。元の play() と同じ読み方） */
  function readOptions() {
    game.options.load(game.options.save());
    return {
      mode: game.options.read('mode'),
      colors: game.options.read('difficulty'),
      height: game.options.read('height'),
      start: game.options.read('start'),
    };
  }

  var VAColumns = {
    mulberry32: mulberry32,
    /** ゲームに効く乱数（ピースの色・マジックジュエル・Height の段）。見た目だけのものは Math.random のまま */
    rng: function () {
      return current();
    },
    /** 画面の準備ができた（columns.js の load で呼ぶ） */
    attach: function (g) {
      game = g;
      post({ type: 'va-columns:ready' });
    },
    /** Play：親に種を頼む */
    requestPlay: function () {
      if (!game || !game.stopped || waiting) return;
      waiting = true;
      post({ type: 'va-columns:play', options: readOptions() });
      // 親が返事をしなければ（窓の外で開いたときなど）しばらくしてまた押せるように
      setTimeout(function () {
        waiting = false;
      }, 5000);
    },
    placed: function (p) {
      post({ type: 'va-columns:place', x: p.x, rot: p.rot, bonus: p.bonus, t: p.t, gen: gen });
    },
    over: function (p) {
      post({ type: 'va-columns:over', score: game ? game.score : 0, x: p.x, bonus: p.bonus, gen: gen });
    },
    reset: function () {
      post({ type: 'va-columns:reset', gen: gen });
    },
  };
  window.VAColumns = VAColumns;

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    var d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'va-columns:start' && typeof d.seed === 'number' && game) {
      waiting = false;
      if (!game.stopped) return;
      var o = d.options || {};
      current = mulberry32(d.seed >>> 0);
      gen = d.gen | 0;
      // 親（サーバ）が受け付けた設定で始める（欄に入れてから。元の play() は欄から読み直す）
      game.options.load({
        difficulty: int(o.colors, 3, 6, 5),
        start: int(o.start, 1, 12, 1),
        height: int(o.height, 0, 10, 0),
        mode: int(o.mode, 0, 2, 0),
        ghost: game.options.read('ghost'),
        backdrop: 1,
      });
      game.play();
      try {
        window.focus();
      } catch (e) {
        /* フォーカスできなくても遊べる（クリックすれば入る） */
      }
    } else if (d.type === 'va-columns:failed') {
      // 親が始められなかった（遠い・回数制限など）。もう一度押せるように
      waiting = false;
    }
  });

  // Esc で窓を閉じる（フォーカスがこの中にあると、親の窓にはキーが届かないため）
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.keyCode === 27) post({ type: 'va-columns:close', gen: gen });
  });
})();
