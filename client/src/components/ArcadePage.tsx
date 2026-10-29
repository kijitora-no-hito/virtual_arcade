import {
  cabinetDistance,
  CRANE_NEAR,
  craneSpot,
  embedUrlMini,
  EMOTES,
  FLOOR,
  GAME_NEAR,
  gameInfo,
  gameSpot,
  isPassable,
  isStep,
  NOTE_NEAR,
  noteSpots,
  positionAt,
  requestBoxSpots,
  activeReservation,
  doorSpots,
  jstDate,
  jstDayStart,
  jstTime,
  nextReservation,
  ROOM_OBJECT_NEAR,
  type MetaResponse,
  type ReservationView,
  type RoomId,
} from '@va/shared';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { api, errorText, session } from '../api';
import { bgm } from '../audio/bgm';
import { DUCK_INITIAL, duckReducer } from '../audio/videoDuck';
import {
  cameraView,
  clampCamera,
  dragCamera,
  FREE_LOOK_MS,
  followTarget,
  isTap,
  LONG_PRESS_MS,
  mobileMargin,
  pinchCamera,
  shouldReturn,
  stepFollow,
  TAP_SLOP,
  worldPixelRatio,
  worldView,
  zoomAt,
  zoomLimits,
  type Camera,
  type Pt,
} from '../game/camera';
import { drawCrossedArms } from '../game/character';
import { ArcadeClient } from '../game/client';
import { fitView, fromScreen, inPoly, type View } from '../game/iso';
import { cabinetFront, drawScene, drawStatic, type PlayerPose, type SceneHits, type SceneUi, type WorldLayer } from '../game/render';
import { loadMobilePrefs, saveMobilePrefs, type Layout } from '../layout';
import { AdminDialog } from './AdminDialog';
import { Badges } from './Badges';
import { BgmControls } from './BgmControls';
import { CabinetDialog } from './CabinetDialog';
import { ChatForm, ChatPanel } from './ChatPanel';
import { CraneDialog } from './CraneDialog';
import { GameDialog } from './GameDialog';
import { ChatPeek, ChatSheet, MobileMenu } from './Mobile';
import { NoteDialog } from './NoteDialog';
import { PosterDialog } from './PosterDialog';
import { RankingDialog } from './RankingDialog';
import { RequestDialog } from './RequestDialog';
import { ReservationDialog, RoomDoorDialog } from './ReservationDialog';
import { RoomAdminDialog, RoomClock } from './RoomAdmin';
import { ScreenDialog } from './ScreenDialog';
import { WatchView } from './WatchView';

/** 近くの筐体とみなす距離（マス。チェビシェフ距離） */
const NEAR = 2;

type Dialog =
  | { kind: 'cabinet'; id: number }
  | { kind: 'screen' }
  | { kind: 'admin' }
  | { kind: 'crane'; id: number }
  | { kind: 'posters'; id: number | null }
  | { kind: 'note' }
  | { kind: 'request' }
  | { kind: 'reserve'; initial?: 'calendar' | 'list' }
  | { kind: 'door' }
  | { kind: 'roomAdmin' }
  /** v0.6.0：ゲーム筐体（id = floor.json の game の番号）・ランキング */
  | { kind: 'game'; id: number }
  | { kind: 'ranking'; game: string }
  | null;

type Hit =
  | { kind: 'cabinet'; id: number }
  | { kind: 'crane'; id: number }
  | { kind: 'screen' }
  | { kind: 'board'; poster: number | null }
  | { kind: 'note' }
  | { kind: 'request' }
  | { kind: 'door' }
  | { kind: 'calendar' }
  | { kind: 'game'; id: number }
  | { kind: 'ranking'; game: string }
  | { kind: 'floor'; x: number; y: number };

/** 遠くからクリックして歩いている：着いたら開く窓（クレーンゲーム・ゲーム筐体・ノート・要望箱・予約部屋の扉） */
type Pending = { kind: 'crane'; id: number } | { kind: 'game'; id: number } | { kind: 'note' } | { kind: 'request' } | { kind: 'door' };

/** 置いてある物の場所と「近い」の距離 */
const pendingSpot = (pend: Pending) =>
  pend.kind === 'crane'
    ? craneSpot(pend.id)
    : pend.kind === 'game'
      ? gameSpot(pend.id)
      : pend.kind === 'note'
      ? noteSpots()[0]
      : pend.kind === 'door'
        ? doorSpots()[0]
        : requestBoxSpots()[0];
const pendingNear = (pend: Pending) =>
  pend.kind === 'crane' ? CRANE_NEAR : pend.kind === 'game' ? GAME_NEAR : pend.kind === 'door' ? ROOM_OBJECT_NEAR : NOTE_NEAR;
/** 着いたら開く窓 */
const pendingDialog = (pend: Pending): Dialog =>
  pend.kind === 'crane' ? { kind: 'crane', id: pend.id } : pend.kind === 'game' ? { kind: 'game', id: pend.id } : { kind: pend.kind };

/** 扉の上の札（予約部屋の今と次。v0.5.0） */
/** PC の下のバーの操作の説明（狭い画面では省略・隠すので、全文を title にも入れる。v0.5.1） */
const HELP_TEXT =
  '移動：床をクリック / WASD・矢印キー　筐体：クリックで視聴・使う　大画面：クリックで配信中の一覧　近づく：配信が小さく流れます（音なし）　' +
  'クレーンゲーム：右奥・クリックで遊ぶ　掲示板：左の壁・大会やイベントの告知';

const doorSignText = (room: RoomId, list: ReservationView[], now: number): { sign: string; open: boolean; banner?: string } => {
  const active = activeReservation(list, now);
  if (room === 'reserved')
    return {
      sign: '🚪 オープン部屋へ',
      open: true,
      banner: active ? `🔑 予約部屋「${active.title}」〜${jstTime(active.endAt)}（予約：${active.host}）` : '🔑 予約部屋',
    };
  if (active) return { sign: `🔑 予約部屋：「${active.title}」開催中 残り${Math.max(1, Math.ceil((active.endAt - now) / 60000))}分`, open: true };
  const next = nextReservation(list, now);
  if (!next) return { sign: '🔑 予約部屋（本日の予約なし）', open: false };
  const today = jstDayStart(now) === jstDayStart(next.startAt);
  return { sign: `🔑 予約部屋　${today ? '本日' : jstDate(next.startAt)} ${jstTime(next.startAt)}〜「${next.title}」`, open: false };
};

/** ベガ立ちのボタンの絵（頭上の印と同じ。v0.6.0） */
const StanceIcon = () => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(32 * dpr);
    c.height = Math.round(32 * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCrossedArms(ctx, 16, 17, 0.92, false);
  }, []);
  return <canvas ref={ref} className="stance-icon" style={{ width: 32, height: 32 }} aria-hidden="true" />;
};

