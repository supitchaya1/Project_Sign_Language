import { useEffect, useMemo, useRef, useState } from "react";
import { Buffer } from "buffer";
import { Pose } from "pose-format";

// ✅ polyfill ให้ pose-format ใช้ใน browser
(globalThis as any).Buffer = Buffer;

type ComponentName = string;

// ✅ 1. เพิ่มแผนที่เส้นกระดูกมาตรฐานของ MediaPipe (33 จุด)
const MEDIAPIPE_LIMBS = [
  // ลำตัว (Torso)
  { from: 11, to: 12 }, { from: 11, to: 23 }, { from: 12, to: 24 }, { from: 23, to: 24 },
  // แขนขวา (Right Arm)
  { from: 12, to: 14 }, { from: 14, to: 16 }, { from: 16, to: 18 }, { from: 16, to: 20 }, { from: 16, to: 22 },
  // แขนซ้าย (Left Arm)
  { from: 11, to: 13 }, { from: 13, to: 15 }, { from: 15, to: 17 }, { from: 15, to: 19 }, { from: 15, to: 21 },
  // ขาขวา (Right Leg)
  { from: 24, to: 26 }, { from: 26, to: 28 }, { from: 28, to: 30 }, { from: 28, to: 32 },
  // ขาซ้าย (Left Leg)
  { from: 23, to: 25 }, { from: 25, to: 27 }, { from: 27, to: 29 }, { from: 27, to: 31 },
  // หน้า (Face - เฉพาะขอบปากกับตา)
  { from: 9, to: 10 }, { from: 0, to: 2 }, { from: 0, to: 5 }
];

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function scaleCoord(v: number, max: number) {
  if (Number.isNaN(v) || v == null) return 0;
  if (v >= 0 && v <= 1) return v * max;
  return v;
}

function getXYC(point: any) {
  if (!point) return { x: NaN, y: NaN, c: 1 };

  if (Array.isArray(point)) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    const cRaw = point.length >= 4 ? point[3] : point.length >= 3 ? point[2] : 1;
    const c = typeof cRaw === "number" ? cRaw : Number(cRaw);
    return { x, y, c: Number.isFinite(c) ? c : 1 };
  }

  const x = Number(point.X ?? point.x);
  const y = Number(point.Y ?? point.y);
  const cRaw = point.C ?? point.c;
  const c = typeof cRaw === "number" ? cRaw : Number(cRaw);
  return { x, y, c: Number.isFinite(c) ? c : 1 };
}

type Props = {
  poseUrl?: string;
  poseUrls?: string[];
  width?: number;
  height?: number;
  autoPlay?: boolean;
  loopPlaylist?: boolean;
  loopPose?: boolean;
  onPlaylistEnd?: () => void;
  showDebug?: boolean;
};

