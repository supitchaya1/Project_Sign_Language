import { useEffect, useRef, useState } from "react";
import { Pose } from "pose-format";

type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "question"
  | "fear"
  | "laugh";

type PlaylistItem = {
  url: string;
  label?: string;
  emotion?: Emotion;
};

type Props = {
  poseUrl?: string;
  poseUrls?: string[];
  items?: PlaylistItem[];

  playlist?: string[];
  autoPlay?: boolean;
  exportMode?: boolean;
  className?: string;

  width?: number;
  height?: number;
  fps?: number;
  confThreshold?: number;
  loopPlaylist?: boolean;
  loopPose?: boolean;
  flipY?: boolean;

  emotion?: Emotion;

  playing?: boolean;
  onSequenceEnd?: () => void;
  onSequenceStepChange?: (index: number) => void;
};

type Point = { x: number; y: number; z: number; c: number };

type FaceStyle = {
  browTilt: number;
  browLift: number;
  eyeOpen: number;
  mouthCurve: number;
  mouthOpen: number;
};

const COLORS = {
  bg1: "#0B1B2A",
  bg2: "#0F2A3F",

  bodyStroke: "#D7E8FF",
  torso: "#5AA7FF",

  head: "#FFD84D",
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

const POSE_EXTRA_EDGES: Array<[number, number]> = [
  [27, 31],
  [28, 32],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
];

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

  for (let i = 501; i <= 542; i++) idx.push(i);

  return Array.from(new Set(idx));
}

function getFaceStyle(emotion: Emotion): FaceStyle {
  switch (emotion) {
    case "happy":
      return { browTilt: -1.5, browLift: 2, eyeOpen: 1, mouthCurve: 9, mouthOpen: 5 };

    case "laugh":
      return { browTilt: -0.1, browLift: 1, eyeOpen: 0.5, mouthCurve: 12, mouthOpen: 9 };

    case "sad":
      return { browTilt: -4, browLift: 3, eyeOpen: 0.58, mouthCurve: -8, mouthOpen: 1 };

    case "angry":
      return { browTilt: 5.5, browLift: -2, eyeOpen: 0.68, mouthCurve: -3, mouthOpen: 1 };

    case "surprised":
      return { browTilt: 0, browLift: 7, eyeOpen: 1.35, mouthCurve: 0, mouthOpen: 6 };

    case "question":
      return { browTilt: -3.5, browLift: 5, eyeOpen: 1.5, mouthCurve: 2, mouthOpen: 1.8 };

    case "fear":
      return {browTilt: -5.5,browLift: 6,eyeOpen: 1.28,mouthCurve: -2,mouthOpen: 2};

    default:
      return { browTilt: 0, browLift: 0, eyeOpen: 1, mouthCurve: 3.5, mouthOpen: 1.2 };
  }
}

