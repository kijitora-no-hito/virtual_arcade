import { FLOOR } from '@va/shared';
import { describe, expect, it } from 'vitest';
import {
  cameraView,
  clampCamera,
  dragCamera,
  floorBounds,
  followTarget,
  isTap,
  mobileMargin,
  pinchCamera,
  shouldReturn,
  stepFollow,
  TAP_SLOP,
  TEXT_MAX,
  TEXT_MIN,
  worldBlit,
  worldPixelRatio,
  worldView,
  zoomAt,
  zoomLimits,
  type Camera,
} from '../src/game/camera';
import { fitView, fromScreen, toScreen } from '../src/game/iso';
import { decideLayout, forcedLayout, isMobileUa } from '../src/layout';

const W = 390;
const H = 630;
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('カメラ → View と座標の変換', () => {
  it('カメラの中心が画面の中心に来る', () => {
    const t = followTarget(10, 8);
    const v = cameraView({ cx: t.x, cy: t.y, s: 0.8 }, W, H);
    // 追う先 = (10.5, 8.5) の床から 40 上
    const p = toScreen(v, 10.5, 8.5, 40);
    close(p.x, W / 2);
    close(p.y, H / 2);
  });

  it('拡大・移動しても 画面の点 → 床の座標 → 画面の点 が戻る', () => {
    const cams: Camera[] = [
      { cx: 0, cy: 0, s: 0.3 },
      { cx: 120, cy: 260, s: 0.8 },
      { cx: -300, cy: 100, s: 1.7 },
      { cx: 400, cy: 500, s: 2.2 },
    ];
    for (const cam of cams) {
      const v = cameraView(cam, W, H);
      for (const [sx, sy] of [
        [0, 0],
        [W / 2, H / 2],
        [37, 512],
        [W, H],
      ]) {
        const g = fromScreen(v, sx, sy);
        const back = toScreen(v, g.gx, g.gy);
        close(back.x, sx);
        close(back.y, sy);
      }
    }
  });

  it('タップした画面の点が、そこに描かれているマスになる（拡大・移動のあと）', () => {
    let cam: Camera = { cx: followTarget(6, 6).x, cy: followTarget(6, 6).y, s: 1.2 };
    cam = dragCamera(cam, -80, 35);
    cam = pinchCamera(cam, { x: 100, y: 300 }, { x: 250, y: 300 }, { x: 60, y: 320 }, { x: 300, y: 320 }, W, H, 0.3, 2.2);
    const v = cameraView(cam, W, H);
    // マス (12, 9) の中心を描いた場所をタップ → (12, 9)
    const c = toScreen(v, 12.5, 9.5);
    const g = fromScreen(v, c.x, c.y);
    expect(Math.floor(g.gx)).toBe(12);
    expect(Math.floor(g.gy)).toBe(9);
  });

  it('文字の倍率は拡大率を 1.0〜1.4 に収めたもの', () => {
    expect(cameraView({ cx: 0, cy: 0, s: 0.3 }, W, H).ts).toBe(TEXT_MIN);
    expect(cameraView({ cx: 0, cy: 0, s: 1.2 }, W, H).ts).toBe(1.2);
    expect(cameraView({ cx: 0, cy: 0, s: 2.2 }, W, H).ts).toBe(TEXT_MAX);
  });
});

describe('倍率の範囲と既定', () => {
  it('いちばん縮小は店全体が入る倍率、既定はその 2.4 倍', () => {
    const lim = zoomLimits(W, H, FLOOR);
    close(lim.min, fitView(W, H, FLOOR).s);
    close(lim.def, lim.fit * 2.4);
    expect(lim.max).toBeGreaterThan(lim.def);
    expect(lim.max).toBeLessThanOrEqual(2.2);
  });

  it('横向きでも既定は範囲の中', () => {
    const lim = zoomLimits(844, 330, FLOOR);
    expect(lim.def).toBeGreaterThanOrEqual(lim.min);
    expect(lim.def).toBeLessThanOrEqual(lim.max);
  });
});

