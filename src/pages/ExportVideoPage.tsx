import { useEffect, useRef, useState } from "react";
import PosePlayer from "@/components/PosePlayer";

declare global {
  interface Window {
    __EXPORT_DONE__?: (base64Webm: string) => void;
    __EXPORT_ERROR__?: (message: string) => void;
    startExport?: (payload: {
      poseUrls: string[];
      width?: number;
      height?: number;
      fps?: number;
      mimeType?: string;
      durationMs?: number;
    }) => Promise<void>;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCanvas(timeoutMs = 15000): Promise<HTMLCanvasElement> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (canvas) return canvas;
    await sleep(100);
  }

  throw new Error("Canvas not found");
}

export default function ExportVideoPage() {
  const [poseUrls, setPoseUrls] = useState<string[]>([]);
  const [width, setWidth] = useState(960);
  const [height, setHeight] = useState(540);
  const [fps, setFps] = useState(24);
  const [exportRunId, setExportRunId] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopResolveRef = useRef<((blob: Blob) => void) | null>(null);
  const finishedRef = useRef(false);

  const finishExport = async () => {
    try {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const recorder = recorderRef.current;
      if (!recorder) {
        throw new Error("Recorder not initialized");
      }

      const blob = await new Promise<Blob>((resolve) => {
        stopResolveRef.current = resolve;

        if (recorder.state !== "inactive") {
          recorder.stop();
        } else {
          resolve(new Blob(chunksRef.current, { type: "video/webm" }));
        }
      });

      const arrBuf = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(arrBuf);
      const chunkSize = 0x8000;

      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }

      const base64 = btoa(binary);
      window.__EXPORT_DONE__?.(base64);
    } catch (err: any) {
      window.__EXPORT_ERROR__?.(err?.message || "Export finalize failed");
    }
  };

  useEffect(() => {
    window.startExport = async (payload) => {
      try {
        finishedRef.current = false;
        chunksRef.current = [];

        const nextWidth = payload.width ?? 960;
        const nextHeight = payload.height ?? 540;
        const nextFps = payload.fps ?? 24;
        const mimeType = payload.mimeType ?? "video/webm;codecs=vp9";

        setWidth(nextWidth);
        setHeight(nextHeight);
        setFps(nextFps);
        setPoseUrls(payload.poseUrls ?? []);
        setExportRunId((n) => n + 1);

        // รอ React render ใหม่
        await sleep(300);

        const canvas = await waitForCanvas(15000);

        const stream = canvas.captureStream(nextFps);
        const recorder = new MediaRecorder(stream, { mimeType });
        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "video/webm" });
          stopResolveRef.current?.(blob);
        };

        recorder.start(250);

        // fallback กันค้าง ถ้า onSequenceEnd ไม่ถูกเรียก
        const fallbackMs = payload.durationMs ?? 12000;
        window.setTimeout(() => {
          void finishExport();
        }, fallbackMs);
      } catch (err: any) {
        window.__EXPORT_ERROR__?.(err?.message || "Export failed");
      }
    };

    return () => {
      delete window.startExport;
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0B1B2A",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PosePlayer
        key={`export-${exportRunId}-${poseUrls.join("|")}`}
        playlist={poseUrls}
        autoPlay
        exportMode
        width={width}
        height={height}
        fps={fps}
        loopPlaylist={false}
        loopPose={false}
        onSequenceEnd={() => {
          void finishExport();
        }}
      />
    </div>
  );
}