export default function PosePlayer({
  poseUrl,
  poseUrls,
  items,
  playlist,
  width = 640,
  height = 360,
  autoPlay = true,
  exportMode = false,
  className = "",
  fps = 24,
  confThreshold = 0.05,
  loopPlaylist = false,
  loopPose = true,
  flipY = false,
  emotion = "neutral",
  playing: controlledPlaying,
  onSequenceEnd,
  onSequenceStepChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [resolvedPlaylist, setResolvedPlaylist] = useState<string[]>([]);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);

  const [frames, setFrames] = useState<Point[][]>([]);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(autoPlay);

  const [panelOpen, setPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("FULL");
  const [showFingerColors, setShowFingerColors] = useState(true);
  const [lockCamera, setLockCamera] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  const posRef = useRef(0);
  const reqIdRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const smoothPtsRef = useRef<Point[] | null>(null);
  const endCalledRef = useRef(false);
  const prevControlledPlayingRef = useRef<boolean | undefined>(undefined);

  const bboxRef = useRef<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);

  const handAnchorRef = useRef<{
    L: { dx: number; dy: number };
    R: { dx: number; dy: number };
  }>({
    L: { dx: 0, dy: 0 },
    R: { dx: 0, dy: 0 },
  });

  const resetCamera = () => {
    bboxRef.current = null;
  };

  const fireSequenceEndOnce = () => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    onSequenceEnd?.();
  };

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");

    const updateMobile = () => {
      setIsMobile(media.matches);
    };

    updateMobile();

    if (media.addEventListener) {
      media.addEventListener("change", updateMobile);
      return () => media.removeEventListener("change", updateMobile);
    } else {
      media.addListener(updateMobile);
      return () => media.removeListener(updateMobile);
    }
  }, []);

  useEffect(() => {
    bboxRef.current = null;
  }, [viewMode, currentUrlIndex]);

  useEffect(() => {
    if (typeof controlledPlaying === "boolean") {
      const wasPlaying = prevControlledPlayingRef.current;
      const isStartingAgain = wasPlaying === false && controlledPlaying === true;

      if (isStartingAgain) {
        const endedCurrentClip = frames.length > 0 && posRef.current >= frames.length - 1;
        const endedEntirePlaylist =
          resolvedPlaylist.length > 1 &&
          currentUrlIndex === resolvedPlaylist.length - 1 &&
          frames.length > 0 &&
          posRef.current >= frames.length - 1;

        if (endedCurrentClip || endedEntirePlaylist) {
          posRef.current = 0;
          setCurrentUrlIndex(0);
          smoothPtsRef.current = null;
          bboxRef.current = null;
          handAnchorRef.current = { L: { dx: 0, dy: 0 }, R: { dx: 0, dy: 0 } };
          lastTimeRef.current = 0;
          endCalledRef.current = false;
          onSequenceStepChange?.(0);
        }
      }

      setPlaying(controlledPlaying);
      prevControlledPlayingRef.current = controlledPlaying;
    } else {
      setPlaying(autoPlay);
    }
  }, [
    controlledPlaying,
    autoPlay,
    frames.length,
    resolvedPlaylist.length,
    currentUrlIndex,
    onSequenceStepChange,
  ]);

  useEffect(() => {
    onSequenceStepChange?.(currentUrlIndex);
  }, [currentUrlIndex, onSequenceStepChange]);

  useEffect(() => {
    endCalledRef.current = false;

    if (items && items.length > 0) {
      setPlaylistItems(items);
      setResolvedPlaylist(items.map((x) => x.url));
      setCurrentUrlIndex(0);
      return;
    }

    if (playlist && playlist.length > 0) {
      const mapped = playlist.map((url) => ({ url, emotion }));
      setPlaylistItems(mapped);
      setResolvedPlaylist(playlist);
      setCurrentUrlIndex(0);
      return;
    }

    if (poseUrl) {
      setPlaylistItems([{ url: poseUrl, emotion }]);
      setResolvedPlaylist([poseUrl]);
      setCurrentUrlIndex(0);
      return;
    }

    if (poseUrls && poseUrls.length > 0) {
      const mapped = poseUrls.map((url) => ({ url, emotion }));
      setPlaylistItems(mapped);
      setResolvedPlaylist(poseUrls);
      setCurrentUrlIndex(0);
      return;
    }

    setPlaylistItems([]);
    setResolvedPlaylist([]);
    setCurrentUrlIndex(0);
  }, [poseUrl, poseUrls, items, playlist, emotion]);

  useEffect(() => {
    let active = true;
    const url = resolvedPlaylist[currentUrlIndex];

    const loadPose = async () => {
      if (!url) return;

      setFrames([]);
      setErr("");
      posRef.current = 0;
      smoothPtsRef.current = null;
      bboxRef.current = null;
      handAnchorRef.current = { L: { dx: 0, dy: 0 }, R: { dx: 0, dy: 0 } };

      try {
        const pose: any = await Pose.fromRemote(url);

        const headerComps: any[] = pose?.header?.components ?? [];
        const bodyFrames: any[] = pose?.body?.frames ?? [];
        if (!bodyFrames?.length) {
          throw new Error("ไฟล์ไม่มีเฟรม หรืออ่าน pose ไม่สำเร็จ");
        }

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
        if (parsed.length === 0) {
          throw new Error("อ่านข้อมูลไม่สำเร็จ (parsedFrames=0)");
        }

        setFrames(parsed);
      } catch (e) {
        console.error(e);
        if (active) {
          setErr(e instanceof Error ? e.message : "Error loading file");
        }
      }
    };

    loadPose();

    return () => {
      active = false;
    };
  }, [resolvedPlaylist, currentUrlIndex]);

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
        if (resolvedPlaylist.length > 1) {
          if (currentUrlIndex < resolvedPlaylist.length - 1) {
            const nextIndex = currentUrlIndex + 1;
            setCurrentUrlIndex(nextIndex);
            onSequenceStepChange?.(nextIndex);
            posRef.current = 0;
            return;
          }

          if (loopPlaylist) {
            setCurrentUrlIndex(0);
            onSequenceStepChange?.(0);
            posRef.current = 0;
            endCalledRef.current = false;
            return;
          }

          posRef.current = maxIndex;
          if (playing) setPlaying(false);
          fireSequenceEndOnce();
        } else {
          if (loopPose) {
            posRef.current = 0;
            endCalledRef.current = false;
            onSequenceStepChange?.(0);
          } else {
            posRef.current = maxIndex;
            if (playing) setPlaying(false);
            fireSequenceEndOnce();
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

      const prev = smoothPtsRef.current;
      if (!prev || prev.length !== interp.length) {
        smoothPtsRef.current = interp;
      } else {
        for (let i = 0; i < interp.length; i++) {
          const cur = interp[i];
          const p = prev[i];

          const isHand = i >= 501;
          const alpha = isHand ? 0.08 : 0.22;

          const invalid =
            cur.c < confThreshold * 0.65 || (cur.x === 0 && cur.y === 0);

          if (invalid) {
            const held = { ...p, c: Math.max(p.c, confThreshold * 0.95) };
            prev[i] = held;
            interp[i] = held;
            continue;
          }

          const next = {
            x: p.x + (cur.x - p.x) * alpha,
            y: p.y + (cur.y - p.y) * alpha,
            z: p.z + (cur.z - p.z) * alpha,
            c: p.c + (cur.c - p.c) * alpha,
          };
          prev[i] = next;
          interp[i] = next;
        }
      }

      const activeEmotion =
        playlistItems[currentUrlIndex]?.emotion ?? emotion ?? "neutral";

      drawSkeleton(
        ctx,
        interp,
        canvas.width,
        canvas.height,
        confThreshold,
        flipY,
        viewMode,
        showFingerColors,
        lockCamera,
        activeEmotion
      );
    };

    reqIdRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(reqIdRef.current);
  }, [
    frames,
    playing,
    fps,
    resolvedPlaylist.length,
    currentUrlIndex,
    loopPlaylist,
    loopPose,
    confThreshold,
    flipY,
    viewMode,
    showFingerColors,
    lockCamera,
    emotion,
    playlistItems,
    onSequenceEnd,
    onSequenceStepChange,
  ]);

  const drawBgGradient = (
    ctx: CanvasRenderingContext2D,
    cw: number,
    ch: number
  ) => {
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
    const thr = threshold * 0.7;

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
    lockCam: boolean,
    activeEmotion: Emotion
  ) => {
    ctx.clearRect(0, 0, cw, ch);
    drawBgGradient(ctx, cw, ch);

    const indicesForBBox = getBBoxIndices(mode);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const thrBBox = mode === "FULL" ? threshold * 0.45 : threshold * 0.65;

    for (const idx of indicesForBBox) {
      const p = pts[idx];
      if (!isValidPoint(p, thrBBox)) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    if (!isFinite(minX)) return;

    const paddingPx = Math.min(cw, ch) * (isMobile ? 0.12 : 0.1);

    const prev = bboxRef.current;
    if (!prev) {
      bboxRef.current = { minX, maxX, minY, maxY };
    } else if (!lockCam) {
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

    const bb = bboxRef.current!;
    const bodyW = Math.max(bb.maxX - bb.minX, 1e-6);
    const bodyH = Math.max(bb.maxY - bb.minY, 1e-6);

    const rawScale = Math.min(
      (cw - paddingPx * 2) / bodyW,
      (ch - paddingPx * 2) / bodyH
    );

    const minMul = lockCam
      ? isMobile
        ? 0.9
        : 0.9
      : isMobile
      ? 0.7
      : 0.7;

    const maxMul = lockCam
      ? isMobile
        ? 1.1
        : 1.05
      : isMobile
      ? 1.2
      : 1.35;

    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    const scale = clamp(rawScale, rawScale * minMul, rawScale * maxMul);

    const toX = (x: number) => (x - cx) * scale + cw / 2;
    const toY = (y: number) => {
      const yy = (y - cy) * scale + ch / 2;
      return flip ? ch - yy : yy;
    };

    const torsoPts = [11, 12, 24, 23].map((i) => pts[i]);
    if (torsoPts.every((p) => isValidPoint(p, threshold * 0.65))) {
      ctx.beginPath();
      ctx.moveTo(toX(torsoPts[0]!.x), toY(torsoPts[0]!.y));
      for (let i = 1; i < torsoPts.length; i++) {
        ctx.lineTo(toX(torsoPts[i]!.x), toY(torsoPts[i]!.y));
      }
      ctx.closePath();
      ctx.fillStyle = COLORS.torso;
      ctx.globalAlpha = 0.16;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawEdges(
      ctx,
      pts,
      [...POSE_EDGES, ...POSE_EXTRA_EDGES],
      toX,
      toY,
      threshold,
      COLORS.bodyStroke,
      7
    );

    const bodyJointIndices =
      mode === "FULL"
        ? [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
        : mode === "UPPER"
        ? [11, 12, 13, 14, 15, 16, 23, 24]
        : [0, 11, 12, 13, 14, 15, 16];

    drawJoints(
      ctx,
      pts,
      bodyJointIndices,
      toX,
      toY,
      threshold,
      COLORS.bodyStroke,
      3.6
    );

    const L_OFFSET = 501;
    const R_OFFSET = 522;

    const applyHandAnchor = (
      offset: number,
      wristPoseIdx: number,
      side: "L" | "R"
    ) => {
      const poseWrist = pts[wristPoseIdx];
      const handWrist = pts[offset + 0];

      if (
        !isValidPoint(poseWrist, threshold * 0.65) ||
        !isValidPoint(handWrist, threshold * 0.65)
      ) {
        return;
      }

      const dxRaw = poseWrist.x - handWrist.x;
      const dyRaw = poseWrist.y - handWrist.y;

      const alpha = 0.12;
      const prevAnchor = handAnchorRef.current[side];
      prevAnchor.dx += (dxRaw - prevAnchor.dx) * alpha;
      prevAnchor.dy += (dyRaw - prevAnchor.dy) * alpha;

      for (let i = 0; i < 21; i++) {
        const p = pts[offset + i];
        if (!p) continue;
        p.x += prevAnchor.dx;
        p.y += prevAnchor.dy;
      }
    };

    applyHandAnchor(L_OFFSET, 15, "L");
    applyHandAnchor(R_OFFSET, 16, "R");

    const drawHand = (offset: number) => {
      const monoColor = COLORS.palm;

      drawEdges(
        ctx,
        pts,
        HAND_PALM_EDGES.map(
          ([a, b]) => [a + offset, b + offset] as [number, number]
        ),
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
      };

      drawFinger(THUMB_EDGES, COLORS.thumb);
      drawFinger(INDEX_EDGES, COLORS.index);
      drawFinger(MIDDLE_EDGES, COLORS.middle);
      drawFinger(RING_EDGES, COLORS.ring);
      drawFinger(PINKY_EDGES, COLORS.pinky);
    };

    const nose = pts[0];
    const leftEye = pts[2];
    const rightEye = pts[5];
    const mL = pts[9];
    const mR = pts[10];
    const lShoulder = pts[11];
    const rShoulder = pts[12];

    let headR = 18;
    if (
      isValidPoint(lShoulder, threshold * 0.65) &&
      isValidPoint(rShoulder, threshold * 0.65)
    ) {
      const shoulderDist = hypot2(
        lShoulder.x,
        lShoulder.y,
        rShoulder.x,
        rShoulder.y
      );
      headR = Math.max(18, (shoulderDist * scale) / 3.6);
    }

    if (isValidPoint(nose, threshold * 0.65)) {
      const faceStyle = getFaceStyle(activeEmotion);

      const hx = toX(nose.x);
      const hy = toY(nose.y) - headR * 0.15;

      ctx.beginPath();
      ctx.arc(hx, hy, headR, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.head;
      ctx.fill();

      const getEyeXY = (pt?: Point) => {
        if (!isValidPoint(pt, threshold * 0.65)) return null;
        return { x: toX(pt.x), y: toY(pt.y) };
      };

      const L = getEyeXY(leftEye);
      const R = getEyeXY(rightEye);

      const drawEyeNice = (p: { x: number; y: number } | null) => {
        if (!p) return;
        const ex = p.x;
        const ey = p.y;

        ctx.beginPath();
        ctx.ellipse(
          ex,
          ey + 0.8,
          7.0,
          Math.max(2.2, 7.0 * faceStyle.eyeOpen),
          0,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = COLORS.eyeShadow;
        ctx.fill();

        ctx.beginPath();
        ctx.ellipse(
          ex,
          ey,
          6.6,
          Math.max(2.2, 6.6 * faceStyle.eyeOpen),
          0,
          0,
          Math.PI * 2
        );
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

      ctx.beginPath();
      ctx.arc(
        hx - headR * 0.44,
        hy + headR * 0.34,
        headR * 0.16,
        0,
        Math.PI * 2
      );
      ctx.arc(
        hx + headR * 0.44,
        hy + headR * 0.34,
        headR * 0.16,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = COLORS.cheek;
      ctx.fill();

      const drawBrowSoft = (
        p: { x: number; y: number } | null,
        other: { x: number; y: number } | null,
        side: "L" | "R"
      ) => {
        if (!p) return;

        const bx = p.x;
        const by = p.y - headR * 0.22 - faceStyle.browLift;

        let halfLen = 11;
        if (p && other) {
          const eyeDist = Math.abs(other.x - p.x);
          halfLen = clamp(eyeDist * 0.28, 6, 11);
        }

        const tilt = side === "L" ? faceStyle.browTilt : -faceStyle.browTilt;

        ctx.strokeStyle = COLORS.brow;
        ctx.lineWidth = 3.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(bx - halfLen, by + tilt);
        ctx.quadraticCurveTo(bx, by - 4.2, bx + halfLen, by - tilt);
        ctx.stroke();
      };

      drawBrowSoft(L, R, "L");
      drawBrowSoft(R, L, "R");

      if (
        isValidPoint(mL, threshold * 0.65) &&
        isValidPoint(mR, threshold * 0.65)
      ) {
        const mx1 = toX(mL.x);
        const my1 = toY(mL.y);
        const mx2 = toX(mR.x);
        const my2 = toY(mR.y);

        const mouthCx = (mx1 + mx2) / 2;
        const mouthCy = (my1 + my2) / 2;
        const mouthW = Math.max(14, Math.hypot(mx2 - mx1, my2 - my1));
        const curve = faceStyle.mouthCurve;
        const open = faceStyle.mouthOpen;

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (activeEmotion === "laugh") {
          ctx.beginPath();
          ctx.ellipse(mouthCx, mouthCy + 5, mouthW * 0.34, open, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(90,0,0,0.62)";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(mouthCx, mouthCy + 7, mouthW * 0.20, 0, Math.PI);
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fill();
        } else if (activeEmotion === "surprised") {
          ctx.beginPath();
          ctx.ellipse(mouthCx, mouthCy + 3, mouthW * 0.20, open, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(80,0,0,0.58)";
          ctx.fill();

          ctx.strokeStyle = COLORS.mouth;
          ctx.lineWidth = 3;
          ctx.stroke();
        } else if (activeEmotion === "fear") {
          ctx.beginPath();

          ctx.strokeStyle = "rgba(174, 9, 9, 0.7)";
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(mx1 + 2, my1 + 2);
          ctx.quadraticCurveTo(mouthCx, mouthCy, mx2 - 2, my2 + 2);
          ctx.stroke();
        } else {
          ctx.strokeStyle = COLORS.mouthOutline;
          ctx.lineWidth = 5.5;
          ctx.beginPath();
          ctx.moveTo(mx1, my1);
          ctx.quadraticCurveTo(mouthCx, mouthCy + curve, mx2, my2);
          ctx.stroke();

          ctx.strokeStyle = COLORS.mouth;
          ctx.lineWidth = 3.6;
          ctx.beginPath();
          ctx.moveTo(mx1, my1);
          ctx.quadraticCurveTo(mouthCx, mouthCy + curve, mx2, my2);
          ctx.stroke();
        }
      }
    }

    drawHand(L_OFFSET);
    drawHand(R_OFFSET);
  };

  if (err) {
    return <div className="text-red-400 text-xs p-4 bg-black/20 rounded">{err}</div>;
  }

  return (
    <div className={`relative w-full h-full ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full h-full rounded-lg shadow-lg bg-[#0F1F2F]"
      />

      {!exportMode && (
        <>
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

          <div
            className={[
              "absolute top-0 right-0 h-full z-40",
              "transition-transform duration-200 ease-out",
              panelOpen
                ? "translate-x-0 pointer-events-auto"
                : "translate-x-full pointer-events-none",
            ].join(" ")}
            style={{ width: 320 }}
          >
            <div
              className="h-full bg-black/55 backdrop-blur-md border-l border-white/10 p-3 pt-14 overflow-y-auto overscroll-contain"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-white font-semibold text-sm">ตัวเลือก</div>
              </div>

              <div className="grid grid-cols-1 gap-2 mb-3">
                <button
                  onClick={() => {
                    resetCamera();
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
                    resetCamera();
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

              <button
                onClick={() => setLockCamera((v) => !v)}
                className={[
                  "w-full rounded-lg px-3 py-2 text-[12px] font-semibold border mb-3",
                  lockCamera
                    ? "bg-white text-black border-white/20"
                    : "bg-white/10 text-white border-white/10 hover:bg-white/15",
                ].join(" ")}
              >
                {lockCamera ? "กล้อง: ล็อก (นิ่ง)" : "กล้อง: ติดตาม (ซูม)"}
              </button>

              <button
                onClick={() => setShowFingerColors((v) => !v)}
                className={[
                  "w-full rounded-lg px-3 py-2 text-[12px] font-semibold border mb-3",
                  showFingerColors
                    ? "bg-white text-black border-white/20"
                    : "bg-white/10 text-white border-white/10 hover:bg-white/15",
                ].join(" ")}
              >
                {showFingerColors ? "แสดงสีนิ้ว: เปิด" : "แสดงสีนิ้ว: ปิด"}
              </button>

              <div className="mt-2">
                <div className="text-white font-semibold text-sm mb-2">
                  คำอธิบายสีของนิ้ว
                </div>

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
                    >
                      <summary className="cursor-pointer list-none flex items-center gap-2 text-white/90 text-[12px] font-semibold">
                        <span
                          className="inline-block w-3 h-3 rounded-full"
                          style={{
                            background: showFingerColors
                              ? f.color
                              : "rgba(255,255,255,0.45)",
                          }}
                        />
                        {f.name}
                      </summary>
                    </details>
                  ))}
                </div>
              </div>

              <div className="mt-4 text-white/85 text-[12px] leading-relaxed">
                <div className="font-semibold text-white mb-1">หมายเหตุ</div>
                <div className="max-h-[24vh] overflow-y-auto pr-1 text-white/70 text-[11px]">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <b>emotion</b> ใช้กำหนดสีหน้า เช่น happy, sad, angry
                    </li>
                    <li>
                      <b>items</b> ใช้เวลาต้องการให้แต่ละคำมีอารมณ์ต่างกัน
                    </li>
                    <li>
                      <b>กล้อง: ล็อก (นิ่ง)</b> จะช่วยลดอาการสั่น
                    </li>
                    <li>
                      เวอร์ชันนี้วาดมือหลังวาดหน้า ทำให้มืออยู่ด้านหน้าของใบหน้า
                    </li>
                  </ul>
                </div>
              </div>

              <div className="mt-4">
                <div className="text-white font-semibold text-sm mb-2">
                  ตัวอย่าง emotion
                </div>
                <div className="space-y-2 text-[11px] text-white/80">
                  <div className="rounded-lg border border-white/10 bg-white/8 px-3 py-2">
                    neutral = ปกติ
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/8 px-3 py-2">
                    happy = ดีใจ
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/8 px-3 py-2">
                    sad = เสียใจ
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/8 px-3 py-2">
                    angry = โกรธ
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/8 px-3 py-2">
                    surprised = ตกใจ
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/8 px-3 py-2">
                    question = สงสัย / คำถาม
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/8 px-3 py-2">
                    fear = กลัว
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/8 px-3 py-2">
                    laugh = หัวเราะ
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}