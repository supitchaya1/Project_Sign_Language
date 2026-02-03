import { useEffect, useMemo, useRef, useState } from "react";
import { Buffer } from "buffer";
import { Pose } from "pose-format";

// ✅ polyfill ให้ pose-format ใช้ใน browser
(globalThis as any).Buffer = Buffer;

type ComponentName = string;

function scaleCoord(v: number, max: number) {
  return v <= 1 ? v * max : v;
}

type Props = {
  /** เล่นไฟล์เดียว (ของเดิม) */
  poseUrl?: string;
  /** เล่นหลายไฟล์ต่อกันเป็นประโยค (ใหม่) */
  poseUrls?: string[];

  width?: number;
  height?: number;
  autoPlay?: boolean;

  /** เล่นวนซ้ำทั้ง playlist (default: false) */
  loopPlaylist?: boolean;

  /** เล่นวนซ้ำไฟล์เดียว (default: false) */
  loopPose?: boolean;

  /** เรียกเมื่อเล่นจบทั้งประโยค (playlist จบ) */
  onPlaylistEnd?: () => void;

  /** แสดง text debug เล็กๆ */
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

  // playlist state
  const list = useMemo(() => {
    const arr = (poseUrls && poseUrls.length > 0 ? poseUrls : poseUrl ? [poseUrl] : [])
      .map((x) => (x ?? "").trim())
      .filter(Boolean);
    return arr;
  }, [poseUrl, poseUrls]);

  const [listIndex, setListIndex] = useState(0);

  // playback state
  const [pose, setPose] = useState<any>(null);
  const [err, setErr] = useState<string>("");
  const [playing, setPlaying] = useState(autoPlay);

  // keep latest refs for animation loop
  const poseRef = useRef<any>(null);
  const metaRef = useRef<{
    componentName: ComponentName;
    fps: number;
    framesLen: number;
    limbs: Array<{ from: number; to: number }>;
  } | null>(null);

  const frameIdxRef = useRef(0);

  // เมื่อ playlist เปลี่ยน -> เริ่มใหม่
  useEffect(() => {
    setListIndex(0);
    frameIdxRef.current = 0;
    setErr("");
    setPose(null);
  }, [list.join("|")]);

  const currentUrl = list[listIndex] ?? "";

  // โหลด .pose จาก currentUrl
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
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [currentUrl]);

  // คำนวณ meta (component, fps, frames, limbs)
  const meta = useMemo(() => {
    if (!pose) return null;

    const comp = pose.header?.components?.[0];
    const componentName: ComponentName | null = comp?.name ?? null;

    const fps: number = pose.body?.fps ?? 24;
    const framesLen: number = pose.body?.frames?.length ?? 0;

    const limbs: Array<{ from: number; to: number }> = comp?.limbs ?? [];

    if (!componentName || !framesLen) return null;

    const m = { componentName, fps, framesLen, limbs };
    metaRef.current = m;
    return m;
  }, [pose]);

  // วาด frame
  const drawFrame = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, m: NonNullable<typeof meta>, p: any, frameIndex: number) => {
    const frame = p.body.frames[frameIndex];
    const people = frame?.people ?? [];
    const person0 = people[0];
    if (!person0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const pts = person0[m.componentName] ?? [];

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // limbs
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;

    for (const limb of m.limbs) {
      const a = pts[limb.from];
      const b = pts[limb.to];
      if (!a || !b) continue;

      const ax = scaleCoord(a.X ?? a.x ?? 0, canvas.width);
      const ay = scaleCoord(a.Y ?? a.y ?? 0, canvas.height);
      const bx = scaleCoord(b.X ?? b.x ?? 0, canvas.width);
      const by = scaleCoord(b.Y ?? b.y ?? 0, canvas.height);

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // points
    for (let i = 0; i < pts.length; i++) {
      const point = pts[i];
      if (!point) continue;

      const conf = typeof point.C === "number" ? point.C : 1;
      const x = scaleCoord(point.X ?? point.x ?? 0, canvas.width);
      const y = scaleCoord(point.Y ?? point.y ?? 0, canvas.height);

      ctx.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.min(1, conf));
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  };

  // เล่นแบบต่อกัน (playlist)
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

      // วาดเฟรมแรกแม้ paused (เพื่อให้เห็นรูป)
      if (!playing) {
        drawFrame(ctx, canvas, m, p, Math.min(frameIdxRef.current, m.framesLen - 1));
        return;
      }

      const frameMs = 1000 / Math.max(1, m.fps);
      const dt = t - last;
      if (dt < frameMs) return;
      last = t;

      const idx = frameIdxRef.current;

      // ถ้าถึงท้ายไฟล์
      if (idx >= m.framesLen) {
        // loopPose: วนไฟล์เดิม
        if (loopPose) {
          frameIdxRef.current = 0;
          return;
        }

        // ไปไฟล์ถัดไปใน playlist
        setListIndex((cur) => {
          const next = cur + 1;

          if (next < list.length) {
            // ไปไฟล์ถัดไป
            frameIdxRef.current = 0;
            return next;
          }

          // จบ playlist แล้ว
          if (loopPlaylist && list.length > 0) {
            frameIdxRef.current = 0;
            return 0;
          }

          // ไม่วน: ค้างที่ตัวสุดท้าย + pause
          setPlaying(false);
          onPlaylistEnd?.();
          frameIdxRef.current = Math.max(0, m.framesLen - 1);
          return cur;
        });

        return;
      }

      // วาด
      drawFrame(ctx, canvas, m, p, idx);
      frameIdxRef.current = idx + 1;
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, list.length, loopPlaylist, loopPose, onPlaylistEnd]);

  // ถ้า autoPlay เปลี่ยน
  useEffect(() => {
    setPlaying(autoPlay);
  }, [autoPlay]);

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

  if (!pose || !meta) {
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
            fps: {meta.fps} | frames: {meta.framesLen} | component: {meta.componentName}
          </span>
        )}
      </div>
    </div>
  );
}