/** スマホの指の操作（DESIGN §11.4） */
type Gesture =
  | { kind: 'one'; id: number; sx: number; sy: number; start: Camera; moved: number; dragging: boolean; tappable: boolean; timer?: number }
  | { kind: 'pinch'; a: number; b: number; a0: Pt; b0: Pt; start: Camera };

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export const ArcadePage = ({
  meta,
  layout,
  onNeedEntry,
  onEditProfile,
  onLeft,
  initialRoom = 'open',
}: {
  meta: MetaResponse | null;
  layout: Layout;
  /** v0.5.0：入る部屋（入店の画面で予約部屋の合言葉を入れたとき・予約部屋で再読み込みしたとき reserved） */
  initialRoom?: RoomId;
  onNeedEntry: (message?: string) => void;
  onEditProfile: () => void;
  /** 退店した（入店の画面へ） */
  onLeft: () => void;
}) => {
  const client = useMemo(() => new ArcadeClient(initialRoom), []);
  const room = client.room;
  useSyncExternalStore(client.subscribe, client.getVersion);
  const mobile = layout.mobile;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const embedRef = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [watching, setWatching] = useState<number | null>(null);
  const [embed, setEmbed] = useState<{ id: number; videoId: string } | null>(null);
  const [cursor, setCursor] = useState('default');
  // スマホ：メニュー・チャットのシート・見回し中か・設定
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [freeLook, setFreeLook] = useState(false);
  const [prefs, setPrefs] = useState(loadMobilePrefs);
  // 横向き：右のチャットの欄をたたむ（たたむと店内が広くなる。設定に残す）
  const chatCollapsed = prefs.chatCollapsed;
  const setChatCollapsed = (on: boolean) => {
    const p = { ...prefs, chatCollapsed: on };
    setPrefs(p);
    saveMobilePrefs(p);
  };

  // 描画のループから読む値（React の再描画を待たない）
  const live = useRef({
    view: null as View | null,
    hits: null as SceneHits | null,
    mouse: null as { x: number; y: number } | null,
    hoverCab: null as number | null,
    hoverScreen: false,
    hoverCrane: null as number | null,
    hoverBoard: false,
    hoverPoster: null as number | null,
    hoverNote: false,
    hoverRequest: false,
    hoverDoor: false,
    hoverCalendar: false,
    hoverGame: null as number | null,
    hoverRanking: null as number | null,
    /** 遠くのクレーンゲーム・ゲーム筐体・ノート・要望箱・扉をクリックした：着いたら窓を開く */
    pending: null as Pending | null,
    target: null as SceneUi['target'],
    keys: new Set<string>(),
    lastKeySend: 0,
    keyWait: null as { at: number; end: string } | null,
    embedAllowed: true,
    embedId: null as number | null,
    // ---- スマホ（DESIGN §11.4）
    mobile: false,
    /** 近くの配信を動画にせず、サムネイルの枠にする */
    embedThumb: false,
    cam: null as Camera | null,
    /** 初めのフレームで自分の所へ飛ぶ */
    snap: true,
    /** 見回し中：この時刻を過ぎたら自分の所へ戻る（指が触れている間は Infinity）。null = 自分に追従 */
    freeUntil: null as number | null,
    pointers: new Map<number, Pt>(),
    gesture: null as Gesture | null,
    /** 最後に倍率を変えた時刻（止まってから床・壁を描き直す） */
    lastZoomAt: 0,
    world: null as WorldLayer | null,
    size: { w: 0, h: 0 },
  });
  live.current.embedAllowed = dialog === null && watching === null;
  live.current.mobile = mobile;
  live.current.embedThumb = mobile && !prefs.embed;
  const watchingRef = useRef<number | null>(null);
  watchingRef.current = watching;

  useEffect(() => {
    client.connect();
    return () => client.close();
  }, [client]);
  // v0.5.0：部屋が変わった（扉・予約の時間の終わり）。開いている窓・視聴画面を閉じ、再読み込みでこの部屋に入り直せるよう覚える
  useEffect(() => {
    if (!client.connected) return;
    session.set('va:room', room);
    setDialog((d) => (d?.kind === 'reserve' ? d : null));
    setWatching(null);
    live.current.pending = null;
  }, [client.roomSeq]);

  // ---- 店内の BGM：この画面が出ている間だけ鳴らす。入店のボタンで鳴らせるようになっていなければ（再読み込みで自動入店など）、
  // 最初のクリック・キー入力で鳴らし始める（ブラウザの自動再生の制限）
  useEffect(() => {
    bgm.setPlaylist(meta?.bgm);
  }, [meta]);
  useEffect(() => {
    bgm.setActive(true);
    const kick = () => {
      if (!bgm.getState().unlocked) bgm.unlock();
    };
    window.addEventListener('pointerdown', kick, true);
    window.addEventListener('keydown', kick, true);
    return () => {
      window.removeEventListener('pointerdown', kick, true);
      window.removeEventListener('keydown', kick, true);
      bgm.setActive(false);
    };
  }, []);
  // 視聴画面の動画が再生を始めたら BGM をフェードアウトして止め、店内に戻ったらフェードインして続きから（videoDuck.ts）。
  // 一時停止・終了だけでは戻さない。状態が届かなければ視聴画面を開いて数秒で止める。近くの筐体の小さな配信は関係しない
  const [duck, duckDispatch] = useReducer(duckReducer, DUCK_INITIAL);
  useEffect(() => {
    duckDispatch(watching !== null ? { type: 'open', at: Date.now() } : { type: 'close' });
  }, [watching]);
  useEffect(() => {
    if (!duck.watching || duck.ducked || duck.gotState) return;
    const t = window.setInterval(() => duckDispatch({ type: 'tick', at: Date.now() }), 500);
    return () => window.clearInterval(t);
  }, [duck.watching, duck.ducked, duck.gotState]);
  useEffect(() => {
    bgm.setVideoDucked(duck.ducked);
  }, [duck.ducked]);
  useEffect(() => () => bgm.setVideoDucked(false), []);
  const duckRef = useRef(duck);
  duckRef.current = duck;
  const onPlayerState = useCallback((state: number) => duckDispatch({ type: 'player', state }), []);
  // 管理者のお知らせが増えたらチャイム（最初に受け取った分・消えた分では鳴らさない。消音なら鳴らさない）
  const noticeMax = useRef<number | null>(null);
  useEffect(() => {
    if (!client.connected) return;
    const max = client.notices.reduce((a, n) => Math.max(a, n.id), 0);
    if (noticeMax.current !== null && max > noticeMax.current) bgm.chime();
    noticeMax.current = Math.max(max, noticeMax.current ?? 0);
  }, [client.notices, client.connected]);

  // 入り直しが要るエラー
  useEffect(() => {
    const f = client.fatal;
    if (f && (f.code === 'need-enter' || f.code === 'banned' || f.code === 'no-key')) onNeedEntry(f.text);
  }, [client.fatal, onNeedEntry, client]);

  // 視聴中の筐体の配信が外れたら店内に戻る
  const watchedCab = watching !== null ? client.cabinets.get(watching) : undefined;
  useEffect(() => {
    if (watching !== null && !watchedCab?.videoId) setWatching(null);
  }, [watching, watchedCab?.videoId]);

  // スマホ：近くの配信を動画で出すかを変えたら、埋め込みを決め直す
  useEffect(() => {
    live.current.embedId = -1;
  }, [prefs.embed, mobile]);

  // ---- 描画のループ（PC と スマホで canvas が作り直されるので、レイアウトが変わったら作り直す）
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let staticLayer: HTMLCanvasElement | null = null;
    let raf = 0;
    let last = performance.now();
    const L0 = live.current;
    L0.world = null;
    L0.snap = true;
    L0.freeUntil = null;
    L0.gesture = null;
    L0.pointers.clear();

    /** スマホ：店全体の床・壁を拡大率 s で描いた大きな canvas */
    const buildWorld = (s: number) => {
      const wv = worldView(FLOOR, s);
      const pr = worldPixelRatio(wv, window.devicePixelRatio || 1);
      const c = document.createElement('canvas');
      c.width = Math.ceil(wv.w * pr);
      c.height = Math.ceil(wv.h * pr);
      const x = c.getContext('2d')!;
      x.setTransform(pr, 0, 0, pr, 0, 0);
      drawStatic(x, wv, FLOOR, client.room);
      live.current.world = { canvas: c, view: wv };
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const L = live.current;
      L.size = { w, h };
      if (L.mobile) {
        // 倍率は「店全体が入る倍率」に対する割合を保つ（回したとき）
        const lim = zoomLimits(w, h, FLOOR);
        const prev = L.cam;
        const prevFit = prev && L.view ? zoomLimits(L.view.w, L.view.h, FLOOR).fit : null;
        const s = prev && prevFit ? lim.fit * (prev.s / prevFit) : lim.def;
        L.cam = clampCamera({ cx: prev?.cx ?? 0, cy: prev?.cy ?? 0, s }, w, h, FLOOR, mobileMargin(w, h));
        L.view = cameraView(L.cam, w, h);
        staticLayer = null;
        return;
      }
      const v = fitView(w, h, FLOOR);
      L.view = v;
      staticLayer = document.createElement('canvas');
      staticLayer.width = canvas.width;
      staticLayer.height = canvas.height;
      const sctx = staticLayer.getContext('2d')!;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStatic(sctx, v, FLOOR, client.room);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    // スマホ：指を離したあとにブラウザが送る click（互換のための合成）を止める。タップで開いた窓の背景にその click が届いて、
    // 開いたばかりの窓がすぐ閉じてしまうため（タップの処理は pointerup でしている）
    const noGhost = (e: TouchEvent) => {
      if (live.current.mobile && e.cancelable) e.preventDefault();
    };
    canvas.addEventListener('touchend', noGhost, { passive: false });

    // 画面の確認用（URL の末尾に #dev のときだけ）：筐体・大画面・床のマスのページ上の位置
    if (location.hash.includes('dev')) {
      const page = (p: { x: number; y: number }) => {
        const r = canvas.getBoundingClientRect();
        return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
      };
      const center = (pts: Array<{ x: number; y: number }>) =>
        page({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
      (window as unknown as Record<string, unknown>).__va = {
        cab: (id: number) => {
          const c = live.current.hits?.cabinets.find((x) => x.id === id);
          return c ? center(c.poly) : null;
        },
        crane: (id: number) => {
          const c = live.current.hits?.cranes.find((x) => x.id === id);
          return c ? center(c.poly) : null;
        },
        board: () => (live.current.hits ? center(live.current.hits.board) : null),
        poster: (i: number) => {
          const c = live.current.hits?.posters[i];
          return c ? center(c.poly) : null;
        },
        note: () => (live.current.hits?.notes[0] ? center(live.current.hits.notes[0]) : null),
        requestBox: () => (live.current.hits?.requestBoxes[0] ? center(live.current.hits.requestBoxes[0]) : null),
        door: () => (live.current.hits?.doors[0] ? center(live.current.hits.doors[0]) : null),
        calendar: () => (live.current.hits?.calendars[0] ? center(live.current.hits.calendars[0]) : null),
        // v0.6.0：ゲーム筐体・ランキングの立て看板（i 番目（0 から。手前のものが先）か、ゲームの id '2048' / 'columns'）
        game: (i: number | string = 0) => {
          const list = live.current.hits?.games ?? [];
          const g = typeof i === 'string' ? list.find((x) => x.game === i) : list[i];
          return g ? center(g.poly) : null;
        },
        ranking: (i: number | string = 0) => {
          const list = live.current.hits?.rankings ?? [];
          const g = typeof i === 'string' ? list.find((x) => x.game === i) : list[i];
          return g ? center(g.poly) : null;
        },
        rankings: () => client.rankings,
        stance: () => client.me()?.stance ?? null,
        room: () => client.room,
        screen: () => (live.current.hits ? center(live.current.hits.screen) : null),
        bgm: () => bgm.debug(),
        // 視聴画面の動画の状態が届いたことにする（ヘッドレスでは埋め込みが再生しないため）
        playerState: (n: number) => duckDispatch({ type: 'player', state: n }),
        duck: () => duckRef.current,
        bgmApi: bgm,
        bgmRender: (id: string, loops?: number) => import('../audio/check').then((m) => m.renderSongOffline(id, loops)),
        bgmWav: (id: string) => import('../audio/check').then((m) => m.renderSongWav(id)),
        bgmSeams: (intro: string | null, body: string, introSec?: number | null, bodySec?: number | null) =>
          import('../audio/check').then((m) => m.renderFileSeams(intro, body, introSec, bodySec)),
        watch: (id: number) => startWatchRef.current(id),
        stopWatch: () => stopWatchRef.current(),
        tile: (x: number, y: number) => {
          const v = live.current.view;
          return v ? page({ x: v.ox + (x - y) * 32 * v.s, y: v.oy + (x + y + 1) * 16 * v.s }) : null;
        },
        // スマホ：カメラ・自分の位置（タッチの操作の確認用）
        cam: () => {
          const L = live.current;
          if (!L.cam) return null;
          const lim = zoomLimits(L.size.w, L.size.h, FLOOR);
          return { ...L.cam, free: L.freeUntil !== null, min: lim.min, max: lim.max, def: lim.def };
        },
        me: () => {
          const m = client.me();
          if (!m) return null;
          const end = m.path[m.path.length - 1];
          return { x: m.rx, y: m.ry, to: end };
        },
        open: (d: Dialog) => setDialog(d),
        // ページの点（clientX, clientY）の当たり判定・通れるマスか（届くかの確認用）
        pick: (x: number, y: number) => {
          const r = canvas.getBoundingClientRect();
          return pickRef.current(x - r.left, y - r.top);
        },
        passable: (x: number, y: number) => isPassable(FLOOR, x, y),
        canvasRect: () => {
          const r = canvas.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        },
      };
    }

    const keyMove = (now: number) => {
      const L = live.current;
      if (!L.keys.size || !L.embedAllowed) return;
      let a = 0;
      let b = 0;
      for (const k of L.keys) {
        const d = KEYS[k];
        if (d) {
          a += d[0];
          b += d[1];
        }
      }
      a = Math.sign(a);
      b = Math.sign(b);
      if (!a && !b) return;
      // 画面の向き → 床の向き（右 = (+1,-1)、下 = (+1,+1)）
      const gx = Math.sign(a + b);
      const gy = Math.sign(b - a);
      const me = client.me();
      if (!me) return;
      const end = me.path[me.path.length - 1];
      const endKey = `${end.x},${end.y},${me.startedAt}`;
      // 前に送った指示の返事（move）を待つ
      if (L.keyWait && L.keyWait.end === endKey && now - L.keyWait.at < 400) return;
      const pos = positionAt(me.path, me.startedAt, client.serverNow());
      const remainMs = pos.done ? 0 : ((me.path.length - 1 - pos.seg - pos.frac) / 4) * 1000;
      if (remainMs > 90 || now - L.lastKeySend < 100) return;
      const tries: Array<[number, number]> = [[gx, gy]];
      if (gx && gy) tries.push([gx, 0], [0, gy]);
      for (const [dx, dy] of tries) {
        const to = { x: end.x + dx, y: end.y + dy };
        if (isPassable(FLOOR, to.x, to.y) && isStep(FLOOR, end, to)) {
          client.send({ type: 'goto', x: to.x, y: to.y });
          L.lastKeySend = now;
          L.keyWait = { at: now, end: endKey };
          return;
        }
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      let v = L.view;
      if (v) {
        keyMove(now);
        client.prune(now);
        const sNow = client.serverNow();
        const k = 1 - Math.exp(-dt * 16);
        const poses: PlayerPose[] = [];
        for (const p of client.players.values()) {
          const pos = positionAt(p.path, p.startedAt, sNow);
          const dx = pos.x - p.rx;
          const dy = pos.y - p.ry;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            p.rx = pos.x;
            p.ry = pos.y;
          } else {
            p.rx += dx * k;
            p.ry += dy * k;
          }
          if (pos.dir) p.dir = pos.dir === 1 ? 1 : -1;
          poses.push({ p, x: p.rx, y: p.ry, walking: !pos.done || Math.hypot(dx, dy) > 0.04 });
        }

        const me = client.me();
        // スマホ：カメラを自分に追従させる（見回し中は止める。指を離して数秒で戻る）
        if (L.mobile && L.cam) {
          const { w, h } = L.size;
          if (shouldReturn(L.freeUntil, now, L.pointers.size > 0)) {
            L.freeUntil = null;
            setFreeLook(false);
          }
          if (me && L.freeUntil === null) {
            const t = followTarget(me.rx, me.ry);
            L.cam = L.snap ? { cx: t.x, cy: t.y, s: L.cam.s } : stepFollow(L.cam, t, dt);
            L.snap = false;
          }
          L.cam = clampCamera(L.cam, w, h, FLOOR, mobileMargin(w, h));
          v = cameraView(L.cam, w, h);
          L.view = v;
          // 床・壁：倍率が変わったら、止まってから描き直す（それまでは拡大して貼る）
          if (!L.world || (Math.abs(L.world.view.s - L.cam.s) > 1e-3 && now - L.lastZoomAt > 180 && L.pointers.size < 2)) buildWorld(L.cam.s);
        }

        // 近くの筐体：いちばん近い配信中の筐体（2 マス以内）を埋め込み、宣伝はカーソル優先
        let embedCab: number | null = null;
        let nearCab: number | null = null;
        if (me) {
          let bestLive = Infinity;
          let bestAny = Infinity;
          for (const spot of FLOOR.cabinets) {
            const c = client.cabinets.get(spot.id);
            if (!c) continue;
            const cheb = cabinetDistance({ x: me.rx, y: me.ry }, spot);
            if (cheb > NEAR + 0.01) continue;
            const eu = Math.hypot(me.rx - spot.x, me.ry - spot.y);
            if (c.videoId && eu < bestLive) {
              bestLive = eu;
              embedCab = spot.id;
            }
            if ((c.videoId || c.owned || c.eventName) && eu < bestAny) {
              bestAny = eu;
              nearCab = spot.id;
            }
          }
        }
        if (!L.embedAllowed) embedCab = null;
        // 遠くのクレーンゲーム・ノート・要望箱をクリックして歩いている：着いたら（2 マス以内で止まったら）窓を開く
        if (L.pending !== null && me) {
          const pend = L.pending;
          const spot = pendingSpot(pend);
          const near = pendingNear(pend);
          const pos = positionAt(me.path, me.startedAt, client.serverNow());
          if (spot && pos.done && cabinetDistance({ x: Math.round(me.rx), y: Math.round(me.ry) }, spot) <= near) {
            L.pending = null;
            setDialog((d) => d ?? pendingDialog(pend));
          }
        }
        const hoverCfg =
          L.hoverCab !== null && (() => {
            const c = client.cabinets.get(L.hoverCab!);
            return !!c && (!!c.videoId || c.owned || !!c.eventName);
          })();
        const ui: SceneUi = {
          myPid: client.you?.pid ?? null,
          hoverCab: L.hoverCab,
          hoverScreen: L.hoverScreen,
          promoCab: watchingRef.current === null ? (hoverCfg ? L.hoverCab : nearCab) : null,
          embedCab,
          target: L.target,
          hoverCrane: L.hoverCrane,
          hoverBoard: L.hoverBoard,
          hoverPoster: L.hoverPoster,
          hoverNote: L.hoverNote,
          hoverRequest: L.hoverRequest,
          promoDock: L.mobile,
          embedThumb: L.embedThumb,
          room: client.room,
          hoverDoor: L.hoverDoor,
          hoverCalendar: L.hoverCalendar,
          hoverGame: L.hoverGame,
          hoverRanking: L.hoverRanking,
          rankings: client.rankings,
        };
        {
          const d = doorSignText(client.room, client.reservations, sNow);
          ui.doorSign = d.sign;
          ui.doorOpen = d.open;
          // PC は上のバーの下の帯（.roombar）に同じ札を出すので、店内の上の帯はスマホだけ（v0.5.1）
          ui.roomBanner = L.mobile ? d.banner : undefined;
        }
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        L.hits = drawScene(ctx, v, L.mobile ? L.world : staticLayer, client, poses, ui, now);

        // 埋め込みの位置（同時に 1 つだけ。スマホの既定はサムネイルの枠だけで、動画は出さない）
        if (embedCab !== L.embedId) {
          L.embedId = embedCab;
          const c = embedCab !== null ? client.cabinets.get(embedCab) : undefined;
          setEmbed(c?.videoId && !L.embedThumb ? { id: c.id, videoId: c.videoId } : null);
        }
        const el = embedRef.current;
        const r = L.hits.embedRect;
        if (el && r) {
          el.style.transform = `translate(${r.x}px, ${r.y}px)`;
          el.style.width = `${r.w}px`;
          el.style.height = `${r.h}px`;
          el.style.setProperty('--k', String(r.w / 356));
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('touchend', noGhost);
    };
  }, [client, mobile, room]);

  // 筐体の配信が変わったら埋め込みも差し替え
  const embedCabVideo = embed ? client.cabinets.get(embed.id)?.videoId : null;
  useEffect(() => {
    if (embed && embedCabVideo !== embed.videoId) {
      live.current.embedId = null;
      setEmbed(null);
    }
  }, [embed, embedCabVideo]);

  // ---- キーボード（入力欄に文字を打っているときは使わない）
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (KEYS[e.code]) {
        live.current.keys.add(e.code);
        live.current.pending = null;
        e.preventDefault();
      }
      if (e.code === 'Escape') setDialog(null);
    };
    const up = (e: KeyboardEvent) => live.current.keys.delete(e.code);
    const blur = () => live.current.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ---- マウス（PC）・タップ（スマホ）の当たり判定
  const pick = (x: number, y: number): Hit | null => {
    const L = live.current;
    if (!L.hits || !L.view) return null;
    // 上に重ねて描くもの（宣伝の吹き出し・近くの筐体の小さな配信）を先に見る。どちらもその筐体のクリックとして扱う
    // （小さな配信の枠は pointer-events: none でクリックが canvas に届くので、ここで拾わないと下の床へ歩いてしまう）
    const inRect = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (L.hits.promo && inRect(L.hits.promo)) return { kind: 'cabinet', id: L.hits.promo.id };
    if (L.hits.embedRect && L.hits.embedCab !== null && inRect(L.hits.embedRect)) return { kind: 'cabinet', id: L.hits.embedCab };
    // 筐体とクレーンゲーム（手前のものが先。重ならない）
    for (const c of L.hits.cabinets) if (inPoly(c.poly, x, y)) return { kind: 'cabinet', id: c.id };
    for (const c of L.hits.cranes) if (inPoly(c.poly, x, y)) return { kind: 'crane', id: c.id };
    // ゲーム筐体・ランキングの立て看板（v0.6.0）
    for (const g of L.hits.games) if (inPoly(g.poly, x, y)) return { kind: 'game', id: g.id };
    for (const g of L.hits.rankings) if (inPoly(g.poly, x, y)) return { kind: 'ranking', game: g.game };
    // ノートの机・要望箱（v0.4.0）
    if (L.hits.notes.some((p) => inPoly(p, x, y))) return { kind: 'note' };
    if (L.hits.requestBoxes.some((p) => inPoly(p, x, y))) return { kind: 'request' };
    // 予約部屋の扉・予約カレンダー（v0.5.0）
    if (L.hits.doors.some((p) => inPoly(p, x, y))) return { kind: 'door' };
    if (L.hits.calendars.some((p) => inPoly(p, x, y))) return { kind: 'calendar' };
    if (inPoly(L.hits.screen, x, y)) return { kind: 'screen' };
    // 掲示板（壁の上。紙をクリックしたらそのポスター）
    if (inPoly(L.hits.board, x, y)) {
      const p = L.hits.posters.find((q) => inPoly(q.poly, x, y));
      return { kind: 'board', poster: p ? p.id : null };
    }
    const g = fromScreen(L.view, x, y);
    const tx = Math.floor(g.gx);
    const ty = Math.floor(g.gy);
    if (tx < 0 || ty < 0 || tx >= FLOOR.cols || ty >= FLOOR.rows) return null;
    return { kind: 'floor', x: tx, y: ty };
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const localXY = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const local = (e: React.MouseEvent) => localXY(e.clientX, e.clientY);
  const hover = (p: { x: number; y: number }) => {
    const L = live.current;
    L.mouse = p;
    const hit = pick(p.x, p.y);
    L.hoverCab = hit?.kind === 'cabinet' ? hit.id : null;
    L.hoverScreen = hit?.kind === 'screen';
    L.hoverCrane = hit?.kind === 'crane' ? hit.id : null;
    L.hoverBoard = hit?.kind === 'board';
    L.hoverPoster = hit?.kind === 'board' ? hit.poster : null;
    L.hoverNote = hit?.kind === 'note';
    L.hoverRequest = hit?.kind === 'request';
    L.hoverDoor = hit?.kind === 'door';
    L.hoverCalendar = hit?.kind === 'calendar';
    L.hoverGame = hit?.kind === 'game' ? hit.id : null;
    L.hoverRanking = hit?.kind === 'ranking' ? (live.current.hits?.rankings.find((r) => r.game === hit.game)?.id ?? null) : null;
    const want =
      hit && hit.kind !== 'floor' ? 'pointer' : hit?.kind === 'floor' && isPassable(FLOOR, hit.x, hit.y) ? 'crosshair' : 'default';
    if (want !== cursor) setCursor(want);
  };
  const onMove = (e: React.MouseEvent) => hover(local(e));
  const onLeave = () => {
    const L = live.current;
    L.hoverCab = null;
    L.hoverScreen = false;
    L.hoverCrane = null;
    L.hoverBoard = false;
    L.hoverPoster = null;
    L.hoverNote = false;
    L.hoverRequest = false;
    L.hoverDoor = false;
    L.hoverCalendar = false;
    L.hoverGame = null;
    L.hoverRanking = null;
  };
  /** 近ければ窓を開く。遠ければ前のマスまで歩いてから開く（クレーンゲーム DESIGN §8.1・ノート §12.1・要望箱 §13.1） */
  const openNear = (pend: Pending) => {
    const spot = pendingSpot(pend);
    const near = pendingNear(pend);
    const me = client.me();
    if (!spot || !me) return;
    const open = () => setDialog(pendingDialog(pend));
    if (cabinetDistance({ x: Math.round(me.rx), y: Math.round(me.ry) }, spot) <= near) {
      open();
      return;
    }
    // 前（手前）のマス。通れなければまわりの通れるマス
    const cands = [
      { x: spot.x, y: spot.y + 1 },
      { x: spot.x + 1, y: spot.y },
      { x: spot.x - 1, y: spot.y + 1 },
      { x: spot.x + 1, y: spot.y + 1 },
      { x: spot.x - 1, y: spot.y },
      { x: spot.x, y: spot.y - 1 },
    ].filter((p) => isPassable(FLOOR, p.x, p.y));
    const to = cands[0];
    if (!to) return;
    client.send({ type: 'goto', x: to.x, y: to.y });
    live.current.target = { x: to.x, y: to.y, at: performance.now() };
    live.current.pending = pend;
    client.showToast(
      pend.kind === 'crane'
        ? 'クレーンゲームまで歩いています…'
        : pend.kind === 'game'
          ? `${gameInfo(gameSpot(pend.id)?.game ?? '')?.title ?? 'ゲーム'} の筐体まで歩いています…`
          : pend.kind === 'note'
          ? 'ノートまで歩いています…'
          : pend.kind === 'door'
            ? '扉まで歩いています…'
            : '要望箱まで歩いています…',
    );
  };
  /** クリック・タップしたもの */
  const act = (hit: Hit | null) => {
    if (!hit) return;
    if (hit.kind !== 'crane' && hit.kind !== 'game' && hit.kind !== 'note' && hit.kind !== 'request' && hit.kind !== 'door') live.current.pending = null;
    if (hit.kind === 'cabinet') setDialog({ kind: 'cabinet', id: hit.id });
    else if (hit.kind === 'crane') openNear({ kind: 'crane', id: hit.id });
    else if (hit.kind === 'game') openNear({ kind: 'game', id: hit.id });
    // ランキングは遠くても歩かずに開く
    else if (hit.kind === 'ranking') setDialog({ kind: 'ranking', game: hit.game });
    else if (hit.kind === 'note') openNear({ kind: 'note' });
    else if (hit.kind === 'request') openNear({ kind: 'request' });
    else if (hit.kind === 'door') openNear({ kind: 'door' });
    else if (hit.kind === 'calendar') setDialog({ kind: 'reserve' });
    else if (hit.kind === 'screen') setDialog({ kind: 'screen' });
    else if (hit.kind === 'board') setDialog({ kind: 'posters', id: hit.poster });
    else if (isPassable(FLOOR, hit.x, hit.y)) {
      client.send({ type: 'goto', x: hit.x, y: hit.y });
      live.current.target = { x: hit.x, y: hit.y, at: performance.now() };
      // スマホ：歩き出したらカメラは自分に戻す
      if (live.current.mobile && live.current.freeUntil !== null) {
        live.current.freeUntil = null;
        setFreeLook(false);
      }
    }
  };
  const onClick = (e: React.MouseEvent) => {
    const p = local(e);
    act(pick(p.x, p.y));
  };

  // ---- スマホ：指の操作（タップ = 今の当たり判定・1 本指のドラッグ = 見回し・2 本指 = ピンチ）。DESIGN §11.4
  /** 指の下の床のマスへ歩く（物の当たり判定を見ない。長押し：筐体などの陰になった床へ行くため） */
  const walkUnderFinger = (x: number, y: number): boolean => {
    const L = live.current;
    if (!L.view) return false;
    const g = fromScreen(L.view, x, y);
    const tx = Math.floor(g.gx);
    const ty = Math.floor(g.gy);
    if (!isPassable(FLOOR, tx, ty)) return false;
    L.pending = null;
    client.send({ type: 'goto', x: tx, y: ty });
    L.target = { x: tx, y: ty, at: performance.now() };
    if (L.freeUntil !== null) {
      L.freeUntil = null;
      setFreeLook(false);
    }
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 振動できない端末 */
    }
    return true;
  };
  const clearLongPress = (g: Gesture | null) => {
    if (g?.kind === 'one' && g.timer !== undefined) {
      window.clearTimeout(g.timer);
      g.timer = undefined;
    }
  };
  const startFree = () => {
    const L = live.current;
    if (L.freeUntil === null) setFreeLook(true);
    L.freeUntil = Infinity;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const L = live.current;
    if (!L.cam || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* すでに離れた */
    }
    const p = localXY(e.clientX, e.clientY);
    L.pointers.set(e.pointerId, p);
    if (L.pointers.size === 1) {
      const g: Gesture = { kind: 'one', id: e.pointerId, sx: p.x, sy: p.y, start: { ...L.cam }, moved: 0, dragging: false, tappable: true };
      // 長押し：動かさずに LONG_PRESS_MS → 指の下の床へ歩く（タップにはしない）
      g.timer = window.setTimeout(() => {
        g.timer = undefined;
        const q = L.pointers.get(g.id);
        if (L.gesture === g && g.tappable && q && walkUnderFinger(q.x, q.y)) g.tappable = false;
      }, LONG_PRESS_MS);
      L.gesture = g;
    } else if (L.pointers.size === 2) {
      clearLongPress(L.gesture);
      const [a, b] = [...L.pointers.keys()];
      L.gesture = { kind: 'pinch', a, b, a0: { ...L.pointers.get(a)! }, b0: { ...L.pointers.get(b)! }, start: { ...L.cam } };
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const L = live.current;
    const p = localXY(e.clientX, e.clientY);
    if (!L.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') hover(p);
      return;
    }
    L.pointers.set(e.pointerId, p);
    const g = L.gesture;
    if (!g || !L.cam) return;
    const { w, h } = L.size;
    if (g.kind === 'one' && g.id === e.pointerId) {
      g.moved = Math.max(g.moved, Math.hypot(p.x - g.sx, p.y - g.sy));
      if (!g.dragging && g.moved > TAP_SLOP) {
        clearLongPress(g);
        g.dragging = true;
        g.tappable = false;
        // 動き始めた所から追う（指が少し動いてからドラッグになったときに飛ばない）
        g.sx = p.x;
        g.sy = p.y;
        g.start = { ...L.cam };
        startFree();
      }
      if (g.dragging) L.cam = clampCamera(dragCamera(g.start, p.x - g.sx, p.y - g.sy), w, h, FLOOR, mobileMargin(w, h));
    } else if (g.kind === 'pinch') {
      const a1 = L.pointers.get(g.a);
      const b1 = L.pointers.get(g.b);
      if (!a1 || !b1) return;
      const lim = zoomLimits(w, h, FLOOR);
      L.cam = clampCamera(pinchCamera(g.start, g.a0, g.b0, a1, b1, w, h, lim.min, lim.max), w, h, FLOOR, mobileMargin(w, h));
      L.lastZoomAt = performance.now();
      startFree();
    }
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const L = live.current;
    if (!L.pointers.has(e.pointerId)) return;
    const g = L.gesture;
    const p = localXY(e.clientX, e.clientY);
    const tap = e.type === 'pointerup' && g?.kind === 'one' && g.id === e.pointerId && g.tappable && isTap(g.moved, false);
    if (g?.kind === 'one' && g.id === e.pointerId) clearLongPress(g);
    L.pointers.delete(e.pointerId);
    if (g?.kind === 'pinch') {
      // 1 本の指が残ったら、そのまま見回しに（タップにはしない）
      const rest = [...L.pointers.entries()][0];
      L.gesture =
        rest && L.cam ? { kind: 'one', id: rest[0], sx: rest[1].x, sy: rest[1].y, start: { ...L.cam }, moved: 99, dragging: true, tappable: false } : null;
    } else if (!L.pointers.size) L.gesture = null;
    if (!L.pointers.size && L.freeUntil === Infinity) L.freeUntil = performance.now() + FREE_LOOK_MS;
    if (tap) act(pick(p.x, p.y));
  };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const L = live.current;
    if (!L.cam) return;
    const { w, h } = L.size;
    const lim = zoomLimits(w, h, FLOOR);
    L.cam = clampCamera(
      zoomAt(L.cam, localXY(e.clientX, e.clientY), Math.exp(-e.deltaY * 0.0015), w, h, lim.min, lim.max),
      w,
      h,
      FLOOR,
      mobileMargin(w, h),
    );
    L.lastZoomAt = performance.now();
  };
  const backToMe = () => {
    live.current.freeUntil = null;
    setFreeLook(false);
  };

  const startWatch = (id: number) => {
    setDialog(null);
    setChatOpen(false);
    setWatching(id);
    client.send({ type: 'watch', cabinet: id });
  };
  const stopWatch = () => {
    setWatching(null);
    client.send({ type: 'watch', cabinet: null });
  };
  // 画面の確認用（#dev の __va.watch）
  const startWatchRef = useRef(startWatch);
  startWatchRef.current = startWatch;
  const stopWatchRef = useRef(stopWatch);
  stopWatchRef.current = stopWatch;
  const walkTo = (id: number) => {
    const f = cabinetFront(id);
    if (f) {
      client.send({ type: 'goto', x: f.x, y: f.y });
      live.current.target = { x: f.x, y: f.y, at: performance.now() };
    }
    setDialog(null);
  };

  const you = client.you;
  const players = [...client.players.values()];
  const liveCount = [...client.cabinets.values()].filter((c) => c.videoId).length;
  const unread = you?.admin ? client.requestsUnread : 0;
  const toast = client.toast && performance.now() - client.toast.at < 3000 ? client.toast.text : null;
  useEffect(() => {
    if (!client.toast) return;
    const t = window.setTimeout(() => client.notify(), 3100);
    return () => window.clearTimeout(t);
  }, [client.toast, client]);

  const fatal = client.fatal;
  const activeRes = activeReservation(client.reservations, client.serverNow());
  /** v0.5.0：予約部屋の主催者（いまの予約を予約した人。予約部屋の中だけ）。サイトの管理者も部屋の管理ができる */
  const isHost = room === 'reserved' && !!activeRes && !!you && activeRes.ownerPid === you.pid;
  const canManage = room === 'reserved' && (isHost || !!you?.admin);
  const clock = room === 'reserved' && activeRes ? (compact: boolean) => <RoomClock end={activeRes.endAt} serverNow={() => client.serverNow()} compact={compact} /> : null;
  const leaveReserved = async () => {
    try {
      await api('POST', '/api/rooms/open/enter');
    } catch (e) {
      client.showToast(errorText(e));
    }
  };
  /** 新しい版がサーバに置かれた（このページは古い）。再読み込みを勧める */
  const outdated = client.outdated && (
    <div className="outdated">
      新しい版があります
      <button className="small primary" onClick={() => location.reload()}>
        再読み込み
      </button>
    </div>
  );

  // 退店：クレーンゲームのバッジが消える。サーバが接続を切る（bye）
  const leave = async () => {
    if (!window.confirm(`退店しますか？${you?.badges ? `（クレーンゲームのバッジ ${you.badges} は消えます）` : ''}`)) return;
    try {
      await api('POST', '/api/leave');
    } catch (e) {
      client.showToast(errorText(e));
      return;
    }
    client.close();
    onLeft();
  };
  useEffect(() => {
    if (client.left) {
      client.close();
      onLeft();
    }
  }, [client.left, client, onLeft]);

  const pinnedIds = new Set(players.flatMap((p) => (p.pinned ? [p.pinned.id] : [])));
  const chatPanel = (compact: boolean, form = true) => (
    <ChatPanel
      form={form}
      messages={client.chat}
      myPid={you?.pid ?? null}
      admin={!!you?.admin || isHost}
      online={players.length}
      maxPlayers={client.maxPlayers}
      connected={client.connected}
      pinnedIds={pinnedIds}
      compact={compact}
    />
  );

  const canvasWrap = (
    <div className="canvas-wrap" ref={wrapRef}>
      {mobile ? (
        <canvas
          ref={canvasRef}
          className="m-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={(e) => e.pointerType === 'mouse' && onLeave()}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
      ) : (
        <canvas ref={canvasRef} style={{ cursor }} onMouseMove={onMove} onMouseLeave={onLeave} onClick={onClick} />
      )}
      <div className="mini-embed" ref={embedRef} style={{ display: embed ? 'block' : 'none' }}>
        {embed && (
          <iframe
            key={embed.videoId}
            src={embedUrlMini(embed.videoId)}
            title="近くの筐体の配信（音なし）"
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
          />
        )}
      </div>
      {mobile && freeLook && (
        <button className="m-backme" onClick={backToMe}>
          ◎ 自分の所へ
        </button>
      )}
      {watching !== null && watchedCab && (
        <WatchView cabinet={watchedCab} onBack={stopWatch} onPlayerState={onPlayerState} chat={mobile ? chatPanel(true) : undefined} />
      )}
      {toast && <div className="toast">{toast}</div>}
      {outdated}
      {fatal && (fatal.code === 'kicked' || fatal.code === 'replaced' || fatal.code === 'full' || fatal.code === 'other') && (
        <div className="fatal">
          <div className="fatal-card">
            <h2>{fatal.code === 'kicked' ? '退室になりました' : fatal.code === 'full' ? '満員です' : '接続が切れました'}</h2>
            <p>{fatal.text}</p>
            {fatal.code !== 'kicked' && (
              <button className="primary" onClick={() => client.connect()}>
                {fatal.code === 'replaced' ? 'こちらで入り直す' : 'もう一度入る'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // v0.6.0：9 個目はベガ立ち（押すと動くまで腕を組む。もう一度で外す。DESIGN §16.7）
  const vega = client.me()?.stance === 'vega';
  const emoteButtons = [
    ...EMOTES.map((e) => (
      <button key={e} className="emote" onClick={() => client.send({ type: 'emote', emoji: e })} title={e}>
        {e}
      </button>
    )),
    <button
      key="vega"
      className={`emote stance ${vega ? 'on' : ''}`}
      onClick={() => client.send({ type: 'stance', stance: vega ? null : 'vega' })}
      title="ベガ立ち（動くまで腕を組む）"
      aria-label="ベガ立ち（動くまで腕を組む）"
      aria-pressed={vega}
    >
      <StanceIcon />
    </button>,
  ];

  const dialogs = (
    <>
      {dialog?.kind === 'cabinet' && (
        <CabinetDialog
          client={client}
          id={dialog.id}
          ttlHours={Math.round((meta?.cabinetTtlMs ?? 6 * 3600000) / 3600000)}
          onClose={() => setDialog(null)}
          onWatch={startWatch}
        />
      )}
      {dialog?.kind === 'screen' && (
        <ScreenDialog
          cabinets={[...client.cabinets.values()]}
          notices={client.notices}
          onWalk={walkTo}
          onWatch={startWatch}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'crane' && <CraneDialog client={client} id={dialog.id} meta={meta} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'game' && gameSpot(dialog.id) && (
        <GameDialog key={dialog.id} client={client} game={gameSpot(dialog.id)!.game} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'ranking' && (
        <RankingDialog game={dialog.game} admin={!!you?.admin} seq={client.rankingSeq} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'posters' && <PosterDialog client={client} meta={meta} initialId={dialog.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'note' && (
        <NoteDialog client={client} perView={mobile && !layout.landscape ? 1 : 2} mobile={mobile} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'request' && <RequestDialog myName={you?.name ?? ''} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'reserve' && (
        <ReservationDialog
          you={you}
          mobile={mobile}
          liveKey={client.reservations}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onEnterRoom={() => setDialog({ kind: 'door' })}
        />
      )}
      {dialog?.kind === 'roomAdmin' && you && canManage && (
        <RoomAdminDialog you={you} reservation={activeRes} players={players} notices={client.notices} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'door' && (
        <RoomDoorDialog
          you={you}
          inReserved={room === 'reserved'}
          liveKey={client.reservations}
          onClose={() => setDialog(null)}
          onEntered={() => setDialog(null)}
          onSchedule={() => setDialog({ kind: 'reserve' })}
        />
      )}
      {dialog?.kind === 'admin' && you && (
        <AdminDialog
          you={you}
          enabled={!!meta?.adminEnabled}
          players={players}
          notices={client.notices}
          unread={unread}
          initialTab={unread > 0 ? 'requests' : 'main'}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );

  // ---------------------------------------------------------------- スマホのレイアウト（DESIGN §11）
  if (mobile)
    return (
      <div
        className={`arcade m-arcade ${layout.landscape ? 'm-land' : 'm-port'} ${layout.landscape && chatCollapsed ? 'm-folded' : ''} ${room === 'reserved' ? 'room-reserved' : ''}`}
      >
        <header className="m-top">
          {layout.landscape && (
            <button
              className="ghost m-icon m-fold"
              onClick={() => setChatCollapsed(!chatCollapsed)}
              aria-label={chatCollapsed ? 'チャットを開く' : 'チャットをたたむ'}
              title={chatCollapsed ? 'チャットを開く' : 'チャットをたたむ'}
            >
              {chatCollapsed ? '💬' : '›'}
            </button>
          )}
          {room === 'reserved' ? (
            <button className="m-room-pill" onClick={() => setDialog({ kind: 'door' })} title="オープン部屋へ戻る">
              🔑 {activeRes ? activeRes.title : '予約部屋'}
            </button>
          ) : (
            <span className="m-logo">V.ARCADE</span>
          )}
          <span className="pill-info" title="店内の人数">
            👥 {players.length}/{client.maxPlayers}
          </span>
          {clock ? (
            clock(true)
          ) : (
            <span className="pill-info" title="配信中の筐体">
              📺 {liveCount}
            </span>
          )}
          {!client.connected && !fatal && <span className="pill-info warn">再接続中…</span>}
          <span className="m-spacer" />
          <button className="ghost m-icon m-menu-btn" onClick={() => setMenuOpen(true)} aria-label="メニュー">
            ☰{unread > 0 && <span className="count-dot" />}
          </button>
        </header>
        <main className="m-stage">{canvasWrap}</main>
        <section className="m-dock">
          <div className="m-emotes">{emoteButtons}</div>
          {layout.landscape ? (
            chatPanel(true, false)
          ) : (
            <ChatPeek messages={client.chat} myPid={you?.pid ?? null} onOpen={() => setChatOpen(true)} />
          )}
          {/* 発言の欄は縦横で同じ場所の同じ要素（回転・キーボードで作り直すとフォーカスが外れてキーボードが閉じる。v0.4.1） */}
          <ChatForm compact />
        </section>
        {chatOpen && !layout.landscape && (
          <ChatSheet online={players.length} maxPlayers={client.maxPlayers} connected={client.connected} onClose={() => setChatOpen(false)}>
            {chatPanel(true)}
          </ChatSheet>
        )}
        {menuOpen && (
          <MobileMenu
            you={you}
            embedVideo={prefs.embed}
            onEmbedVideo={(on) => {
              const p = { ...prefs, embed: on };
              setPrefs(p);
              saveMobilePrefs(p);
            }}
            onEditProfile={() => {
              setMenuOpen(false);
              onEditProfile();
            }}
            onAdmin={() => {
              setMenuOpen(false);
              setDialog({ kind: 'admin' });
            }}
            onLeave={() => {
              setMenuOpen(false);
              void leave();
            }}
            room={room}
            onSchedule={() => {
              setMenuOpen(false);
              setDialog({ kind: 'reserve' });
            }}
            onDoor={() => {
              setMenuOpen(false);
              setDialog({ kind: 'door' });
            }}
            onRoomAdmin={
              canManage
                ? () => {
                    setMenuOpen(false);
                    setDialog({ kind: 'roomAdmin' });
                  }
                : undefined
            }
            host={isHost}
            onClose={() => setMenuOpen(false)}
            version={meta?.version}
            adminBadge={unread}
          />
        )}
        {dialogs}
      </div>
    );

  // ---------------------------------------------------------------- PC のレイアウト（v0.3.0 のまま。v0.5.1 で予約部屋の札・時計・ボタンを上のバーの下の帯に分けた）
  const roomTitle = activeRes ? `予約部屋「${activeRes.title}」〜${jstTime(activeRes.endAt)}（予約：${activeRes.host}）` : '予約部屋';
  return (
    <div className={`arcade ${room === 'reserved' ? 'room-reserved' : ''}`}>
      <header className="topbar">
        <div className="logo">
          <span className="logo-main">VIRTUAL ARCADE</span>
          <span className="logo-sub">バーチャルゲームセンター</span>
        </div>
        <div className="topbar-mid">
          <span className="pill-info" title={`店内 ${players.length} / ${client.maxPlayers} 人`}>
            店内 {players.length} / {client.maxPlayers} 人
          </span>
          <span className="pill-info pill-live" title={`配信中 ${liveCount} 台`}>
            配信中 {liveCount} 台
          </span>
          {!client.connected && !fatal && (
            <span className="pill-info warn" title="再接続しています…">
              再接続しています…
            </span>
          )}
        </div>
        <div className="topbar-right">
          {you && (
            <button className="ghost me-button" onClick={onEditProfile} title={`${you.admin ? '★ ' : ''}${you.name}${you.badges ? ` ${you.badges}` : ''}：名前と見た目を変える`}>
              <span className="me-name">
                {you.admin && '★ '}
                {you.name}
              </span>
              <Badges badges={you.badges} />
              <span className="muted small me-look">　見た目を変える</span>
            </button>
          )}
          {you && (
            <button className="ghost" onClick={leave} title="店を出る（クレーンゲームのバッジが消えます）">
              退店
            </button>
          )}
          <button className={you?.admin ? 'admin-on' : 'ghost'} onClick={() => setDialog({ kind: 'admin' })} title="管理者">
            {you?.admin ? '🔧 管理者' : '管理者'}
            {unread > 0 && <span className="count-badge">{unread}</span>}
          </button>
        </div>
      </header>
      {room === 'reserved' && (
        <div className="roombar">
          <span className="room-pill" title={roomTitle}>
            🔑 {roomTitle}
          </span>
          {clock?.(false)}
          <span className="roombar-gap" />
          {canManage && (
            <button className="small room-admin-btn" onClick={() => setDialog({ kind: 'roomAdmin' })} title="部屋の管理（お知らせ・人・合言葉・早めに終える）">
              🛠 部屋の管理
            </button>
          )}
          <button className="small" onClick={() => void leaveReserved()} title="オープン部屋へ戻る">
            🚪 オープン部屋へ
          </button>
        </div>
      )}

      <main className="stage">
        {canvasWrap}
        <footer className="bottombar">
          <BgmControls />
          <div className="emotes">
            <span className="muted small">エモーション</span>
            {emoteButtons}
          </div>
          <div className="help" title={HELP_TEXT}>
            <div>
              <b>移動</b> 床をクリック / WASD・矢印キー　<b>筐体</b> クリックで視聴・使う
            </div>
            <div>
              <b>大画面</b> クリックで配信中の一覧　<b>近づく</b> 配信が小さく流れます（音なし）
            </div>
            <div>
              <b>クレーンゲーム</b> 右奥・クリックで遊ぶ　<b>掲示板</b> 左の壁・大会やイベントの告知
            </div>
          </div>
          <div className="help help-short" title={HELP_TEXT}>
            <div>
              <b>移動</b> 床をクリック / WASD
            </div>
            <div>
              <b>筐体・大画面・物</b> クリック
            </div>
          </div>
        </footer>
      </main>

      <aside className="side">{chatPanel(false)}</aside>

      {dialogs}
    </div>
  );
};
