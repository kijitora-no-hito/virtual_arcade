// v0.4.1：スマホでキーボードが出て表示域の高さが縮んでも、レイアウト（縦横・PC/スマホ）が切り替わらないこと。
import { describe, expect, it } from 'vitest';
import { isTextEntry, nextLayout, type LayoutInput } from '../src/layout';

const pixel = (width: number, height: number, extra: Partial<LayoutInput> = {}): LayoutInput => ({
  width,
  height,
  coarse: true,
  mobileUa: true,
  screenLandscape: width > height,
  ...extra,
});

describe('nextLayout（キーボードと回転）', () => {
  it('縦 412×915 → キーボードで 412×400 になっても縦のまま → 回転 915×412 で横', () => {
    const a = nextLayout(null, pixel(412, 915));
    expect(a).toMatchObject({ kind: 'mobile', landscape: false });
    // キーボード：表示域だけ縮む。端末の画面は縦のまま
    const b = nextLayout(a, pixel(412, 400, { screenLandscape: false, editing: true }));
    expect(b.landscape).toBe(false);
    expect(b).toBe(a);
    // フォーカスの有無が分からなくても（focus を取れない欄など）、幅が同じで高さだけ縮んだなら縦のまま
    const b2 = nextLayout(a, pixel(412, 400, { screenLandscape: false, editing: false }));
    expect(b2.landscape).toBe(false);
    // 端末の画面の向きが分からないブラウザでも同じ
    const b3 = nextLayout(a, pixel(412, 400, { screenLandscape: null }));
    expect(b3.landscape).toBe(false);
    // キーボードを閉じる
    const c = nextLayout(b, pixel(412, 915));
    expect(c.landscape).toBe(false);
    // 本当の回転
    const d = nextLayout(c, pixel(915, 412));
    expect(d).toMatchObject({ kind: 'mobile', landscape: true });
  });

  it('横向きでキーボードが出ても横のまま、縦に戻すと縦', () => {
    const a = nextLayout(null, pixel(915, 412));
    expect(a.landscape).toBe(true);
    expect(nextLayout(a, pixel(915, 200, { screenLandscape: true, editing: true })).landscape).toBe(true);
    expect(nextLayout(a, pixel(915, 200, { screenLandscape: true })).landscape).toBe(true);
    expect(nextLayout(a, pixel(412, 915)).landscape).toBe(false);
  });

  it('文字の欄にフォーカスがある間は回転しても今のまま（欄を作り直さない）、離れたら回転に合わせる', () => {
    const a = nextLayout(null, pixel(412, 915));
    const typing = nextLayout(a, pixel(915, 412, { editing: true }));
    expect(typing).toBe(a);
    expect(nextLayout(typing, pixel(915, 412, { editing: false })).landscape).toBe(true);
  });

  it('幅が同じでも端末の画面の向きが変わったら回転として決め直す（正方形に近い端末）', () => {
    const a = nextLayout(null, pixel(600, 620, { coarse: true, mobileUa: false, screenLandscape: false }));
    expect(a.landscape).toBe(false);
    expect(nextLayout(a, pixel(600, 580, { coarse: true, mobileUa: false, screenLandscape: true })).landscape).toBe(true);
  });

  it('指のタブレットの横向きでキーボードが出ても PC のレイアウトのまま（短い辺が 600 未満になっても）', () => {
    const tab = (w: number, h: number, editing = false): LayoutInput => ({ width: w, height: h, coarse: true, mobileUa: false, screenLandscape: true, editing });
    const a = nextLayout(null, tab(1280, 800));
    expect(a.kind).toBe('pc');
    expect(nextLayout(a, tab(1280, 420, true)).kind).toBe('pc');
    expect(nextLayout(a, tab(1280, 420)).kind).toBe('pc');
  });

  it('PC の窓の大きさを変えたときは今までどおり（幅で決まる）', () => {
    const pc = (w: number, h: number): LayoutInput => ({ width: w, height: h, coarse: false, mobileUa: false, screenLandscape: true });
    const a = nextLayout(null, pc(1920, 1080));
    expect(a.kind).toBe('pc');
    const b = nextLayout(a, pc(800, 1080));
    expect(b).toMatchObject({ kind: 'mobile', landscape: false });
    expect(nextLayout(b, pc(1600, 1080)).kind).toBe('pc');
  });

  it('?layout= の強制は大きさによらない', () => {
    const a = nextLayout(null, pixel(412, 915, { force: 'pc' }));
    expect(a.kind).toBe('pc');
    expect(nextLayout(a, pixel(412, 400, { force: 'pc', editing: true })).kind).toBe('pc');
  });
});

describe('isTextEntry', () => {
  const el = (tagName: string, props: Record<string, unknown> = {}) => ({ tagName, ...props }) as unknown as Element;
  it('文字を打つ欄だけ', () => {
    expect(isTextEntry(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isTextEntry(el('INPUT', { type: 'password' }))).toBe(true);
    expect(isTextEntry(el('INPUT', { type: 'datetime-local' }))).toBe(true);
    expect(isTextEntry(el('TEXTAREA'))).toBe(true);
    expect(isTextEntry(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTextEntry(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTextEntry(el('INPUT', { type: 'text', readOnly: true }))).toBe(false);
    expect(isTextEntry(el('BUTTON'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
