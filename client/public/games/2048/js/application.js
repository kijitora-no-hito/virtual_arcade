// va: 読み込んですぐには始めない。親の窓（バーチャルゲームセンター）から種を受け取ったら va_bridge.js が始める
// Wait till the browser is ready to render the game (avoids glitches)
window.requestAnimationFrame(function () {
  VA2048.ready();
});
