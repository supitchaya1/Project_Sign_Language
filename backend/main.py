import os
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from dotenv import load_dotenv

from supabase_client import supabase

load_dotenv()

app = FastAPI(title="ThSL Backend (Supabase + Local Pose Files)")

# ----------------------------
# CORS (ให้ React เรียกได้)
# ----------------------------
cors_origins = os.getenv("CORS_ORIGINS", "")
allow_origins = [x.strip() for x in cors_origins.split(",") if x.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# โฟลเดอร์ไฟล์ .pose บนดิสก์
# ----------------------------
POSE_DIR = Path(os.getenv("POSE_DIR", "./poses")).resolve()

def validate_safe_filename(name: str) -> None:
    # อนุญาตให้มี "/" ได้ (เพราะไฟล์คุณอาจชื่อ หนุ่ม/สาว.pose)
    # แต่ต้องกัน path traversal
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Filename is empty")
    if ".." in name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if name.startswith("/") or name.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid filename")

def resolve_pose_path(pose_filename: str) -> Path:
    validate_safe_filename(pose_filename)
    p = (POSE_DIR / pose_filename).resolve()

    # กันหลุดออกนอกโฟลเดอร์ poses
    if not str(p).startswith(str(POSE_DIR)):
        raise HTTPException(status_code=400, detail="Invalid filename")

    return p

@app.get("/api/health")
def health():
    return {"ok": True, "pose_dir": str(POSE_DIR)}

# ----------------------------
# 1) Lookup ใน Supabase
# ตาราง: public.SL_word
# คอลัมน์: word, category, pose_filename
# ----------------------------
@app.get("/api/lookup")
def lookup(word: str = Query(...), category: Optional[str] = Query(None)):
    q = supabase.from_("SL_word").select("word,category,pose_filename").eq("word", word)
    if category:
        q = q.eq("category", category)

    res = q.execute()
    rows = res.data or []

    if not rows:
        raise HTTPException(status_code=404, detail="Word not found in Supabase")

    return {"count": len(rows), "rows": rows}

# ----------------------------
# 2) โหลดไฟล์ .pose จากดิสก์
# ใช้ query param เพื่อรองรับชื่อที่มี "/"
# ----------------------------
@app.get("/api/pose")
def get_pose(name: str = Query(..., description="pose_filename เช่น ก.pose หรือ หนุ่ม/สาว.pose")):
    p = resolve_pose_path(name)

    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Pose file not found on disk")

    return FileResponse(
        path=str(p),
        media_type="application/octet-stream",
        filename=p.name,
    )

# ----------------------------
# 3) Resolve: word -> list of downloadable pose urls
# ----------------------------
@app.get("/api/resolve")
def resolve(word: str = Query(...), category: Optional[str] = Query(None)):
    q = supabase.from_("SL_word").select("word,category,pose_filename").eq("word", word)
    if category:
        q = q.eq("category", category)

    res = q.execute()
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Word not found in Supabase")

    files: List[Dict[str, Any]] = []
    for r in rows:
        pose_filename = r.get("pose_filename")
        if not pose_filename:
            continue
        files.append({
            "word": r.get("word"),
            "category": r.get("category"),
            "pose_filename": pose_filename,
            # ให้ frontend เอาไปเรียกโหลดไฟล์
            "pose_url": f"/api/pose?name={pose_filename}"
        })

    return {"count": len(files), "files": files}
