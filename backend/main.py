import os
import uuid
import json
import tempfile
import subprocess
import traceback
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
from pydantic import BaseModel

from supabase import create_client, Client
from pose_format import Pose

# ถ้าจะใช้ /api/concat_video เดิม ต้อง uncomment บรรทัดนี้และให้ไฟล์มีจริง
# from pose_concat.concat_poses import pose_sequence

# =========================
# 0) Load .env
# =========================
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

POSE_DIR_ENV = os.getenv("POSE_DIR", "./poses").strip()
POSE_DIR = Path(POSE_DIR_ENV).expanduser().resolve()

VIDEO_DIR_ENV = os.getenv("VIDEO_DIR", "").strip()
VIDEO_DIR = (
    Path(VIDEO_DIR_ENV).expanduser().resolve()
    if VIDEO_DIR_ENV
    else (POSE_DIR / "_videos").resolve()
)
VIDEO_DIR.mkdir(parents=True, exist_ok=True)

PORT = int(os.getenv("PORT", "8000"))

# URL ของ frontend สำหรับให้ Puppeteer เปิดหน้า /export-video
# local: http://127.0.0.1:8080
# prod:  https://signproject.duckdns.org
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://127.0.0.1:8080").strip()
BACKEND_PUBLIC_BASE_URL = os.getenv("BACKEND_PUBLIC_BASE_URL", "http://127.0.0.1:8000").strip()
# คำสั่ง node (เผื่อบางเครื่องต้องใช้ /usr/bin/node)
NODE_BIN = os.getenv("NODE_BIN", "node").strip()

# คำสั่ง ffmpeg
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg").strip()

# CORS (optional)
CORS_ORIGINS_ENV = os.getenv("CORS_ORIGINS", "").strip()
if CORS_ORIGINS_ENV:
    CORS_ORIGINS = [x.strip() for x in CORS_ORIGINS_ENV.split(",") if x.strip()]
else:
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]

