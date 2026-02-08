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
  torso: "#4A90E2",
  rightArm: "#50E3C2",
  leftArm: "#F5A623",
  head: "#FFD700",
  hands: "#FEC530",
};

const POSE_EDGES: Array<[number, number]> = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [23, 25], [25, 27],
  [24, 26], [26, 28],
];

const HAND_EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

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

  const frameIdxRef = useRef(0);
  const reqIdRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

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
      frameIdxRef.current = 0;

      try {
        // ✅ ถูกต้องสำหรับ JS: fromRemote
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

          // ✅ รวม points ตามลำดับ component ใน header เพื่อให้ index ตรง (0..575)
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
    return () => { active = false; };
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

      const delta = time - lastTimeRef.current;

      if (playing && delta > interval) {
        lastTimeRef.current = time - (delta % interval);
        frameIdxRef.current++;

        if (frameIdxRef.current >= frames.length) {
          if (playlist.length > 1) {
            if (currentUrlIndex < playlist.length - 1) setCurrentUrlIndex((p) => p + 1);
            else if (loopPlaylist) setCurrentUrlIndex(0);
            else { frameIdxRef.current = frames.length - 1; setPlaying(false); }
          } else {
            if (loopPose) frameIdxRef.current = 0;
            else { frameIdxRef.current = frames.length - 1; setPlaying(false); }
          }
        }
      }

      const safeIdx = Math.min(Math.max(0, frameIdxRef.current), frames.length - 1);
      const currentPoints = frames[safeIdx];
      if (currentPoints) drawSkeleton(ctx, currentPoints, canvas.width, canvas.height, confThreshold, flipY);
    };

    reqIdRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(reqIdRef.current);
  }, [frames, playing, fps, playlist.length, currentUrlIndex, loopPlaylist, loopPose, confThreshold, flipY]);

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
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const [a, b] of edges) {
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      if (pa.c < threshold || pb.c < threshold) continue;
      if ((pa.x === 0 && pa.y === 0) || (pb.x === 0 && pb.y === 0)) continue;

      ctx.beginPath();
      ctx.moveTo(toX(pa.x), toY(pa.y));
      ctx.lineTo(toX(pb.x), toY(pb.y));
      ctx.stroke();
    }
  };

  const drawSkeleton = (
    ctx: CanvasRenderingContext2D,
    pts: Point[],
    cw: number,
    ch: number,
    threshold: number,
    flip: boolean
  ) => {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#0F1F2F";
    ctx.fillRect(0, 0, cw, ch);

    // bbox จาก pose + มือ (index ตาม signature ที่คุณสแกน: มือซ้าย 501..521, มือขวา 522..542)
    const indicesForBBox: number[] = [];
    for (let i = 0; i < 33; i++) indicesForBBox.push(i);
    for (let i = 501; i <= 542; i++) indicesForBBox.push(i);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const idx of indicesForBBox) {
      const p = pts[idx];
      if (!p || p.c < threshold) continue;
      if (p.x === 0 && p.y === 0) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (!isFinite(minX)) return;

    const padding = Math.min(cw, ch) * 0.12;
    const bodyW = Math.max(maxX - minX, 1e-6);
    const bodyH = Math.max(maxY - minY, 1e-6);
    const scale = Math.min((cw - padding * 2) / bodyW, (ch - padding * 2) / bodyH);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const toX = (x: number) => (x - cx) * scale + cw / 2;
    const toY = (y: number) => {
      const yy = (y - cy) * scale + ch / 2;
      return flip ? ch - yy : yy;
    };

    // torso fill
    const torso = [11, 12, 24, 23].map((i) => pts[i]).filter(Boolean) as Point[];
    if (torso.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(toX(torso[0].x), toY(torso[0].y));
      for (let i = 1; i < torso.length; i++) ctx.lineTo(toX(torso[i].x), toY(torso[i].y));
      ctx.closePath();
      ctx.fillStyle = COLORS.torso;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawEdges(ctx, pts, POSE_EDGES, toX, toY, threshold, "#BFD7FF", 6);

    // hands offsets ตามไฟล์คุณ
    const L_OFFSET = 501;
    const R_OFFSET = 522;

    drawEdges(
      ctx,
      pts,
      HAND_EDGES.map(([a, b]) => [a + L_OFFSET, b + L_OFFSET] as [number, number]),
      toX, toY, threshold, COLORS.hands, 4
    );

    drawEdges(
      ctx,
      pts,
      HAND_EDGES.map(([a, b]) => [a + R_OFFSET, b + R_OFFSET] as [number, number]),
      toX, toY, threshold, COLORS.hands, 4
    );

    // head (nose=0)
    const nose = pts[0];
    if (nose && nose.c >= threshold) {
      const lShoulder = pts[11];
      const rShoulder = pts[12];
      let radius = 10;
      if (lShoulder && rShoulder) {
        const shoulderDist = Math.hypot(lShoulder.x - rShoulder.x, lShoulder.y - rShoulder.y);
        radius = Math.max(10, (shoulderDist * scale) / 3);
      }
      ctx.beginPath();
      ctx.arc(toX(nose.x), toY(nose.y) - radius * 0.15, radius, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.head;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };

  if (err) return <div className="text-red-400 text-xs p-4 bg-black/20 rounded">{err}</div>;

  return (
    <div className="w-full h-full flex flex-col items-center">
      <canvas ref={canvasRef} width={width} height={height} className="rounded-lg shadow-lg bg-[#0F1F2F]" />

      <div className="flex gap-2 mt-2 items-center opacity-70 hover:opacity-100 transition-opacity">
        <button
          onClick={() => setPlaying(!playing)}
          className="text-[10px] bg-white/10 hover:bg-white/20 px-3 py-1 rounded text-white"
        >
          {playing ? "Pause" : "Play"}
        </button>

        {playlist.length > 1 && (
          <span className="text-[10px] text-white/50">
            Sequence: {currentUrlIndex + 1}/{playlist.length}
          </span>
        )}
      </div>
    </div>
  );
}
