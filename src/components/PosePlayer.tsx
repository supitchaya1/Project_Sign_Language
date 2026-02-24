import { useEffect, useRef, useState } from "react";
import { Pose } from "pose-format";

type Props = {
  poseUrl?: string;
  poseUrls?: string[];
  width?: number;
  height?: number;
  autoPlay?: boolean;
  fps?: number;
  confThreshold?: number;
  loopPlaylist?: boolean;
  loopPose?: boolean;
  flipY?: boolean;
};

type Point = { x: number; y: number; z: number; c: number };

const COLORS = {
  bg1: "#0B1B2A",
  bg2: "#0F2A3F",

  bodyStroke: "#D7E8FF",
  torso: "#5AA7FF",

  head: "#FFD84D",
  /* head: "#fbe1ceff", */
  cheek: "rgba(255,120,170,0.22)",

  eye: "#0B0F14",
  eyeWhite: "rgba(255,255,255,0.96)",
  eyeShadow: "rgba(0,0,0,0.10)",

  brow: "rgba(120,80,50,0.85)",

  mouth: "#E31B23",
  mouthOutline: "rgba(0,0,0,0.18)",

  palm: "rgba(255,255,255,0.58)",
  thumb: "#FF6B6B",
  index: "#4D96FF",
  middle: "#34C759",
  ring: "#AF52DE",
  pinky: "#FFCC00",
};

const POSE_EDGES: Array<[number, number]> = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

// เพิ่มเท้า/ส้นเท้า ลด “ขาขาด”
const POSE_EXTRA_EDGES: Array<[number, number]> = [
  [27, 31],
  [28, 32],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
];

// hands (21 points)
const HAND_PALM_EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 5],
  [0, 9],
  [0, 13],
  [0, 17],
  [5, 9],
  [9, 13],
  [13, 17],
];
const THUMB_EDGES: Array<[number, number]> = [
  [1, 2],
  [2, 3],
  [3, 4],
];
const INDEX_EDGES: Array<[number, number]> = [
  [5, 6],
  [6, 7],
  [7, 8],
];
const MIDDLE_EDGES: Array<[number, number]> = [
  [9, 10],
  [10, 11],
  [11, 12],
];
const RING_EDGES: Array<[number, number]> = [
  [13, 14],
  [14, 15],
  [15, 16],
];
const PINKY_EDGES: Array<[number, number]> = [
  [17, 18],
  [18, 19],
  [19, 20],
];

// ---------- utils ----------
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
  c: lerp(a.c, b.c, t),
});
const hypot2 = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