describe('カメラの範囲', () => {
  it('中心は店の範囲に収まる（画面の端が店の外へ出すぎない）', () => {
    const lim = zoomLimits(W, H, FLOOR);
    const b = floorBounds(FLOOR);
    const c = clampCamera({ cx: 99999, cy: -99999, s: lim.max }, W, H, FLOOR);
    const v = cameraView(c, W, H);
    // 画面の右端・上端が店の範囲の端と一致
    close((W - v.ox) / v.s, b.maxX, 1e-6);
    close((0 - v.oy) / v.s, b.minY, 1e-6);
  });

  it('画面より店が小さい向きは真ん中', () => {
    const lim = zoomLimits(W, H, FLOOR);
    const b = floorBounds(FLOOR);
    const c = clampCamera({ cx: 500, cy: 500, s: lim.min }, W, H, FLOOR);
    close(c.cx, (b.minX + b.maxX) / 2);
  });

  it('スマホは店の端の外まで少し動かせる（端のマスを画面の内側に寄せてタップできる）', () => {
    const lim = zoomLimits(W, H, FLOOR);
    const b = floorBounds(FLOOR);
    const m = mobileMargin(W, H);
    // 右下の端まで寄せる
    const c = clampCamera({ cx: 99999, cy: 99999, s: lim.max }, W, H, FLOOR, m);
    const v = cameraView(c, W, H);
    // 店の右端は画面の右端から m.x、下端は画面の下端から m.y 内側
    close(v.ox + b.maxX * v.s, W - m.x, 1e-6);
    close(v.oy + b.maxY * v.s, H - m.y, 1e-6);
    // どのマスも、寄せれば画面の内側（宣伝の吹き出しの上）に来る：右端・手前の角のマス (21, 15)
    const corner = toScreen(v, FLOOR.cols - 0.5, FLOOR.rows - 0.5);
    expect(corner.x).toBeLessThan(W - m.x);
    expect(corner.y).toBeLessThan(H - m.y);
  });

  it('倍率も範囲に収める', () => {
    const lim = zoomLimits(W, H, FLOOR);
    expect(clampCamera({ cx: 0, cy: 0, s: 99 }, W, H, FLOOR).s).toBe(lim.max);
    expect(clampCamera({ cx: 0, cy: 0, s: 0.01 }, W, H, FLOOR).s).toBe(lim.min);
  });
});

describe('追従', () => {
  it('なめらかに近づき、十分たてば追いつく', () => {
    const target = followTarget(15, 3);
    let cam: Camera = { cx: 0, cy: 0, s: 1 };
    const d0 = Math.hypot(target.x - cam.cx, target.y - cam.cy);
    cam = stepFollow(cam, target, 1 / 60);
    const d1 = Math.hypot(target.x - cam.cx, target.y - cam.cy);
    expect(d1).toBeLessThan(d0);
    expect(d1).toBeGreaterThan(d0 * 0.8);
    for (let i = 0; i < 180; i++) cam = stepFollow(cam, target, 1 / 60);
    expect(Math.hypot(target.x - cam.cx, target.y - cam.cy)).toBeLessThan(0.01);
    expect(cam.s).toBe(1);
  });

  it('見回しのあと、指を離して時間がたったら戻す', () => {
    expect(shouldReturn(null, 1000, false)).toBe(false);
    expect(shouldReturn(5000, 4000, false)).toBe(false);
    expect(shouldReturn(5000, 5000, true)).toBe(false);
    expect(shouldReturn(5000, 5001, false)).toBe(true);
  });
});

describe('ドラッグ・ピンチ・ホイール', () => {
  it('ドラッグ：指の動きと同じだけ店が動く', () => {
    const cam: Camera = { cx: 100, cy: 200, s: 2 };
    const before = toScreen(cameraView(cam, W, H), 5, 5);
    const after = toScreen(cameraView(dragCamera(cam, 30, -12), W, H), 5, 5);
    close(after.x - before.x, 30);
    close(after.y - before.y, -12);
  });

  it('ピンチ：指の間の距離の比で拡大し、指の間の点の下の店の点はついてくる', () => {
    const cam: Camera = { cx: 50, cy: 300, s: 1 };
    const a0 = { x: 150, y: 300 };
    const b0 = { x: 250, y: 300 };
    const a1 = { x: 100, y: 350 };
    const b1 = { x: 300, y: 350 };
    const v0 = cameraView(cam, W, H);
    const g = fromScreen(v0, 200, 300); // 始めの指の間の点の下の床
    const next = pinchCamera(cam, a0, b0, a1, b1, W, H, 0.3, 2.2);
    close(next.s, 2);
    const p = toScreen(cameraView(next, W, H), g.gx, g.gy);
    close(p.x, 200);
    close(p.y, 350);
  });

  it('ピンチの倍率は範囲に収める', () => {
    const cam: Camera = { cx: 0, cy: 0, s: 1 };
    const n = pinchCamera(cam, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, W, H, 0.3, 2.2);
    expect(n.s).toBe(2.2);
    const m = pinchCamera(cam, { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }, W, H, 0.3, 2.2);
    expect(m.s).toBe(0.3);
  });

  it('ホイール：カーソルの下の点は動かない', () => {
    const cam: Camera = { cx: 10, cy: 200, s: 0.8 };
    const p = { x: 80, y: 500 };
    const g = fromScreen(cameraView(cam, W, H), p.x, p.y);
    const n = zoomAt(cam, p, 1.25, W, H, 0.3, 2.2);
    close(n.s, 1);
    const q = toScreen(cameraView(n, W, H), g.gx, g.gy);
    close(q.x, p.x);
    close(q.y, p.y);
  });
});

