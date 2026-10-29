// va: バーチャルゲームセンターの窓（親）とのやりとり（DESIGN §16.3）。元の 2048 には無いファイル。
//
// - 読み込んでも始めない。親から {type:'va2048:start', seed, gen, best} を受け取ったら、その種の乱数で新しいゲームを始める
//   （もう一度受け取ったら、そのたびに新しいゲーム）
// - 盤が動いた手だけを {type:'va2048:move', dir, gen} で知らせる（0 上・1 右・2 下・3 左）。終わったら {type:'va2048:over', score, gen}
// - Keep going は {type:'va2048:keep', gen}、New Game・Try again・R キーは {type:'va2048:restart', gen}（親が記録してから始め直す）
// - 途中の盤は保存しない。ベストは親から受け取った「サーバに記録された自分のベスト」
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
  var gen = 0; // 何回目のゲームか（親が決める。始め直す前の手を親が捨てるため）
  var best = 0;
  var manager = null;
  var isReady = false;
  var pending = null;

  function post(msg) {
    if (inFrame) window.parent.postMessage(msg, location.origin);
  }

  function begin(p) {
    current = mulberry32(p.seed);
    gen = p.gen;
    best = p.best;
    if (!manager) manager = new GameManager(4, KeyboardInputManager, HTMLActuator, VAStorageManager, VA2048.rng);
    else manager.newGame();
    try {
      window.focus();
    } catch (e) {
      /* フォーカスできなくても遊べる（クリックすれば入る） */
    }
  }

  // ベストは親から（途中の盤は残さない）
  function VAStorageManager() {}
  VAStorageManager.prototype.getBestScore = function () {
    return best;
  };
  VAStorageManager.prototype.setBestScore = function (score) {
    best = score;
  };
  VAStorageManager.prototype.getGameState = function () {
    return null;
  };
  VAStorageManager.prototype.setGameState = function () {};
  VAStorageManager.prototype.clearGameState = function () {};

  var VA2048 = {
    mulberry32: mulberry32,
    /** GameManager に渡す乱数（今のゲームの乱数を呼ぶ） */
    rng: function () {
      return current();
    },
    /** 画面の準備ができた（application.js が呼ぶ） */
    ready: function () {
      isReady = true;
      post({ type: 'va2048:ready' });
      if (pending) {
        var p = pending;
        pending = null;
        begin(p);
      }
    },
    requestRestart: function () {
      post({ type: 'va2048:restart', gen: gen });
    },
    moved: function (direction, over) {
      post({ type: 'va2048:move', dir: direction, gen: gen });
      if (over) post({ type: 'va2048:over', score: manager ? manager.score : 0, gen: gen });
    },
    kept: function () {
      post({ type: 'va2048:keep', gen: gen });
    },
  };
  window.VA2048 = VA2048;
  window.VAStorageManager = VAStorageManager;

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    var d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'va2048:start' && typeof d.seed === 'number') {
      var p = { seed: d.seed >>> 0, gen: d.gen | 0, best: Math.max(0, Math.floor(Number(d.best) || 0)) };
      if (isReady) begin(p);
      else pending = p;
    }
  });

  // Esc で窓を閉じる（フォーカスがこの中にあると、親の窓にはキーが届かないため）
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.keyCode === 27) post({ type: 'va2048:close', gen: gen });
  });
})();
