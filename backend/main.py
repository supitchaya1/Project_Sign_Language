import os
import uuid
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

# ✅ import pose_concat
from pose_concat.concat_poses import pose_sequence

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

# CORS (optional)
CORS_ORIGINS_ENV = os.getenv("CORS_ORIGINS", "").strip()
if CORS_ORIGINS_ENV:
    CORS_ORIGINS = [x.strip() for x in CORS_ORIGINS_ENV.split(",") if x.strip()]
else:
    # ค่า default สำหรับ dev
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]

app = FastAPI(title="ThSL Backend (Supabase + Local Pose Files + Pose Concat)")

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

    # กัน traversal
    if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid filename (security check)")

    filename = filename.strip()
    full_path = (POSE_DIR / filename).resolve()

    # ต้องอยู่ใต้ POSE_DIR เท่านั้น
    try:
        full_path.relative_to(POSE_DIR)
    except Exception:
        raise HTTPException(status_code=400, detail="Access denied: outside pose directory")

    return full_path


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

    best = None  # (score, offset, frames, pad)
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
# 3.5) Concat request model
# =========================
class ConcatRequest(BaseModel):
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
# ✅ NEW: Concat pose -> mp4
# =========================
@app.post("/api/concat_video")
def concat_video(req: ConcatRequest):
    try:
        if not req.pose_filenames:
            raise HTTPException(status_code=400, detail="pose_filenames cannot be empty")

        # 1) resolve + validate
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

        # 2) load Pose objects
        poses: List[Pose] = []
        for p in pose_paths:
            with open(p, "rb") as f:
                poses.append(Pose.read(f.read()))

        # 3) output path (กันชื่อชน + กัน path traversal)
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

        # ถ้าไฟล์ชื่อซ้ำ ให้สุ่มชื่อใหม่
        if out_path.exists():
            out_path = (VIDEO_DIR / f"thsl_{uuid.uuid4().hex}.mp4").resolve()

        print("✅ /api/concat_video output =", str(out_path))

        # 4) call pose_concat
        try:
            # ต้องให้ pose_sequence รองรับ output_path
            pose_sequence(poses, output_path=str(out_path))
        except TypeError as e:
            raise HTTPException(
                status_code=500,
                detail="pose_sequence() ยังไม่รองรับ output_path → กรุณาแก้ pose_concat/concat_poses.py ให้รับ output_path"
            ) from e

        # เช็คว่าไฟล์ถูกสร้างจริง
        if not out_path.exists() or out_path.stat().st_size < 1024:
            raise HTTPException(status_code=500, detail="Video file was not created or is too small")

        return FileResponse(
            path=str(out_path),
            media_type="video/mp4",
            filename=out_path.name
        )

    except HTTPException:
        # ปล่อยให้ FastAPI ส่ง detail ออกไป
        raise
    except Exception as e:
        print("❌ /api/concat_video ERROR:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"concat_video failed: {type(e).__name__}: {e}")