describe('タップとドラッグの区別', () => {
  it('動いた距離が 10px 以下で 1 本指ならタップ', () => {
    expect(isTap(0, false)).toBe(true);
    expect(isTap(TAP_SLOP, false)).toBe(true);
    expect(isTap(TAP_SLOP + 0.5, false)).toBe(false);
    expect(isTap(2, true)).toBe(false);
  });
});

describe('床・壁の大きな canvas', () => {
  it('ずらして貼ると、今の View で描いたのと同じ位置になる', () => {
    const wv = worldView(FLOOR, 0.8);
    const v = cameraView({ cx: 120, cy: 300, s: 1.2 }, W, H);
    const r = worldBlit(wv, v);
    // 大きな canvas の上のマス (7, 3) の位置 → 貼った先
    const pw = toScreen(wv, 7, 3);
    const k = r.w / wv.w;
    const pv = toScreen(v, 7, 3);
    close(r.x + pw.x * k, pv.x);
    close(r.y + pw.y * k, pv.y);
  });

  it('店全体が大きな canvas の中に入る', () => {
    const wv = worldView(FLOOR, 1);
    const b = floorBounds(FLOOR);
    expect(wv.ox + b.minX).toBeGreaterThan(0);
    expect(wv.oy + b.minY).toBeGreaterThan(0);
    expect(wv.ox + b.maxX).toBeLessThan(wv.w);
    expect(wv.oy + b.maxY).toBeLessThan(wv.h);
  });

  it('大きすぎる canvas にならない', () => {
    const wv = worldView(FLOOR, 2.2);
    const pr = worldPixelRatio(wv, 3);
    expect(Math.max(wv.w, wv.h) * pr).toBeLessThanOrEqual(4096 + 1e-6);
    expect(wv.w * wv.h * pr * pr).toBeLessThanOrEqual(16_000_000 + 1);
    expect(worldPixelRatio(worldView(FLOOR, 0.3), 2)).toBe(2);
  });
});

describe('レイアウトの切り替え', () => {
  it('幅 900 未満はスマホ', () => {
    expect(decideLayout({ width: 390, height: 844, coarse: true }).kind).toBe('mobile');
    expect(decideLayout({ width: 899, height: 1000, coarse: false }).kind).toBe('mobile');
    expect(decideLayout({ width: 1920, height: 1080, coarse: false }).kind).toBe('pc');
  });

  it('指の端末で短い辺が 600 未満（横向きの大きいスマホ）はスマホ、タブレットは PC', () => {
    expect(decideLayout({ width: 932, height: 430, coarse: true })).toEqual({ kind: 'mobile', mobile: true, landscape: true });
    expect(decideLayout({ width: 932, height: 430, coarse: false }).kind).toBe('pc');
    expect(decideLayout({ width: 1180, height: 820, coarse: true }).kind).toBe('pc');
  });

  it('縦・横', () => {
    expect(decideLayout({ width: 390, height: 844, coarse: true }).landscape).toBe(false);
    expect(decideLayout({ width: 844, height: 390, coarse: true }).landscape).toBe(true);
  });

  it('スマホの端末（UA）は大きさにかかわらずスマホ（?layout=pc のときだけ PC）', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
    const tablet = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const pc = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
    expect(isMobileUa(iphone)).toBe(true);
    expect(isMobileUa(android)).toBe(true);
    expect(isMobileUa(tablet)).toBe(false);
    expect(isMobileUa(pc)).toBe(false);
    expect(isMobileUa(pc, true)).toBe(true);
    // 横向きの大きいスマホ（幅 998）・「PC 版サイト」でない大きな表示でも
    expect(decideLayout({ width: 998, height: 448, coarse: false, mobileUa: true }).kind).toBe('mobile');
    expect(decideLayout({ width: 1280, height: 720, coarse: false, mobileUa: true }).kind).toBe('mobile');
    expect(decideLayout({ width: 1280, height: 720, coarse: false, mobileUa: true, force: 'pc' }).kind).toBe('pc');
    expect(decideLayout({ width: 1280, height: 800, coarse: true, mobileUa: false }).kind).toBe('pc');
  });

  it('?layout= で強制', () => {
    expect(forcedLayout('?layout=mobile')).toBe('mobile');
    expect(forcedLayout('?x=1&layout=pc')).toBe('pc');
    expect(forcedLayout('?layout=tablet')).toBe(null);
    expect(forcedLayout('')).toBe(null);
    expect(decideLayout({ width: 1920, height: 1080, coarse: false, force: 'mobile' }).kind).toBe('mobile');
    expect(decideLayout({ width: 390, height: 844, coarse: true, force: 'pc' }).kind).toBe('pc');
  });
});
