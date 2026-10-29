// va: バーチャルゲームセンターの窓（親）とのやりとり（DESIGN §16.9）。元の Hextris には無いファイル。
// このファイルも Hextris のフォルダの一部として GNU GPL v3（LICENSE.md）。
//
// - Play（クリック・タップ・Enter）・やり直し（Restart のボタン・Enter）を押しても、すぐには始めない。
//   親に {type:'va-hextris:play'} を送り、親がサーバに start を頼んで {type:'va-hextris:start', seed, gen, best} を返したら、
//   その種の乱数で新しいゲームを始める（前のゲームが残っていれば、親が先に記録する）
// - ブロックを消すたびに {type:'va-hextris:clear', k, m, score, gen}（消した数・コンボの倍率・その時点の点数）
// - ゲームオーバーは {type:'va-hextris:over', score, gen}、Esc は {type:'va-hextris:close', gen}
// やりとりは同じオリジンの親の窓とだけ（受け取るときは送り主が親で、オリジンが同じかを確かめる）。
(function () {
  'use strict';

  // 32 bit の種から [0, 1) の数を作る乱数（mulberry32。2048・Columns like game と同じ式）
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
  var waiting = false; // Play を押して親の返事を待っている
  var waitTimer = null;

  function post(msg) {
    if (inFrame) window.parent.postMessage(msg, location.origin);
  }

  /** 種を受け取って新しいゲームを始める */
  function begin(p) {
    waiting = false;
    current = mulberry32(p.seed >>> 0);
    gen = p.gen | 0;
    // ベストは「サーバに記録された自分のベスト」（このページの間の点数と並べる。保存はしない）
    if (p.best > 0 && typeof highscores !== 'undefined' && highscores.indexOf(p.best) === -1) {
      highscores.push(p.best);
      writeHighScores();
    }
    init(1);
    checkVisualElements(0);
    $('#gameoverscreen').fadeOut();
    try {
      window.focus();
    } catch (e) {
      /* フォーカスできなくても遊べる（クリックすれば入る） */
    }
  }

  var VAHextris = {
    mulberry32: mulberry32,
    /** 落ちてくるブロックの乱数（math.js の randInt が呼ぶ） */
    rng: function () {
      return current();
    },
    /** Play・やり直し：親に種を頼む */
    requestPlay: function () {
      if (waiting) return;
      if (!inFrame) {
        // 窓の外で開いたとき（確かめ用）：自分で種を決めて始める
        begin({ seed: Math.floor(Math.random() * 4294967296), gen: gen + 1, best: 0 });
        return;
      }
      waiting = true;
      post({ type: 'va-hextris:play', gen: gen });
      // 親が返事をしなければ、しばらくしてまた押せるように
      clearTimeout(waitTimer);
      waitTimer = setTimeout(function () {
        waiting = false;
      }, 5000);
    },
    /** ブロックを消した（checking.js の consolidateBlocks が呼ぶ） */
    cleared: function (k, m, adder) {
      post({ type: 'va-hextris:clear', k: k, m: m, add: adder, score: window.score, gen: gen });
    },
    /** ゲームオーバー（main.js の animLoop が呼ぶ） */
    over: function (score) {
      post({ type: 'va-hextris:over', score: score, gen: gen });
    },
  };
  window.VAHextris = VAHextris;

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    var d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'va-hextris:start' && typeof d.seed === 'number') {
      begin({ seed: d.seed, gen: d.gen, best: Math.max(0, Math.floor(Number(d.best) || 0)) });
    } else if (d.type === 'va-hextris:failed') {
      // 親が始められなかった（遠い・回数制限など）。もう一度押せるように
      waiting = false;
    }
  });

  window.addEventListener('load', function () {
    post({ type: 'va-hextris:ready' });
  });

  // Esc で窓を閉じる（フォーカスがこの中にあると、親の窓にはキーが届かないため）
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.keyCode === 27) post({ type: 'va-hextris:close', gen: gen });
  });
})();
