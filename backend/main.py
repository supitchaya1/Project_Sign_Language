import os
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
from supabase import create_client, Client

# ✅ 1. โหลดค่า Config จาก .env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
# ⚠️ สำคัญ: ต้องตั้งค่า POSE_DIR ใน .env ให้ตรงกับที่อยู่โฟลเดอร์บน Desktop
# ตัวอย่างใน .env: POSE_DIR="/Users/mintpkme/Desktop/poses"
POSE_DIR_ENV = os.getenv("POSE_DIR", "./poses") 

# แปลงเป็น Path Object และตรวจสอบว่ามีอยู่จริงไหม
POSE_DIR = Path(POSE_DIR_ENV).resolve()

app = FastAPI(title="ThSL Backend (Supabase + Local Pose Files)")

# ✅ 2. ตั้งค่า CORS (เพื่อให้ React เรียก API ได้)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # อนุญาตหมด (สำหรับ Dev)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ 3. เชื่อมต่อ Supabase
if not SUPABASE_URL or not SUPABASE_KEY:
    print("⚠️ Warning: ไม่พบ SUPABASE_URL หรือ SUPABASE_KEY ใน .env")
    supabase = None
else:
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("✅ เชื่อมต่อ Supabase สำเร็จ")
    except Exception as e:
        print(f"❌ เชื่อมต่อ Supabase ไม่ได้: {e}")
        supabase = None

# ✅ 4. ฟังก์ชันตรวจสอบความปลอดภัยของชื่อไฟล์
def resolve_pose_path(filename: str) -> Path:
    if not filename or not filename.strip():
        raise HTTPException(status_code=400, detail="Filename cannot be empty")
    
    # ป้องกันการ Hack ด้วย .. (Directory Traversal)
    if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid filename security check")

    # สร้าง Path เต็ม
    full_path = (POSE_DIR / filename).resolve()

    # เช็คว่าไฟล์ยังอยู่ในโฟลเดอร์ที่กำหนดหรือไม่ (กันหลุดออกไปที่อื่น)
    if not str(full_path).startswith(str(POSE_DIR)):
        raise HTTPException(status_code=400, detail="Access denied: File outside pose directory")

    return full_path

# ===========================
# API ENDPOINTS
# ===========================

@app.get("/")
def read_root():
    return {"message": "ThSL API is running!", "pose_dir": str(POSE_DIR)}

@app.get("/api/health")
def health():
    """เช็คสถานะระบบ"""
    return {
        "status": "ok", 
        "supabase_connected": supabase is not None,
        "pose_directory_exists": POSE_DIR.exists(),
        "pose_directory_path": str(POSE_DIR)
    }

@app.get("/api/resolve")
def resolve_word(word: str = Query(..., description="คำศัพท์ภาษาไทยที่ต้องการค้นหา")):
    """
    ค้นหาคำศัพท์ใน Supabase -> ได้ชื่อไฟล์ -> สร้าง Link สำหรับโหลดไฟล์
    """
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    print(f"🔍 Searching for word: {word}")

    # 1. ค้นหาใน Supabase Table 'SL_word'
    # สมมติโครงสร้าง Table: word (text), pose_filename (text), category (text)
    try:
        res = supabase.table("SL_word").select("*").eq("word", word).execute()
    except Exception as e:
        print(f"❌ DB Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    rows = res.data or []
    
    # ถ้าไม่เจอใน DB
    if not rows:
        # Fallback: ลองเช็คว่ามีไฟล์ชื่อตรงๆ ในเครื่องไหม (เช่น "กรรไกร.pose")
        direct_filename = f"{word}.pose"
        direct_path = POSE_DIR / direct_filename
        if direct_path.exists():
             return {
                "found": True,
                "source": "disk_fallback",
                "files": [{
                    "word": word,
                    "pose_filename": direct_filename,
                    "url": f"/api/pose?name={direct_filename}"
                }]
            }
        
        return {"found": False, "message": "Word not found in DB or Disk"}

    # 2. แปลงผลลัพธ์เป็นรายการไฟล์
    results = []
    for row in rows:
        filename = row.get("pose_filename")
        if filename:
            # ตรวจสอบว่าไฟล์มีจริงในเครื่องไหม (Optional: ถ้าอยากให้ชัวร์)
            file_path = POSE_DIR / filename
            file_exists = file_path.exists()
            
            results.append({
                "word": row.get("word"),
                "category": row.get("category"),
                "pose_filename": filename,
                "file_exists_on_disk": file_exists,
                # Link นี้ Frontend เอาไปใส่ใน PosePlayer ได้เลย
                "url": f"/api/pose?name={filename}" 
            })

    return {"found": True, "source": "database", "files": results}

@app.get("/api/pose")
def get_pose_file(name: str = Query(..., description="ชื่อไฟล์ .pose (รวมนามสกุล)")):
    """
    ดึงไฟล์ Binary .pose จากเครื่องส่งกลับไป
    """
    print(f"📂 Requesting file: {name}")
    
    try:
        file_path = resolve_pose_path(name)
        
        if not file_path.exists():
            print(f"❌ File not found: {file_path}")
            raise HTTPException(status_code=404, detail=f"File '{name}' not found on server disk")
        
        return FileResponse(
            path=str(file_path),
            media_type="application/octet-stream",
            filename=name
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"❌ Error serving file: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")