function isValidPoint(p?: Point, thr = 0.05) {
  return !!p && p.c >= thr && !(p.x === 0 && p.y === 0);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

type ViewMode = "FULL" | "UPPER" | "HEAD_TORSO";

function getBBoxIndices(mode: ViewMode) {
  const idx: number[] = [];
  const pushRange = (a: number, b: number) => {
    for (let i = a; i <= b; i++) idx.push(i);
  };

  if (mode === "FULL") {
    pushRange(0, 32);
  } else if (mode === "UPPER") {
    pushRange(0, 16);
    idx.push(11, 12, 23, 24);
  } else {
    pushRange(0, 12);
    idx.push(23, 24);
  }

  // hands always included
  for (let i = 501; i <= 542; i++) idx.push(i);

  return Array.from(new Set(idx));
}

export default function PosePlayer({
  poseUrl,
  poseUrls,
  width = 640,
  height = 360,
  autoPlay = true,
  fps = 24,
  confThreshold = 0.05,
  loopPlaylist = false,
  loopPose = true,
  flipY = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [playlist, setPlaylist] = useState<string[]>([]);
  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);

  const [frames, setFrames] = useState<Point[][]>([]);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(autoPlay);

  // ✅ UI/Options
  const [panelOpen, setPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("FULL");
  const [showFingerColors, setShowFingerColors] = useState(true);

  // ✅ ลดสั่น: ล็อกกล้อง (นิ่งสุด)
  const [lockCamera, setLockCamera] = useState(true);

  // smooth playback
  const posRef = useRef(0);
  const reqIdRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // smoothing / hold points
  const smoothPtsRef = useRef<Point[] | null>(null);

  // Stable camera bbox (hysteresis)
  const bboxRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  const camInitRef = useRef<boolean>(false);

  const resetCamera = () => {
    bboxRef.current = null;
    camInitRef.current = false;
  };
  // รีเซ็ตกล้องเมื่อสลับ FULL/UPPER หรือเปลี่ยนคลิป
  useEffect(() => {
    bboxRef.current = null;
    camInitRef.current = false;
  }, [viewMode, currentUrlIndex]);

  // anchor hands to wrists
  const handAnchorRef = useRef<{ L: { dx: number; dy: number }; R: { dx: number; dy: number } }>({
    L: { dx: 0, dy: 0 },
    R: { dx: 0, dy: 0 },
  });

  useEffect(() => {
    if (poseUrl) {
      setPlaylist([poseUrl]);
      setCurrentUrlIndex(0);
    } else if (poseUrls && poseUrls.length > 0) {
      setPlaylist(poseUrls);
      setCurrentUrlIndex(0);
    } else {
      setPlaylist([]);
    }
  }, [poseUrl, poseUrls]);

  useEffect(() => {
    let active = true;
    const url = playlist[currentUrlIndex];

    const loadPose = async () => {
      if (!url) return;

      setFrames([]);
      setErr("");
      posRef.current = 0;
      smoothPtsRef.current = null;
      bboxRef.current = null;
      camInitRef.current = false;
      handAnchorRef.current = { L: { dx: 0, dy: 0 }, R: { dx: 0, dy: 0 } };

      try {
        const pose: any = await Pose.fromRemote(url);

        const headerComps: any[] = pose?.header?.components ?? [];
        const bodyFrames: any[] = pose?.body?.frames ?? [];
        if (!bodyFrames?.length) throw new Error("ไฟล์ไม่มีเฟรม หรืออ่าน pose ไม่สำเร็จ");

        const parsed: Point[][] = [];

        for (let f = 0; f < bodyFrames.length; f++) {
          const people = bodyFrames[f]?.people ?? [];
          const person0 = people[0];
          if (!person0) continue;

          const pts: Point[] = [];
          for (const comp of headerComps) {
            const name = comp?.name;
            const arr: any[] = person0?.[name] ?? [];
            for (const p of arr) {
              pts.push({
                x: p?.X ?? p?.x ?? 0,
                y: p?.Y ?? p?.y ?? 0,
                z: p?.Z ?? p?.z ?? 0,
                c: p?.C ?? p?.c ?? 1,
              });
            }
          }
          parsed.push(pts);
        }

        if (!active) return;
        if (parsed.length === 0) throw new Error("อ่านข้อมูลไม่สำเร็จ (parsedFrames=0)");
        setFrames(parsed);
      } catch (e) {
        console.error(e);
        if (active) setErr(e instanceof Error ? e.message : "Error loading file");
      }
    };

    loadPose();
    return () => {
      active = false;
    };
  }, [playlist, currentUrlIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const interval = 1000 / fps;

    const render = (time: number) => {
      reqIdRef.current = requestAnimationFrame(render);
      if (!frames.length) return;

      const dt = time - (lastTimeRef.current || time);
      lastTimeRef.current = time;

      if (playing) posRef.current += dt / interval;

      const maxIndex = frames.length - 1;

      if (posRef.current >= frames.length) {
        if (playlist.length > 1) {
          if (currentUrlIndex < playlist.length - 1) {
            setCurrentUrlIndex((p) => p + 1);
            posRef.current = 0;
            return;
          }
          if (loopPlaylist) {
            setCurrentUrlIndex(0);
            posRef.current = 0;
            return;
          }
          posRef.current = maxIndex;
          if (playing) setPlaying(false);
        } else {
          if (loopPose) posRef.current = 0;
          else {
            posRef.current = maxIndex;
            if (playing) setPlaying(false);
          }
        }
      }

      const i0 = clamp(Math.floor(posRef.current), 0, maxIndex);
      const i1 = clamp(i0 + 1, 0, maxIndex);
      const t = clamp(posRef.current - i0, 0, 1);

      const a = frames[i0];
      const b = frames[i1] ?? a;

      const n = Math.min(a.length, b.length);
      const interp: Point[] = new Array(n);
      for (let i = 0; i < n; i++) interp[i] = lerpPoint(a[i], b[i], t);

      // smooth + hold ลดขาดๆ/กระตุก (ทำให้ดูไม่สั่นด้วย)
      const prev = smoothPtsRef.current;
      if (!prev || prev.length !== interp.length) {
        smoothPtsRef.current = interp;
      } else {
        for (let i = 0; i < interp.length; i++) {
          const cur = interp[i];
          const p = prev[i];

          const isHand = i >= 501;               // 501-542 คือมือ
          const a = isHand ? 0.08 : 0.22;        // ✅ มือช้าลง / ลำตัวพอดีๆ

          const invalid = cur.c < confThreshold * 0.65 || (cur.x === 0 && cur.y === 0);

          if (invalid) {
            // ✅ hold + ดัน confidence ให้เส้นไม่หาย
            const held = { ...p, c: Math.max(p.c, confThreshold * 0.95) };
            prev[i] = held;
            interp[i] = held;
            continue;
          }

          const next = {
            x: p.x + (cur.x - p.x) * a,
            y: p.y + (cur.y - p.y) * a,
            z: p.z + (cur.z - p.z) * a,
            c: p.c + (cur.c - p.c) * a,
          };
          prev[i] = next;
          interp[i] = next;
        }
      }

      drawSkeleton(
        ctx,
        interp,
        canvas.width,
        canvas.height,
        confThreshold,
        flipY,
        viewMode,
        showFingerColors,
        lockCamera
      );
    };

    reqIdRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(reqIdRef.current);
  }, [
    frames,
    playing,
    fps,
    playlist.length,
    currentUrlIndex,
    loopPlaylist,
    loopPose,
    confThreshold,
    flipY,
    viewMode,
    showFingerColors,
    lockCamera,
  ]);

  const drawBgGradient = (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, COLORS.bg1);
    g.addColorStop(1, COLORS.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  };

  const drawEdges = (
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    edges: Array<[number, number]>,
    toX: (x: number) => number,
    toY: (y: number) => number,
    threshold: number,
    strokeStyle: string,
    lineWidth: number
  ) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const thr = threshold * 0.55;
    for (const [a, b] of edges) {
      const pa = pts[a];
      const pb = pts[b];
      if (!isValidPoint(pa, thr) || !isValidPoint(pb, thr)) continue;

      const x1 = toX(pa.x);
      const y1 = toY(pa.y);
      const x2 = toX(pb.x);
      const y2 = toY(pb.y);

      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = lineWidth + 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };

  const drawJoints = (
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    indices: number[],
    toX: (x: number) => number,
    toY: (y: number) => number,
    threshold: number,
    fill: string,
    r: number
  ) => {
    const thr = threshold * 0.70;
    for (const i of indices) {
      const p = pts[i];
      if (!isValidPoint(p, thr)) continue;

      const x = toX(p.x);
      const y = toY(p.y);

      ctx.beginPath();
      ctx.arc(x, y, r + 1.3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    }
  };

  const drawSkeleton = (
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    cw: number,
    ch: number,
    threshold: number,
    flip: boolean,
    mode: ViewMode,
    fingerColorsOn: boolean,
    lockCam: boolean
  ) => {
    ctx.clearRect(0, 0, cw, ch);
    drawBgGradient(ctx, cw, ch);

    // ---- stable bbox ----
    const indicesForBBox = getBBoxIndices(mode);

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    const thrBBox = threshold * 0.65;

    for (const idx of indicesForBBox) {
      const p = pts[idx];
      if (!isValidPoint(p, thrBBox)) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (!isFinite(minX)) return;

    const paddingPx = Math.min(cw, ch) * 0.10; //ขนาดหัว ยิ่งต่ำ = หัวใหญ่

    const prev = bboxRef.current;
      if (!prev) {
        bboxRef.current = { minX, maxX, minY, maxY };
        camInitRef.current = true;
      } else {
        // ✅ ถ้าล็อกกล้อง: ไม่อัปเดต bbox อีกเลย => ไม่ซูมเข้า/ออก
        if (lockCam) {
          // do nothing (freeze bbox)
        } else {
          // ปกติ (ถ้าไม่ล็อก) ให้ตามตัวคนได้
          const expandA = 0.25;
          const shrinkA = 0.06;

          const axMin = minX < prev.minX ? expandA : shrinkA;
          const axMax = maxX > prev.maxX ? expandA : shrinkA;
          const ayMin = minY < prev.minY ? expandA : shrinkA;
          const ayMax = maxY > prev.maxY ? expandA : shrinkA;

          prev.minX += (minX - prev.minX) * axMin;
          prev.maxX += (maxX - prev.maxX) * axMax;
          prev.minY += (minY - prev.minY) * ayMin;
          prev.maxY += (maxY - prev.maxY) * ayMax;
        }
      }

    const bb = bboxRef.current!;
    const bodyW = Math.max(bb.maxX - bb.minX, 1e-6);
    const bodyH = Math.max(bb.maxY - bb.minY, 1e-6);

    const rawScale = Math.min((cw - paddingPx * 2) / bodyW, (ch - paddingPx * 2) / bodyH);

    // ✅ clamp scale ให้ไม่สั่น (ช่วงล็อกกล้อง clamp แคบลง)
    const minMul = lockCam ? 0.90 : 0.70;
    const maxMul = lockCam ? 1.05 : 1.35;

    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    const scale = clamp(rawScale, rawScale * minMul, rawScale * maxMul);

    const toX = (x: number) => (x - cx) * scale + cw / 2;
    const toY = (y: number) => {
      const yy = (y - cy) * scale + ch / 2;
      return flip ? ch - yy : yy;
    };

    // torso fill
    const torsoPts = [11, 12, 24, 23].map((i) => pts[i]);
    if (torsoPts.every((p) => isValidPoint(p, threshold * 0.65))) {
      ctx.beginPath();
      ctx.moveTo(toX(torsoPts[0]!.x), toY(torsoPts[0]!.y));
      for (let i = 1; i < torsoPts.length; i++) ctx.lineTo(toX(torsoPts[i]!.x), toY(torsoPts[i]!.y));
      ctx.closePath();
      ctx.fillStyle = COLORS.torso;
      ctx.globalAlpha = 0.16;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // body edges
    drawEdges(ctx, pts, [...POSE_EDGES, ...POSE_EXTRA_EDGES], toX, toY, threshold, COLORS.bodyStroke, 7);

    // attach hands to wrists
    const L_OFFSET = 501;
    const R_OFFSET = 522;

    const applyHandAnchor = (offset: number, wristPoseIdx: number, side: "L" | "R") => {
      const poseWrist = pts[wristPoseIdx];
      const handWrist = pts[offset + 0];

      if (!isValidPoint(poseWrist, threshold * 0.65) || !isValidPoint(handWrist, threshold * 0.65)) return;

      const dxRaw = poseWrist.x - handWrist.x;
      const dyRaw = poseWrist.y - handWrist.y;

      const a = 0.12;
      const prevA = handAnchorRef.current[side];
      prevA.dx += (dxRaw - prevA.dx) * a;
      prevA.dy += (dyRaw - prevA.dy) * a;

      for (let i = 0; i < 21; i++) {
        const hp = pts[offset + i];
        if (!hp) continue;
        pts[offset + i] = { ...hp, x: hp.x + prevA.dx, y: hp.y + prevA.dy };
      }
    };

    applyHandAnchor(L_OFFSET, 15, "L");
    applyHandAnchor(R_OFFSET, 16, "R");

    // hands
    const drawHand = (offset: number) => {
      const wrist = pts[offset + 0];
      if (!isValidPoint(wrist, threshold * 0.75)) return;

      const monoColor = COLORS.palm;

      drawEdges(
        ctx,
        pts,
        HAND_PALM_EDGES.map(([a, b]) => [a + offset, b + offset] as [number, number]),
        toX,
        toY,
        threshold,
        monoColor,
        4.2
      );

      const drawFinger = (edges: Array<[number, number]>, color: string) => {
        const stroke = fingerColorsOn ? color : monoColor;

        drawEdges(
          ctx,
          pts,
          edges.map(([a, b]) => [a + offset, b + offset] as [number, number]),
          toX,
          toY,
          threshold,
          stroke,
          4.8
        );

        // * ข้อต่อนิ้ว
        // const joints = Array.from(new Set(edges.flat())).map((i) => i + offset);
        // drawJoints(ctx, pts, joints, toX, toY, threshold, stroke, 2.7);
      };

      drawFinger(THUMB_EDGES, COLORS.thumb);
      drawFinger(INDEX_EDGES, COLORS.index);
      drawFinger(MIDDLE_EDGES, COLORS.middle);
      drawFinger(RING_EDGES, COLORS.ring);
      drawFinger(PINKY_EDGES, COLORS.pinky);
    };

    drawHand(L_OFFSET);
    drawHand(R_OFFSET);

    // face (คิ้วไม่ชนกัน)
    const nose = pts[0];
    const leftEye = pts[2];
    const rightEye = pts[5];
    const mL = pts[9];
    const mR = pts[10];
    const lShoulder = pts[11];
    const rShoulder = pts[12];

    let headR = 18;
    if (isValidPoint(lShoulder, threshold * 0.65) && isValidPoint(rShoulder, threshold * 0.65)) {
      const shoulderDist = hypot2(lShoulder.x, lShoulder.y, rShoulder.x, rShoulder.y);
      headR = Math.max(18, (shoulderDist * scale) / 3.6);
    }

    if (isValidPoint(nose, threshold * 0.65)) {
      const hx = toX(nose.x);
      const hy = toY(nose.y) - headR * 0.15;

      // head
      ctx.beginPath();
      ctx.arc(hx, hy, headR, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.head;
      ctx.fill();

      const getEyeXY = (pt?: Point) => {
        if (!isValidPoint(pt, threshold * 0.65)) return null;
        return { x: toX(pt!.x), y: toY(pt!.y) };
      };
      const L = getEyeXY(leftEye);
      const R = getEyeXY(rightEye);

      const drawEyeNice = (p: { x: number; y: number } | null) => {
        if (!p) return;
        const ex = p.x;
        const ey = p.y;

        ctx.beginPath();
        ctx.arc(ex, ey + 0.8, 7.0, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.eyeShadow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ex, ey, 6.6, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.eyeWhite;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ex, ey, 2.9, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.eye;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ex - 1.2, ey - 1.4, 1.0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fill();
      };

      drawEyeNice(L);
      drawEyeNice(R);

      // cheeks (ไม่ติดตาล่าง)
      ctx.beginPath();
      ctx.arc(hx - headR * 0.44, hy + headR * 0.34, headR * 0.16, 0, Math.PI * 2);
      ctx.arc(hx + headR * 0.44, hy + headR * 0.34, headR * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.cheek;
      ctx.fill();

      // brows (กันชนกันด้วย: จำกัดความยาวคิ้วตามระยะตา)
      const drawBrowSoft = (p: { x: number; y: number } | null, other: { x: number; y: number } | null) => {
        if (!p) return;
        const bx = p.x;
        const by = p.y - headR * 0.22;

        // คุมความยาว: ถ้าตาใกล้กัน ให้คิ้วสั้นลง
        let halfLen = 11;
        if (p && other) {
          const eyeDist = Math.abs(other.x - p.x);
          halfLen = clamp(eyeDist * 0.28, 6, 11);
        }

        ctx.strokeStyle = COLORS.brow;
        ctx.lineWidth = 3.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(bx - halfLen, by);
        ctx.quadraticCurveTo(bx, by - 4.2, bx + halfLen, by);
        ctx.stroke();
      };

      drawBrowSoft(L, R);
      drawBrowSoft(R, L);

      // mouth
      if (isValidPoint(mL, threshold * 0.65) && isValidPoint(mR, threshold * 0.65)) {
        const mx1 = toX(mL.x);
        const my1 = toY(mL.y);
        const mx2 = toX(mR.x);
        const my2 = toY(mR.y);

        const mouthCx = (mx1 + mx2) / 2;
        const mouthCy = (my1 + my2) / 2;
        const mouthW = Math.max(10, Math.hypot(mx2 - mx1, my2 - my1));
        const smile = clamp(mouthW * 0.10, 3.5, 8);

        ctx.strokeStyle = COLORS.mouthOutline;
        ctx.lineWidth = 5.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(mx1, my1);
        ctx.quadraticCurveTo(mouthCx, mouthCy + smile, mx2, my2);
        ctx.stroke();

        ctx.strokeStyle = COLORS.mouth;
        ctx.lineWidth = 3.6;
        ctx.beginPath();
        ctx.moveTo(mx1, my1);
        ctx.quadraticCurveTo(mouthCx, mouthCy + smile, mx2, my2);
        ctx.stroke();
      }
    }

    // ✅ สำคัญ: “เอาส่วนที่อยู่หลังปุ่มแถบข้างออก”
    // ไม่วาด legend บน canvas แล้ว (ย้ายไปอยู่ในแถบข้าง)
    // if (fingerColorsOn) drawLegend(ctx, cw, ch);
  };

  if (err) return <div className="text-red-400 text-xs p-4 bg-black/20 rounded">{err}</div>;

  return (
    <div className="relative w-full h-full">
      {/* ===== Canvas area ===== */}
      <div className="w-full h-full flex flex-col items-center">
        <canvas ref={canvasRef} width={width} height={height} className="rounded-lg shadow-lg bg-[#0F1F2F]" />

        <div className="flex gap-2 mt-2 items-center opacity-80 hover:opacity-100 transition-opacity">
          <button
            onClick={() => setPlaying(!playing)}
            className="text-[11px] bg-white/12 hover:bg-white/20 px-3 py-1.5 rounded-md text-white border border-white/10"
          >
            {playing ? "Pause" : "Play"}
          </button>

          {playlist.length > 1 && (
            <span className="text-[11px] text-white/55">
              Sequence: {currentUrlIndex + 1}/{playlist.length}
            </span>
          )}
        </div>
      </div>

      {/* ===== Toggle button (ชื่อดีขึ้น + ชัด) ===== */}
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="absolute top-3 right-3 z-50 rounded-xl px-4 py-2 text-[12px] font-semibold
                   bg-white text-black shadow-lg hover:shadow-xl active:scale-[0.98]
                   border border-black/10"
        aria-label="Toggle options panel"
        title="ตัวเลือก"
      >
        {panelOpen ? "ซ่อนตัวเลือก" : "ตัวเลือก"}
      </button>

      {/* ===== Side panel (ตอนปิด: ไม่รับคลิก/ไม่บังอะไร) ===== */}
      <div
        className={[
          "absolute top-0 right-0 h-full z-40",
          "transition-transform duration-200 ease-out",
          panelOpen ? "translate-x-0 pointer-events-auto" : "translate-x-full pointer-events-none",
        ].join(" ")}
        style={{ width: 320 }}
      >
        <div className="h-full bg-black/55 backdrop-blur-md border-l border-white/10 p-3 pt-14 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-white font-semibold text-sm">ตัวเลือก</div>
          </div>

          {/* View mode buttons */}
          <div className="grid grid-cols-1 gap-2 mb-3">
            <button
              onClick={() => {
                resetCamera();          // ✅ รีเซ็ตทุกครั้ง แม้กด FULL ซ้ำ
                setViewMode("FULL");
              }}
              className={[
                "w-full rounded-lg px-3 py-2 text-[12px] font-semibold border",
                viewMode === "FULL"
                  ? "bg-white text-black border-white/20"
                  : "bg-white/10 text-white border-white/10 hover:bg-white/15",
              ].join(" ")}
            >
              เต็มตัว (หัวถึงขา)
            </button>

            <button
              onClick={() => {
                resetCamera();          // ✅ รีเซ็ตทุกครั้ง แม้กด UPPER ซ้ำ
                setViewMode("UPPER");
              }}
              className={[
                "w-full rounded-lg px-3 py-2 text-[12px] font-semibold border",
                viewMode === "UPPER"
                  ? "bg-white text-black border-white/20"
                  : "bg-white/10 text-white border-white/10 hover:bg-white/15",
              ].join(" ")}
            >
              ครึ่งตัวบน (หัวถึงเอว/สะโพก)
            </button>
          </div>

          {/* camera lock */}
          <button
            onClick={() => setLockCamera((v) => !v)}
            className={[
              "w-full rounded-lg px-3 py-2 text-[12px] font-semibold border mb-3",
              lockCamera ? "bg-white text-black border-white/20" : "bg-white/10 text-white border-white/10 hover:bg-white/15",
            ].join(" ")}
          >
            {lockCamera ? "กล้อง: ล็อก (นิ่ง)" : "กล้อง: ติดตาม (ซูม)"}
          </button>

          {/* Scrollable finger color description (บอกว่านิ้วสีอะไร) */}
          <div className="mt-2">
            <div className="text-white font-semibold text-sm mb-2">คำอธิบายสีของนิ้ว</div>

            <div className="max-h-[45vh] overflow-y-auto pr-1 space-y-2">
              {[
                { name: "นิ้วโป้ง", color: COLORS.thumb },
                { name: "นิ้วชี้", color: COLORS.index },
                { name: "นิ้วกลาง", color: COLORS.middle },
                { name: "นิ้วนาง", color: COLORS.ring },
                { name: "นิ้วก้อย", color: COLORS.pinky },
              ].map((f) => (
                <details
                  key={f.name}
                  className="rounded-lg border border-white/10 bg-white/8 px-3 py-2"
                  open={false}
                >
                  <summary className="cursor-pointer list-none flex items-center gap-2 text-white/90 text-[12px] font-semibold">
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ background: showFingerColors ? f.color : "rgba(255,255,255,0.45)" }}
                    />
                    {f.name}
                  </summary>
                </details>
              ))}
            </div>
          </div>

          {/* explanation (scroll) */}
          <div className="mt-4 text-white/85 text-[12px] leading-relaxed">
            <div className="font-semibold text-white mb-1">หมายเหตุ</div>
            <div className="max-h-[20vh] overflow-y-auto pr-1 text-white/70 text-[11px]">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <b>กล้อง: ล็อก (นิ่ง)</b> — กล้องจะไม่ซูมหรือขยับตามการเคลื่อนไหวของตัวแบบ
                  ทำให้ภาพนิ่งและลดอาการสั่น แต่ยังสามารถเลือกดูแบบ
                  <b>เต็มตัว</b> หรือ <b>ครึ่งตัวบน</b> ได้
                </li>

                <li>
                  <b>กล้อง: ติดตาม (ซูม)</b> — กล้องจะปรับขนาดและตำแหน่งตามการเคลื่อนไหวของตัวแบบ
                  เพื่อให้ตัวแบบอยู่กลางหน้าจอเสมอ
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