export default function PosePlayer({
  poseUrl,
  poseUrls,
  width = 640,
  height = 360,
  autoPlay = true,
  loopPlaylist = false,
  loopPose = false,
  onPlaylistEnd,
  showDebug = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const list = useMemo(() => {
    return (poseUrls && poseUrls.length > 0 ? poseUrls : poseUrl ? [poseUrl] : [])
      .map((x) => (x ?? "").trim())
      .filter(Boolean);
  }, [poseUrl, poseUrls]);

  const [listIndex, setListIndex] = useState(0);

  const [pose, setPose] = useState<any>(null);
  const [err, setErr] = useState<string>("");
  const [playing, setPlaying] = useState(autoPlay);

  const poseRef = useRef<any>(null);

  const metaRef = useRef<{
    componentName: ComponentName;
    fps: number;
    framesLen: number;
    limbs: Array<{ from: number; to: number }>;
    availableKeys: string[];
    pointsLen: number;
  } | null>(null);

  const frameIdxRef = useRef(0);

  useEffect(() => {
    setListIndex(0);
    frameIdxRef.current = 0;
    setErr("");
    setPose(null);
    poseRef.current = null;
    metaRef.current = null;
  }, [list.join("|")]);

  const currentUrl = list[listIndex] ?? "";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setErr("");
      setPose(null);
      poseRef.current = null;
      metaRef.current = null;
      frameIdxRef.current = 0;

      if (!currentUrl) return;

      try {
        const p = await Pose.fromRemote(currentUrl);
        if (cancelled) return;

        setPose(p);
        poseRef.current = p;

        const fps: number = p.body?.fps ?? 24;
        const framesLen: number = p.body?.frames?.length ?? 0;

        const frame0 = p.body?.frames?.[0];
        const person0 = frame0?.people?.[0];

        const availableKeys = person0 ? Object.keys(person0) : [];
        const comps = (p.header?.components ?? []) as any[];

        let chosenName: string | null = null;
        let chosenLimbs: Array<{ from: number; to: number }> = [];
        let pointsLen = 0;

        for (const comp of comps) {
          const name = comp?.name;
          if (!name) continue;

          const exact = availableKeys.includes(name);
          const ciKey = availableKeys.find((k) => k.toLowerCase() === String(name).toLowerCase());
          const keyToUse = exact ? name : ciKey ? ciKey : null;
          if (!keyToUse) continue;

          const pts = person0?.[keyToUse];
          const len = Array.isArray(pts) ? pts.length : 0;
          if (len > 0) {
            chosenName = keyToUse;
            chosenLimbs = comp?.limbs ?? [];
            pointsLen = len;
            break;
          }
        }

        if (!chosenName && person0) {
          const candidate = availableKeys.find((k) => Array.isArray(person0[k]) && person0[k].length > 0);
          if (candidate) {
            chosenName = candidate;
            chosenLimbs = [];
            pointsLen = person0[candidate].length;
          }
        }

        // ✅ 2. Logic แก้ไข: ถ้าไฟล์ไม่มี Limbs ให้ใช้ MEDIAPIPE_LIMBS แทน
        if (chosenLimbs.length === 0 && chosenName) {
           const nameUpper = chosenName.toUpperCase();
           // ถ้าชื่อ Component มีคำว่า POSE, BODY หรือมีจุด 33 จุด (MediaPipe Standard)
           if (nameUpper.includes("POSE") || nameUpper.includes("BODY") || pointsLen === 33) {
             chosenLimbs = MEDIAPIPE_LIMBS;
           }
        }

        if (!chosenName || !framesLen) {
          metaRef.current = {
            componentName: chosenName ?? "(none)",
            fps,
            framesLen,
            limbs: [],
            availableKeys,
            pointsLen: 0,
          };
          return;
        }

        metaRef.current = {
          componentName: chosenName,
          fps,
          framesLen,
          limbs: chosenLimbs,
          availableKeys,
          pointsLen,
        };
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [currentUrl]);

  const drawFrame = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    m: NonNullable<typeof metaRef.current>,
    p: any,
    frameIndex: number
  ) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(15,31,47,1)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const frame = p.body?.frames?.[frameIndex];
    const person0 = frame?.people?.[0];
    if (!person0) return;

    const pts = person0[m.componentName] ?? [];
    if (!Array.isArray(pts) || pts.length === 0) return;

    ctx.strokeStyle = "rgba(0, 255, 200, 0.9)"; // ปรับสีเส้นให้สว่างขึ้น (สีเขียวนีออน)
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;

    if (Array.isArray(m.limbs) && m.limbs.length > 0) {
      ctx.globalAlpha = 0.85;
      for (const limb of m.limbs) {
        const a = pts[limb.from];
        const b = pts[limb.to];
        if (!a || !b) continue;

        const A = getXYC(a);
        const B = getXYC(b);

        const ax = scaleCoord(A.x, canvas.width);
        const ay = scaleCoord(A.y, canvas.height);
        const bx = scaleCoord(B.x, canvas.width);
        const by = scaleCoord(B.y, canvas.height);

        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    for (let i = 0; i < pts.length; i++) {
      const point = pts[i];
      if (!point) continue;

      const { x, y, c } = getXYC(point);
      const px = scaleCoord(x, canvas.width);
      const py = scaleCoord(y, canvas.height);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

      ctx.globalAlpha = 0.5 + 0.5 * clamp01(c);
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);

      const p = poseRef.current;
      const m = metaRef.current;
      if (!p || !m) return;

      if (!playing) {
        const safeIdx = Math.min(frameIdxRef.current, Math.max(0, (m.framesLen || 1) - 1));
        drawFrame(ctx, canvas, m, p, safeIdx);
        if (showDebug) drawDebug(ctx, canvas, m);
        return;
      }

      const fps = Math.max(1, m.fps || 24);
      const frameMs = 1000 / fps;
      const dt = t - last;
      if (dt < frameMs) return;
      last = t;

      const idx = frameIdxRef.current;

      if (!m.framesLen || idx >= m.framesLen) {
        if (loopPose) {
          frameIdxRef.current = 0;
          return;
        }

        setListIndex((cur) => {
          const next = cur + 1;
          if (next < list.length) {
            frameIdxRef.current = 0;
            return next;
          }
          if (loopPlaylist && list.length > 0) {
            frameIdxRef.current = 0;
            return 0;
          }

          setPlaying(false);
          onPlaylistEnd?.();
          frameIdxRef.current = Math.max(0, (m.framesLen || 1) - 1);
          return cur;
        });

        return;
      }

      drawFrame(ctx, canvas, m, p, idx);
      if (showDebug) drawDebug(ctx, canvas, m);
      frameIdxRef.current = idx + 1;
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, list.length, loopPlaylist, loopPose, onPlaylistEnd, showDebug]);

  useEffect(() => {
    setPlaying(autoPlay);
  }, [autoPlay]);

  function drawDebug(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    m: NonNullable<typeof metaRef.current>
  ) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system";
    const lines = [
      `component: ${m.componentName}`,
      `fps: ${m.fps} | frames: ${m.framesLen} | points: ${m.pointsLen ?? 0}`,
      `limbs: ${m.limbs?.length ?? 0}`, // โชว์จำนวนเส้นเชื่อมให้เห็น
      `keys: ${m.availableKeys?.slice(0, 6).join(", ")}${(m.availableKeys?.length ?? 0) > 6 ? " ..." : ""}`,
    ];
    const x = 10;
    let y = 18;
    for (const line of lines) {
      ctx.fillText(line, x, y);
      y += 16;
    }
    ctx.restore();
  }

  if (err) {
    return (
      <div className="p-3 rounded bg-red-50 text-red-700 text-sm">
        เปิดไฟล์ .pose ไม่ได้: {err}
      </div>
    );
  }

  if (!currentUrl) {
    return <div className="text-sm text-white/70">ยังไม่มีไฟล์ .pose</div>;
  }

  if (!pose || !metaRef.current) {
    return <div className="text-sm text-white/70">กำลังโหลดไฟล์ .pose...</div>;
  }

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded border border-white/20"
      />

      <div className="mt-2 flex items-center gap-2">
        <button
          className="px-3 py-1 rounded bg-white/10 text-white text-xs"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "Pause" : "Play"}
        </button>

        {showDebug && (
          <span className="text-xs text-white/60">
            {list.length > 1 ? `clip: ${listIndex + 1}/${list.length} | ` : ""}
            fps: {metaRef.current.fps}
          </span>
        )}
      </div>
    </div>
  );
}