app = FastAPI(title="ThSL Backend (Supabase + Local Pose Files + Pose Concat + Export MP4)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# 1) Supabase client
# =========================
supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("✅ Supabase connected")
    except Exception as e:
        print(f"❌ Supabase connect failed: {e}")
        supabase = None
else:
    print("⚠️ SUPABASE_URL / SUPABASE_KEY missing → supabase_connected = false")

# =========================
# 2) Utilities
# =========================
def resolve_pose_path(filename: str) -> Path:
    if not filename or not filename.strip():
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid filename (security check)")

    filename = filename.strip()
    full_path = (POSE_DIR / filename).resolve()

    try:
        full_path.relative_to(POSE_DIR)
    except Exception:
        raise HTTPException(status_code=400, detail="Access denied: outside pose directory")

    return full_path


def build_pose_url(filename: str) -> str:
    safe_name = filename.strip()
    return f"{BACKEND_PUBLIC_BASE_URL.rstrip('/')}/api/pose?name={safe_name}"

# =========================
# 3) Pose meta scan + cache
# =========================
POSE_META_CACHE: Dict[str, Dict[str, Any]] = {}


def find_binary_offset_and_frames(path: Path, landmarks: int = 33) -> Dict[str, Any]:
    size = path.stat().st_size
    frame_bytes = landmarks * 4 * 4

    if size < 1024:
        raise ValueError("file too small")

    scan_end = min(size, 200_000)
    target = 14652

    best = None
    for pad in (0, 1, 2, 3):
        for off in range(0, scan_end):
            remain = size - off - pad
            if remain <= 0:
                break
            if remain % frame_bytes == 0:
                frames = remain // frame_bytes
                if frames >= 10:
                    score = abs(off - target)
                    if best is None or score < best[0]:
                        best = (score, off, frames, pad)

        if best is not None:
            break

    if best is None:
        raise ValueError("cannot find valid offset for float32 frames")

    _, off, frames, pad = best
    return {
        "offset": off,
        "frames": frames,
        "landmarks": landmarks,
        "pad": pad,
        "size": size,
        "frame_bytes": frame_bytes,
    }


# =========================
# 3.5) Request models
# =========================
class ConcatRequest(BaseModel):
    pose_filenames: List[str]
    output_name: Optional[str] = None


class RenderSentenceRequest(BaseModel):
    pose_filenames: List[str]
    output_name: Optional[str] = None


# =========================
# 4) Endpoints
# =========================
@app.get("/")
def read_root():
    return {
        "message": "ThSL API is running!",
        "pose_dir": str(POSE_DIR),
        "video_dir": str(VIDEO_DIR),
        "frontend_base_url": FRONTEND_BASE_URL,
        "cors_origins": CORS_ORIGINS,
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "supabase_connected": supabase is not None,
        "pose_directory_exists": POSE_DIR.exists(),
        "pose_directory_path": str(POSE_DIR),
        "video_directory_exists": VIDEO_DIR.exists(),
        "video_directory_path": str(VIDEO_DIR),
        "frontend_base_url": FRONTEND_BASE_URL,
        "node_bin": NODE_BIN,
        "ffmpeg_bin": FFMPEG_BIN,
    }


@app.get("/api/resolve")
def resolve_word(word: str = Query(..., description="คำศัพท์ภาษาไทยที่ต้องการค้นหา")):
    word = (word or "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="word cannot be empty")

    if supabase is not None:
        try:
            res = (
                supabase.table("SL_word")
                .select("word,category,pose_filename")
                .eq("word", word)
                .execute()
            )
            rows = res.data or []
        except Exception as e:
            print(f"❌ DB Error: {e}")
            rows = []
    else:
        rows = []

    if rows:
        out = []
        for row in rows:
            filename = (row.get("pose_filename") or "").strip()
            if not filename:
                continue

            try:
                file_path = resolve_pose_path(filename)
                exists = file_path.exists()
            except Exception:
                exists = False

            out.append({
                "word": row.get("word"),
                "category": row.get("category"),
                "pose_filename": filename,
                "file_exists_on_disk": exists,
                "url": f"/api/pose?name={filename}",
            })

        return {"found": True, "source": "database", "files": out}

    direct_filename = f"{word}.pose"
    direct_path = (POSE_DIR / direct_filename)
    if direct_path.exists():
        return {
            "found": True,
            "source": "disk_fallback",
            "files": [{
                "word": word,
                "category": None,
                "pose_filename": direct_filename,
                "file_exists_on_disk": True,
                "url": f"/api/pose?name={direct_filename}",
            }]
        }

    return {"found": False, "message": "Word not found in DB or Disk", "files": []}


@app.get("/api/pose")
def get_pose_file(name: str = Query(..., description="ชื่อไฟล์ .pose (รวม .pose)")):
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name cannot be empty")

    file_path = resolve_pose_path(name)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File '{name}' not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type="application/octet-stream",
        filename=name
    )


@app.get("/api/pose_meta")
def pose_meta(name: str = Query(..., description="ชื่อไฟล์ .pose (รวม .pose)")):
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name cannot be empty")

    file_path = resolve_pose_path(name)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File '{name}' not found on disk")

    stat = file_path.stat()
    cache_key = f"{name}:{stat.st_size}:{int(stat.st_mtime)}"

    if cache_key in POSE_META_CACHE:
        return JSONResponse(POSE_META_CACHE[cache_key])

    try:
        meta = find_binary_offset_and_frames(file_path, landmarks=33)
        meta["name"] = name
        meta["pose_dir"] = str(POSE_DIR)

        POSE_META_CACHE.clear()
        POSE_META_CACHE[cache_key] = meta

        return JSONResponse(meta)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =========================
# Optional: Concat pose -> mp4 (ของเดิม)
# =========================
@app.post("/api/concat_video")
def concat_video(req: ConcatRequest):
    try:
        # from pose_concat.concat_poses import pose_sequence
        if not req.pose_filenames:
            raise HTTPException(status_code=400, detail="pose_filenames cannot be empty")

        pose_paths: List[Path] = []
        for name in req.pose_filenames:
            clean = (name or "").strip()
            if not clean:
                continue
            p = resolve_pose_path(clean)
            if not p.exists():
                raise HTTPException(status_code=404, detail=f"Pose file not found: {clean}")
            pose_paths.append(p)

        if not pose_paths:
            raise HTTPException(status_code=400, detail="No valid pose files provided")

        print("✅ /api/concat_video pose_filenames =", [p.name for p in pose_paths])

        poses: List[Pose] = []
        for p in pose_paths:
            with open(p, "rb") as f:
                poses.append(Pose.read(f.read()))

        out_name = (req.output_name or "").strip()
        if not out_name:
            out_name = f"thsl_{uuid.uuid4().hex}.mp4"
        if not out_name.lower().endswith(".mp4"):
            out_name += ".mp4"

        out_path = (VIDEO_DIR / out_name).resolve()
        try:
            out_path.relative_to(VIDEO_DIR)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid output_name (security check)")

        if out_path.exists():
            out_path = (VIDEO_DIR / f"thsl_{uuid.uuid4().hex}.mp4").resolve()

        print("✅ /api/concat_video output =", str(out_path))

        try:
            pose_sequence(poses, output_path=str(out_path))
        except NameError:
            raise HTTPException(
                status_code=500,
                detail="pose_sequence is not imported. Uncomment import from pose_concat.concat_poses."
            )
        except TypeError as e:
            raise HTTPException(
                status_code=500,
                detail="pose_sequence() ยังไม่รองรับ output_path → กรุณาแก้ pose_concat/concat_poses.py ให้รับ output_path"
            ) from e

        if not out_path.exists() or out_path.stat().st_size < 1024:
            raise HTTPException(status_code=500, detail="Video file was not created or is too small")

        return FileResponse(
            path=str(out_path),
            media_type="video/mp4",
            filename=out_path.name
        )

    except HTTPException:
        raise
    except Exception as e:
        print("❌ /api/concat_video ERROR:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"concat_video failed: {type(e).__name__}: {e}")


# =========================
# NEW: Render PosePlayer canvas -> webm -> mp4
# =========================
@app.post("/api/render_sentence_mp4")
def render_sentence_mp4(req: RenderSentenceRequest):
    try:
        if not req.pose_filenames:
            raise HTTPException(status_code=400, detail="pose_filenames cannot be empty")

        pose_urls: List[str] = []
        for name in req.pose_filenames:
            clean = (name or "").strip()
            if not clean:
                continue

            p = resolve_pose_path(clean)
            if not p.exists():
                raise HTTPException(status_code=404, detail=f"Pose file not found: {clean}")

            pose_urls.append(build_pose_url(clean))

        if not pose_urls:
            raise HTTPException(status_code=400, detail="No valid pose files provided")

        out_name = (req.output_name or "").strip()
        if not out_name:
            out_name = f"sentence_{uuid.uuid4().hex}.mp4"
        if not out_name.lower().endswith(".mp4"):
            out_name += ".mp4"

        out_path = (VIDEO_DIR / out_name).resolve()
        try:
            out_path.relative_to(VIDEO_DIR)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid output_name (security check)")

        if out_path.exists():
            out_path = (VIDEO_DIR / f"sentence_{uuid.uuid4().hex}.mp4").resolve()

        node_script = (Path(__file__).resolve().parent / "render" / "export-video.mjs").resolve()
        if not node_script.exists():
            raise HTTPException(
                status_code=500,
                detail=f"Node export script not found: {node_script}"
            )

        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            webm_path = tmpdir_path / "sentence.webm"
            payload_path = tmpdir_path / "payload.json"

            payload = {
                "poseUrls": pose_urls,
                "width": 960,
                "height": 540,
                "fps": 24,
                "mimeType": "video/webm;codecs=vp9",
                "durationMs": 12000,
            }

            payload_path.write_text(
                json.dumps(payload, ensure_ascii=False),
                encoding="utf-8",
            )

            print("✅ /api/render_sentence_mp4 pose_urls =", pose_urls)
            print("✅ /api/render_sentence_mp4 payload =", payload)
            print("✅ /api/render_sentence_mp4 node_script =", str(node_script))

            run_node = subprocess.run(
                [
                    NODE_BIN,
                    str(node_script),
                    FRONTEND_BASE_URL,
                    str(webm_path),
                    str(payload_path),
                ],
                capture_output=True,
                text=True,
                timeout=180,
            )

            print("▶ node stdout:\n", run_node.stdout)
            print("▶ node stderr:\n", run_node.stderr)

            if run_node.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"Puppeteer failed: {run_node.stderr or run_node.stdout}"
                )

            if not webm_path.exists() or webm_path.stat().st_size < 1024:
                raise HTTPException(
                    status_code=500,
                    detail="WebM file was not created or is too small"
                )

            run_ffmpeg = subprocess.run(
                [
                    FFMPEG_BIN,
                    "-y",
                    "-i", str(webm_path),
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    str(out_path),
                ],
                capture_output=True,
                text=True,
                timeout=180,
            )

            print("▶ ffmpeg stdout:\n", run_ffmpeg.stdout)
            print("▶ ffmpeg stderr:\n", run_ffmpeg.stderr)

            if run_ffmpeg.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=f"ffmpeg failed: {run_ffmpeg.stderr or run_ffmpeg.stdout}"
                )

        if not out_path.exists() or out_path.stat().st_size < 1024:
            raise HTTPException(status_code=500, detail="MP4 file was not created or is too small")

        return FileResponse(
            path=str(out_path),
            media_type="video/mp4",
            filename=out_path.name,
        )

    except HTTPException:
        raise
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="render_sentence_mp4 timeout")
    except Exception as e:
        print("❌ /api/render_sentence_mp4 ERROR:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"render_sentence_mp4 failed: {type(e).__name__}: {e}")