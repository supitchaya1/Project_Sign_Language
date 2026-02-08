import os
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv

from supabase import create_client, Client

# =========================
# 0) Load .env
# =========================
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

POSE_DIR_ENV = os.getenv("POSE_DIR", "./poses").strip()
POSE_DIR = Path(POSE_DIR_ENV).expanduser().resolve()

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

app = FastAPI(title="ThSL Backend (Supabase + Local Pose Files)")

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

    # ป้องกันชื่อไฟล์แปลกๆ
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
# เก็บ meta ต่อไฟล์ไว้ใน memory (เร็วขึ้น)
POSE_META_CACHE: Dict[str, Dict[str, Any]] = {}

def find_binary_offset_and_frames(path: Path, landmarks: int = 33) -> Dict[str, Any]:
    """
    หา offset ของ binary float32 แบบ robust:
    - scan หา offset ที่ทำให้ (size - offset - pad) % frame_bytes == 0
    - frame_bytes = landmarks * 4(xyzc) * 4(bytes)
    """
    size = path.stat().st_size
    frame_bytes = landmarks * 4 * 4

    if size < 1024:
        raise ValueError("file too small")

    # header น่าจะไม่เกิน 200KB (กันไว้)
    scan_end = min(size, 200_000)

    # ช่วยเลือก offset ที่ใกล้ค่าที่มักเจอ (เผื่อไฟล์แนวเดียวกัน)
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
                    # score: ใกล้ target มากยิ่งดี + header ต้องไม่เล็กผิดปกติ
                    score = abs(off - target)
                    if best is None or score < best[0]:
                        best = (score, off, frames, pad)

        if best is not None:
            # เจอแล้วใน pad นี้ก็พอ
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
# 4) Endpoints
# =========================
@app.get("/")
def read_root():
    return {
        "message": "ThSL API is running!",
        "pose_dir": str(POSE_DIR),
        "cors_origins": CORS_ORIGINS,
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "supabase_connected": supabase is not None,
        "pose_directory_exists": POSE_DIR.exists(),
        "pose_directory_path": str(POSE_DIR),
    }


@app.get("/api/resolve")
def resolve_word(word: str = Query(..., description="คำศัพท์ภาษาไทยที่ต้องการค้นหา")):
    """
    ค้นหาใน Supabase (table: SL_word) → pose_filename
    ถ้าไม่เจอ: fallback เป็น {word}.pose ถ้ามีไฟล์อยู่ในเครื่อง
    """
    word = (word or "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="word cannot be empty")

    # 1) Supabase
    if supabase is not None:
        try:
            res = supabase.table("SL_word").select("word,category,pose_filename").eq("word", word).execute()
            rows = res.data or []
        except Exception as e:
            # ถ้า DB ล่ม ไม่ต้องพังทั้งระบบ
            print(f"❌ DB Error: {e}")
            rows = []
    else:
        rows = []

    # ถ้าเจอใน DB
    if rows:
        out = []
        for row in rows:
            filename = (row.get("pose_filename") or "").strip()
            if not filename:
                continue

            # เช็คมีไฟล์จริงไหม (optional แต่ช่วย debug)
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
                # ให้ frontend เอาไปต่อ BACKEND_BASE ได้เลย
                "url": f"/api/pose?name={filename}",
            })

        return {"found": True, "source": "database", "files": out}

    # 2) fallback file on disk: "{word}.pose"
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
    """
    ส่งไฟล์ .pose จากเครื่อง (POSE_DIR)
    """
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
    """
    คืน meta ของไฟล์ .pose:
    - offset ที่ถูกต้อง
    - frames
    - landmarks
    เพื่อให้ frontend parse float32 ได้ตรง (แก้ skeleton ไม่ขึ้น)
    """
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name cannot be empty")

    file_path = resolve_pose_path(name)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File '{name}' not found on disk")

    # cache by (name + mtime + size) กันไฟล์เปลี่ยน
    stat = file_path.stat()
    cache_key = f"{name}:{stat.st_size}:{int(stat.st_mtime)}"

    if cache_key in POSE_META_CACHE:
        return JSONResponse(POSE_META_CACHE[cache_key])

    try:
        meta = find_binary_offset_and_frames(file_path, landmarks=33)
        meta["name"] = name
        meta["pose_dir"] = str(POSE_DIR)

        POSE_META_CACHE.clear()  # เคลียร์แบบง่าย (กันกิน ram)
        POSE_META_CACHE[cache_key] = meta

        return JSONResponse(meta)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
