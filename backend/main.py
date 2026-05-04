import os
import re
import uuid
import json
import tempfile
import subprocess
import traceback
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
from pydantic import BaseModel

from supabase import create_client, Client
from pose_format import Pose
from openai import OpenAI

# =========================
# 0) Load .env
# =========================
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "").strip()
SUMMARY_MODEL = os.getenv("SUMMARY_MODEL", "gpt-4o-mini").strip()

if OPENAI_API_KEY:
    if OPENAI_BASE_URL:
        openai_client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
    else:
        openai_client = OpenAI(api_key=OPENAI_API_KEY)
else:
    openai_client = None

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

FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://127.0.0.1:8080").strip()
BACKEND_PUBLIC_BASE_URL = os.getenv("BACKEND_PUBLIC_BASE_URL", "http://127.0.0.1:8000").strip()
NODE_BIN = os.getenv("NODE_BIN", "node").strip()
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg").strip()

CORS_ORIGINS_ENV = os.getenv("CORS_ORIGINS", "").strip()
if CORS_ORIGINS_ENV:
    CORS_ORIGINS = [x.strip() for x in CORS_ORIGINS_ENV.split(",") if x.strip()]
else:
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "https://signproject.duckdns.org",
    ]

app = FastAPI(title="ThSL Backend - SL_word based translation")

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
    print("⚠️ SUPABASE_URL / SUPABASE_KEY missing")


# =========================
# 2) Request models
# =========================
class TextRequest(BaseModel):
    text: str


class ConcatRequest(BaseModel):
    pose_filenames: List[str]
    output_name: Optional[str] = None


class RenderSentenceRequest(BaseModel):
    pose_filenames: List[str]
    output_name: Optional[str] = None


# =========================
# 3) General utilities
# =========================
def clean_text(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"[\u200B\u200C\u200D\uFEFF]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_word(word: str) -> str:
    return clean_text(word).replace(" ", "")


def is_valid_meaningful_word(word: str) -> bool:
    """
    กรองไม่ให้ระบบเอาตัวอักษรเดี่ยว สระ วรรณยุกต์ หรือเครื่องหมาย
    มาเป็นคำสำหรับแปลภาษามือ เช่น ท ี ่ ก ะ ฯลฯ
    """
    word = clean_text(word)

    if not word:
        return False

    # อนุญาตตัวเลข เช่น 1, 20, 100
    if re.fullmatch(r"[0-9]+", word):
        return True

    # ตัดคำที่เป็นตัวอักษรเดี่ยว เช่น ก ข ท
    if len(word) <= 1:
        return False

    # ตัดเฉพาะสระ/วรรณยุกต์/เครื่องหมายกำกับเสียงไทย
    if re.fullmatch(r"[\u0E31-\u0E4E]+", word):
        return False

    # ตัด punctuation หรือ symbol ที่ไม่ใช่คำไทย/อังกฤษ/ตัวเลข
    if re.fullmatch(r"[^A-Za-z0-9ก-๙]+", word):
        return False

    # ต้องมีอักษรไทย อังกฤษ หรือตัวเลขอย่างน้อยหนึ่งตัว
    if not re.search(r"[A-Za-z0-9ก-๙]", word):
        return False

    return True


def is_sentence_too_long(text: str) -> bool:
    text = clean_text(text)
    return len(text) > 60 or len(text.split()) > 12


def resolve_pose_path(filename: str) -> Path:
    if not filename or not filename.strip():
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    filename = filename.strip()

    if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    full_path = (POSE_DIR / filename).resolve()

    try:
        full_path.relative_to(POSE_DIR)
    except Exception:
        raise HTTPException(status_code=400, detail="Access denied")

    return full_path


def build_pose_url(filename: str) -> str:
    safe_name = quote(filename.strip())
    return f"{BACKEND_PUBLIC_BASE_URL.rstrip('/')}/api/pose?name={safe_name}"


# =========================
# 4) ThSL role + rule engine
# =========================
ROLE_PRIORITY_DEFAULT = 999

CATEGORY_ROLE_FALLBACK: Dict[str, Tuple[str, int]] = {
    # subject / pronoun
    "สรรพนาม": ("Pronoun", 10),
    "บุคคล": ("S", 10),
    "ผู้กระทำ": ("S", 10),

    # verb / object / place / time
    "คำกริยา": ("V", 40),
    "กริยา": ("V", 40),
    "กรรม": ("O", 30),
    "คำนาม": ("O", 30),
    "สถานที่": ("PP(Place)", 20),
    "เวลา": ("Adv(Time)", 5),
    "วัน": ("Adv(Time)", 5),

    # negative / question
    "ปฏิเสธ": ("NEG", 90),
    "คำปฏิเสธ": ("NEG", 90),
    "คำถาม": ("Q(?)", 100),
    "คำถามทั่วไป": ("Q(?)", 100),
    "ใคร": ("Who(?)", 100),
    "อะไร": ("What(?)", 100),
    "ของใคร": ("Whose(?)", 100),

    # other common classes
    "คำคุณศัพท์": ("Adj", 60),
    "คุณศัพท์": ("Adj", 60),
    "ตัวเลข": ("Number", 70),
    "จำนวน": ("Number", 70),
    "เงิน": ("Money", 65),
    "สกุลเงิน": ("Currency", 64),
    "อายุ": ("Age", 65),
    "ปี": ("Year", 66),
}

WORD_ROLE_FALLBACK: Dict[str, str] = {
    "ฉัน": "S",
    "ผม": "S",
    "ดิฉัน": "S",
    "เรา": "S",
    "เขา": "S",
    "เธอ": "S",
    "คุณ": "S",
    "น้อง": "S",
    "พี่": "S",
    "แม่": "S",
    "พ่อ": "S",

    "ไป": "V",
    "มา": "V",
    "กิน": "V",
    "ดื่ม": "V",
    "ทำ": "V",
    "เรียน": "V",
    "อ่าน": "V",
    "เขียน": "V",
    "ดู": "V",
    "ฟัง": "V",
    "ซื้อ": "V",
    "ขาย": "V",
    "ชอบ": "V",
    "รัก": "V",
    "อยู่": "V",
    "มี": "V",

    "ไม่": "NEG",
    "ไม่ได้": "NEG",
    "ไม่ใช่": "NEG",
    "ยังไม่": "NEG",

    "วันนี้": "Adv(Time)",
    "พรุ่งนี้": "Adv(Time)",
    "เมื่อวาน": "Adv(Time)",
    "ตอนเช้า": "Adv(Time)",
    "ตอนกลางวัน": "Adv(Time)",
    "ตอนเย็น": "Adv(Time)",
    "กลางคืน": "Adv(Time)",

    "ที่ไหน": "When/Why/Where/How(?)",
    "เมื่อไร": "When/Why/Where/How(?)",
    "เมื่อไหร่": "When/Why/Where/How(?)",
    "ทำไม": "When/Why/Where/How(?)",
    "อย่างไร": "When/Why/Where/How(?)",
    "ยังไง": "When/Why/Where/How(?)",
    "อะไร": "What(?)",
    "ใคร": "Who(?)",
    "ของใคร": "Whose(?)",
    "ไหม": "Q(?)",
    "หรือ": "Q(?)",
    "หรือยัง": "Q(?)",
}

THSL_RULES: List[Dict[str, List[str]]] = [
    {"thai": ["S", "V"], "thsl": ["S", "V"]},
    {"thai": ["S", "NEG", "V"], "thsl": ["S", "NEG", "V"]},
    {"thai": ["S", "V", "O"], "thsl": ["O", "S", "V"]},
    {"thai": ["S", "NEG", "V", "O"], "thsl": ["O", "S", "V", "NEG"]},
    {"thai": ["S", "V", "diO", "indO"], "thsl": ["indO", "diO", "S", "V"]},
    {"thai": ["S", "NEG", "V", "diO", "indO"], "thsl": ["indO", "diO", "S", "V", "NEG"]},
    {"thai": ["O", "S", "V"], "thsl": ["O", "S", "V"]},
    {"thai": ["O", "NEG", "S", "V"], "thsl": ["O", "S", "V", "NEG"]},
    {"thai": ["S", "V", "PP(Place)"], "thsl": ["PP(Place)", "S", "V"]},
    {"thai": ["S", "V", "NEG", "PP(Place)"], "thsl": ["PP(Place)", "S", "V", "NEG"]},
    {"thai": ["S", "V", "O", "PP(Place)"], "thsl": ["PP(Place)", "O", "S", "V"]},
    {"thai": ["S", "NEG", "V", "O", "PP(Place)"], "thsl": ["PP(Place)", "O", "S", "V", "NEG"]},
    {"thai": ["S", "V", "Adv(Time)"], "thsl": ["Adv(Time)", "S", "V"]},
    {"thai": ["S", "NEG", "V", "Adv(Time)"], "thsl": ["Adv(Time)", "S", "V", "NEG"]},
    {"thai": ["S", "V", "O", "Adv(Time)"], "thsl": ["Adv(Time)", "O", "S", "V"]},
    {"thai": ["S", "NEG", "V", "O", "Adv(Time)"], "thsl": ["Adv(Time)", "O", "S", "V", "NEG"]},
    {"thai": ["S", "V", "ClausalVerb"], "thsl": ["ClausalVerb", "S", "V"]},
    {"thai": ["S", "NEG", "V", "ClausalVerb"], "thsl": ["ClausalVerb", "S", "V", "NEG"]},
    {"thai": ["S", "V", "ClausalVerb", "O"], "thsl": ["O", "ClausalVerb", "S", "V"]},
    {"thai": ["S", "NEG", "V", "ClausalVerb", "O"], "thsl": ["O", "ClausalVerb", "S", "V", "NEG"]},
    {"thai": ["NP", "PAdj", "V"], "thsl": ["PAdj", "NP", "V"]},
    {"thai": ["NP", "PAdj", "NEG", "V"], "thsl": ["PAdj", "NP", "V", "NEG"]},
    {"thai": ["NP", "PAdj", "V", "O"], "thsl": ["O", "PAdj", "NP", "V"]},
    {"thai": ["NP", "PAdj", "NEG", "V", "O"], "thsl": ["O", "PAdj", "NP", "V", "NEG"]},
    {"thai": ["S", "ComparativeAdj", "O"], "thsl": ["O", "S", "ComparativeAdj"]},
    {"thai": ["S", "V", "Money", "Number", "Currency"], "thsl": ["Currency", "Number", "S", "V"]},
    {"thai": ["S", "Age", "Number", "Year"], "thsl": ["S", "Age/Year", "Number"]},
    {"thai": ["S", "Break", "O"], "thsl": ["O", "S", "Break"]},
    {"thai": ["S", "V", "O", "PP(Place)", "Adv(Time)"], "thsl": ["Adv(Time)", "PP(Place)", "O", "S", "V"]},
    {"thai": ["S", "NEG", "V", "O", "PP(Place)", "Adv(Time)"], "thsl": ["Adv(Time)", "PP(Place)", "O", "S", "V", "NEG"]},
    {"thai": ["S", "Adj", "V", "O", "Adj"], "thsl": ["O", "Adj", "S", "Adj", "V"]},
    {"thai": ["S", "V", "When/Why/Where/How(?)"], "thsl": ["S", "V", "When/Why/Where/How(?)"]},
    {"thai": ["O", "Whose(?)"], "thsl": ["O", "Whose(?)"]},
    {"thai": ["Pronoun", "V2B", "Who(?)"], "thsl": ["Pronoun", "V2B", "Who(?)"]},
    {"thai": ["S", "V", "O", "Q(?)"], "thsl": ["O", "S", "V", "Q(?)"]},
    {"thai": ["S", "V", "What(?)"], "thsl": ["S", "V", "What(?)"]},
    {"thai": ["O", "Adj"], "thsl": ["O", "Adj"]},
    {"thai": ["O", "NEG", "Adj"], "thsl": ["O", "NEG", "Adj"]},
    {"thai": ["O", "Adj1", "Adj2"], "thsl": ["O", "Adj1", "Adj2"]},
    {"thai": ["O", "Adj1", "NEG", "Adj2"], "thsl": ["O", "Adj1", "Adj2", "NEG"]},
]

PLACE_WORDS = {
    "โรงเรียน", "บ้าน", "ตลาด", "วัด", "มหาวิทยาลัย", "ห้องน้ำ", "โรงพยาบาล",
    "คลินิก", "ร้านค้า", "ร้านอาหาร", "กรุงเทพ", "ต่างจังหวัด"
}

TIME_WORDS = {
    "วันนี้", "พรุ่งนี้", "เมื่อวาน", "ตอนเช้า", "ตอนกลางวัน", "ตอนเย็น",
    "กลางคืน", "เช้า", "เย็น", "เดือน", "ปี"
}

QUESTION_WORDS = {
    "อะไร", "ใคร", "ที่ไหน", "เมื่อไร", "เมื่อไหร่", "ทำไม",
    "อย่างไร", "ยังไง", "ไหม", "หรือยัง", "ของใคร"
}

VERB_WORDS = {
    "ไป", "มา", "กิน", "ดื่ม", "ทำ", "เรียน", "อ่าน", "เขียน", "ดู",
    "ฟัง", "ซื้อ", "ขาย", "ชอบ", "รัก", "อยู่", "มี", "นอน", "ตื่น",
    "สรุป", "พูด", "บอก"
}

SUBJECT_WORDS = {"ฉัน", "ผม", "ดิฉัน", "เรา", "เขา", "เธอ", "คุณ", "น้อง", "พี่", "แม่", "พ่อ"}


def normalize_role(role: str) -> str:
    r = clean_text(role)
    mapping = {
        "Q": "Q(?)",
        "What": "What(?)",
        "Who": "Who(?)",
        "Whose": "Whose(?)",
        "Place": "PP(Place)",
        "Time": "Adv(Time)",
        "Adv": "Adv(Time)",
    }
    return mapping.get(r, r)


def fetch_category_role_map() -> Dict[str, Tuple[str, int]]:
    role_map: Dict[str, Tuple[str, int]] = {}

    for category, item in CATEGORY_ROLE_FALLBACK.items():
        role_map[normalize_word(category)] = item

    if supabase is None:
        return role_map

    try:
        res = supabase.table("sl_category_role").select("category,role,priority").execute()
        rows = res.data or []
        for row in rows:
            category = clean_text(row.get("category") or "")
            role = normalize_role(row.get("role") or "")
            priority = int(row.get("priority") or ROLE_PRIORITY_DEFAULT)
            if category and role:
                role_map[normalize_word(category)] = (role, priority)
    except Exception as e:
        print(f"⚠️ Cannot load sl_category_role: {e}")

    return role_map


def infer_role(match: Dict[str, Any], role_map: Dict[str, Tuple[str, int]]) -> Tuple[str, int]:
    word = clean_text(match.get("word") or "")
    category = clean_text(match.get("category") or "")

    if word in WORD_ROLE_FALLBACK:
        role = WORD_ROLE_FALLBACK[word]
        return role, 1

    if word in TIME_WORDS:
        return "Adv(Time)", 5

    if word in PLACE_WORDS:
        return "PP(Place)", 20

    if word in SUBJECT_WORDS:
        return "S", 10

    if word in VERB_WORDS:
        return "V", 40

    if word in QUESTION_WORDS:
        if word == "อะไร":
            return "What(?)", 100
        if word == "ใคร":
            return "Who(?)", 100
        if word == "ของใคร":
            return "Whose(?)", 100
        if word in {"ไหม", "หรือยัง"}:
            return "Q(?)", 100
        return "When/Why/Where/How(?)", 100

    if re.fullmatch(r"[0-9]+", word):
        return "Number", 70

    category_key = normalize_word(category)
    if category_key in role_map:
        return role_map[category_key]

    return "O", ROLE_PRIORITY_DEFAULT


def role_for_rule(role: str) -> str:
    if role in {"Pronoun"}:
        return "S"
    if role in {"Adj1", "Adj2"}:
        return "Adj"
    if role in {"Age", "Year"}:
        return role
    return role


def remove_duplicate_keep_order(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []

    for item in items:
        key = normalize_word(item.get("word") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)

    return out


def match_rule(roles: List[str]) -> Optional[List[str]]:
    normalized_roles = [role_for_rule(r) for r in roles]

    for rule in THSL_RULES:
        thai = rule["thai"]

        if len(thai) != len(normalized_roles):
            continue

        ok = True
        for a, b in zip(thai, normalized_roles):
            if a == "Age/Year":
                if b not in {"Age", "Year"}:
                    ok = False
                    break
            elif a != b:
                ok = False
                break

        if ok:
            return rule["thsl"]

    return None


def fallback_thsl_order(tagged: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    bucket_order = [
        "Adv(Time)",
        "PP(Place)",
        "O",
        "S",
        "Pronoun",
        "NP",
        "PAdj",
        "Adj",
        "Adj1",
        "Adj2",
        "ComparativeAdj",
        "ClausalVerb",
        "V2B",
        "V",
        "NEG",
        "Money",
        "Currency",
        "Number",
        "Age",
        "Year",
        "When/Why/Where/How(?)",
        "What(?)",
        "Who(?)",
        "Whose(?)",
        "Q(?)",
        "Break",
    ]

    score = {role: i for i, role in enumerate(bucket_order)}

    return sorted(
        tagged,
        key=lambda x: (
            score.get(x.get("role", ""), 500),
            int(x.get("position", 10**9)),
        )
    )


def reorder_by_rule(tagged: List[Dict[str, Any]], thsl_order: List[str]) -> List[Dict[str, Any]]:
    used = set()
    out: List[Dict[str, Any]] = []

    def compatible(wanted: str, actual: str) -> bool:
        if wanted == "Age/Year":
            return actual in {"Age", "Year"}
        if wanted == "S":
            return actual in {"S", "Pronoun"}
        if wanted == "Adj":
            return actual in {"Adj", "Adj1", "Adj2"}
        return wanted == actual

    for wanted_role in thsl_order:
        idx = next(
            (
                i for i, item in enumerate(tagged)
                if i not in used and compatible(wanted_role, item.get("role", ""))
            ),
            -1
        )
        if idx >= 0:
            out.append(tagged[idx])
            used.add(idx)

    for i, item in enumerate(tagged):
        if i not in used:
            out.append(item)

    return out


def apply_rule_based_order(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    เรียงคำเป็น ThSL Pattern:
    1) tag role จาก sl_category_role/category/word fallback
    2) ถ้าตรง rule 40 แบบ ใช้ rule นั้น
    3) ถ้าไม่ตรง ใช้ fallback ลำดับ Time + Place + Object + Subject + Verb + NEG + Question
    """
    cleaned = remove_duplicate_keep_order(matches)

    if not cleaned:
        return []

    role_map = fetch_category_role_map()
    tagged: List[Dict[str, Any]] = []

    for m in cleaned:
        role, priority = infer_role(m, role_map)
        item = dict(m)
        item["role"] = role
        item["role_priority"] = priority
        tagged.append(item)

    roles = [item["role"] for item in tagged]
    thsl_order = match_rule(roles)

    if thsl_order:
        ordered = reorder_by_rule(tagged, thsl_order)
    else:
        ordered = fallback_thsl_order(tagged)

    return ordered


# =========================
# 5) Vocabulary + matching
# =========================
def fetch_vocabulary_rows() -> List[Dict[str, Any]]:
    if supabase is None:
        raise HTTPException(status_code=500, detail="Supabase is not connected")

    tables = ["SL_word", "SL_word_rows"]
    all_rows: List[Dict[str, Any]] = []

    for table_name in tables:
        try:
            start = 0
            step = 1000

            while True:
                res = (
                    supabase.table(table_name)
                    .select("word,category,pose_filename")
                    .range(start, start + step - 1)
                    .execute()
                )
                rows = res.data or []

                if not rows:
                    break

                for row in rows:
                    word = clean_text(row.get("word") or "")
                    pose_filename = clean_text(row.get("pose_filename") or "")

                    if not word or not pose_filename:
                        continue

                    # ไม่เอาตัวอักษรเดี่ยว/สระ/วรรณยุกต์จาก SL_word มาใช้เป็นคำแปล
                    if not is_valid_meaningful_word(word):
                        continue

                    if not pose_filename.lower().endswith(".pose"):
                        pose_filename += ".pose"

                    all_rows.append({
                        "word": word,
                        "category": row.get("category"),
                        "pose_filename": pose_filename,
                        "source_table": table_name,
                    })

                if len(rows) < step:
                    break

                start += step

            if all_rows:
                print(f"✅ Loaded vocabulary from {table_name}: {len(all_rows)} rows")
                break

        except Exception as e:
            print(f"⚠️ Cannot load from {table_name}: {e}")

    if not all_rows:
        raise HTTPException(
            status_code=500,
            detail="ไม่พบข้อมูลคำศัพท์ในตาราง SL_word หรือ SL_word_rows"
        )

    unique: Dict[str, Dict[str, Any]] = {}
    for row in all_rows:
        key = normalize_word(row["word"])
        if key not in unique:
            unique[key] = row

    return list(unique.values())


def find_matching_words(text: str, vocab_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    text_no_space = normalize_word(text)
    matches: List[Dict[str, Any]] = []
    used_spans: List[Tuple[int, int]] = []

    vocab_sorted = sorted(
        vocab_rows,
        key=lambda r: len(normalize_word(r["word"])),
        reverse=True
    )

    for row in vocab_sorted:
        word = clean_text(row.get("word") or "")
        word_key = normalize_word(word)

        if not word_key:
            continue

        start = 0
        while True:
            index = text_no_space.find(word_key, start)
            if index == -1:
                break

            end = index + len(word_key)

            overlap = any(not (end <= s or index >= e) for s, e in used_spans)
            if not overlap:
                pose_filename = row["pose_filename"]

                try:
                    file_exists = resolve_pose_path(pose_filename).exists()
                except Exception:
                    file_exists = False

                if file_exists:
                    used_spans.append((index, end))
                    matches.append({
                        "word": word,
                        "category": row.get("category"),
                        "pose_filename": pose_filename,
                        "pose_url": build_pose_url(pose_filename),
                        "position": index,
                        "source_table": row.get("source_table"),
                    })
                    break

            start = index + 1

    matches.sort(key=lambda x: x["position"])
    return matches


def build_clean_summary_from_matches(matches: List[Dict[str, Any]]) -> str:
    """
    สรุปใจความตาม requirement:
    - เอาคำที่ไม่มีในฐานข้อมูล/ไม่มี pose ออก
    - ไม่เอาตัวอักษรเดี่ยว สระ หรือวรรณยุกต์มาต่อเป็นคำ
    - ต่อคำไทยให้เป็นประโยคอ่านได้ ไม่แสดงแบบแยกตัวอักษร
    """
    ordered_by_original = sorted(matches, key=lambda x: x.get("position", 10**9))
    words = [
        m["word"]
        for m in remove_duplicate_keep_order(ordered_by_original)
        if is_valid_meaningful_word(m.get("word") or "")
    ]

    # ภาษาไทยไม่จำเป็นต้องเว้นวรรคทุกคำ
    return "".join(words)


def summarize_text_for_sign_language(text: str, vocab_words: List[str]) -> str:
    text = clean_text(text)

    if openai_client is None:
        return text

    vocab_sample = ", ".join(vocab_words[:700])

    prompt = f"""
คุณคือระบบช่วยสรุปข้อความภาษาไทยสำหรับแปลเป็นภาษามือไทย

ข้อกำหนดสำคัญ:
1. สรุปให้สั้นลง แต่ความหมายหลักต้องไม่เพี้ยน
2. ตัดคำฟุ่มเฟือย คำลงท้าย คำเชื่อม และรายละเอียดที่ไม่จำเป็นออก
3. ใช้คำง่าย ๆ ที่มีแนวโน้มอยู่ในฐานคำศัพท์
4. พยายามใช้เฉพาะคำจากรายการคำศัพท์ที่ระบบรองรับ
5. ตอบกลับเป็นข้อความภาษาไทยสั้น ๆ เท่านั้น ห้ามอธิบาย

ข้อความต้นฉบับ:
{text}

รายการคำศัพท์ที่ระบบรองรับบางส่วน:
{vocab_sample}
""".strip()

    try:
        response = openai_client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "คุณเป็นผู้ช่วยสรุปข้อความภาษาไทยเพื่อเตรียมแปลเป็นภาษามือไทย"
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=100,
        )

        summary = response.choices[0].message.content or ""
        summary = clean_text(summary)
        summary = summary.replace("สรุป:", "").replace("สรุปใจความ:", "").strip()
        return summary if summary else text

    except Exception as e:
        print("⚠️ summarize failed:", repr(e))
        return text


def build_translation_result(
    original_text: str,
    processed_text: str,
    matches: List[Dict[str, Any]],
    used_summary: bool,
    summary_source: str
) -> Dict[str, Any]:
    matches = [
        m for m in matches
        if is_valid_meaningful_word(m.get("word") or "")
    ]

    if not matches:
        raise HTTPException(
            status_code=422,
            detail="ไม่พบคำศัพท์ภาษามือที่รองรับในฐานข้อมูล จึงไม่สามารถแสดงผลภาษามือได้"
        )

    ordered = apply_rule_based_order(matches)

    words = [m["word"] for m in ordered]
    pose_filenames = [m["pose_filename"] for m in ordered]
    pose_urls = [m["pose_url"] for m in ordered]
    roles = [m.get("role", "O") for m in ordered]

    return {
        "success": True,
        "original_text": original_text,
        "input_text": original_text,

        # ช่องนี้คือ summary ที่กรองแล้ว เหลือเฉพาะคำที่มีใน SL_word/pose
        "summary": processed_text,
        "processed_text": processed_text,
        "summary_source": summary_source,
        "used_summary": used_summary,

        # ช่องพวกนี้คือ ThSL Pattern เรียงแล้ว
        "keywords": words,
        "words": words,
        "matched_words": words,
        "thsl_words": words,
        "thsl_text": " ".join(words),
        "roles": roles,

        "pose_filenames": pose_filenames,
        "poseFiles": pose_filenames,
        "pose_urls": pose_urls,

        "items": ordered,
        "poses": [
            {
                "word": m["word"],
                "category": m.get("category"),
                "role": m.get("role", "O"),
                "pose_filename": m["pose_filename"],
                "url": m["pose_url"],
            }
            for m in ordered
        ],
    }


# =========================
# 6) Pose meta
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
# 7) Basic endpoints
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
        "backend_public_base_url": BACKEND_PUBLIC_BASE_URL,
        "node_bin": NODE_BIN,
        "ffmpeg_bin": FFMPEG_BIN,
        "summary_model": SUMMARY_MODEL,
    }


# =========================
# 8) Translate endpoints
# =========================
@app.post("/api/translate")
def translate_text(req: TextRequest):
    original_text = clean_text(req.text)

    if not original_text:
        raise HTTPException(status_code=400, detail="กรุณากรอกข้อความก่อนแปล")

    vocab_rows = fetch_vocabulary_rows()
    vocab_words = [row["word"] for row in vocab_rows]

    direct_matches = find_matching_words(original_text, vocab_rows)
    direct_matches = [
        m for m in direct_matches
        if is_valid_meaningful_word(m.get("word") or "")
    ]

    if direct_matches and not is_sentence_too_long(original_text):
        clean_summary = build_clean_summary_from_matches(direct_matches)
        return build_translation_result(
            original_text=original_text,
            processed_text=clean_summary,
            matches=direct_matches,
            used_summary=False,
            summary_source="direct_filter",
        )

    ai_summary = summarize_text_for_sign_language(original_text, vocab_words)
    summary_matches = find_matching_words(ai_summary, vocab_rows)
    summary_matches = [
        m for m in summary_matches
        if is_valid_meaningful_word(m.get("word") or "")
    ]

    if summary_matches:
        clean_summary = build_clean_summary_from_matches(summary_matches)
        return build_translation_result(
            original_text=original_text,
            processed_text=clean_summary,
            matches=summary_matches,
            used_summary=True,
            summary_source="ai_summary_filter",
        )

    if direct_matches:
        clean_summary = build_clean_summary_from_matches(direct_matches)
        return build_translation_result(
            original_text=original_text,
            processed_text=clean_summary,
            matches=direct_matches,
            used_summary=False,
            summary_source="direct_filter_fallback",
        )

    raise HTTPException(
        status_code=422,
        detail="ไม่พบคำศัพท์ภาษามือที่รองรับในฐานข้อมูล จึงไม่สามารถแสดงผลภาษามือได้"
    )


@app.post("/api/summarize-text")
def summarize_text_api(req: TextRequest):
    return translate_text(req)


@app.post("/api/process-text")
def process_text_api(req: TextRequest):
    return translate_text(req)


# =========================
# 9) Resolve word
# =========================
@app.get("/api/resolve")
def resolve_word(word: str = Query(..., description="คำศัพท์ภาษาไทยที่ต้องการค้นหา")):
    word = clean_text(word)

    if not word:
        raise HTTPException(status_code=400, detail="word cannot be empty")

    vocab_rows = fetch_vocabulary_rows()

    exact = [
        row for row in vocab_rows
        if normalize_word(row["word"]) == normalize_word(word)
    ]

    if exact:
        out = []
        for row in exact:
            filename = row["pose_filename"]

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
                "url": f"/api/pose?name={quote(filename)}",
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
                "url": f"/api/pose?name={quote(direct_filename)}",
            }]
        }

    return {"found": False, "message": "Word not found in DB or Disk", "files": []}


# =========================
# 10) Pose file endpoints
# =========================
@app.get("/api/pose")
def get_pose_file(name: str = Query(..., description="ชื่อไฟล์ .pose")):
    name = clean_text(name)

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
def pose_meta(name: str = Query(..., description="ชื่อไฟล์ .pose")):
    name = clean_text(name)

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
# 11) Optional concat video
# =========================
@app.post("/api/concat_video")
def concat_video(req: ConcatRequest):
    try:
        if not req.pose_filenames:
            raise HTTPException(status_code=400, detail="pose_filenames cannot be empty")

        pose_paths: List[Path] = []

        for name in req.pose_filenames:
            clean = clean_text(name)
            if not clean:
                continue

            p = resolve_pose_path(clean)

            if not p.exists():
                raise HTTPException(status_code=404, detail=f"Pose file not found: {clean}")

            pose_paths.append(p)

        if not pose_paths:
            raise HTTPException(status_code=400, detail="No valid pose files provided")

        poses: List[Pose] = []

        for p in pose_paths:
            with open(p, "rb") as f:
                poses.append(Pose.read(f.read()))

        out_name = clean_text(req.output_name or "")

        if not out_name:
            out_name = f"thsl_{uuid.uuid4().hex}.mp4"

        if not out_name.lower().endswith(".mp4"):
            out_name += ".mp4"

        out_path = (VIDEO_DIR / out_name).resolve()

        try:
            out_path.relative_to(VIDEO_DIR)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid output_name")

        if out_path.exists():
            out_path = (VIDEO_DIR / f"thsl_{uuid.uuid4().hex}.mp4").resolve()

        try:
            pose_sequence(poses, output_path=str(out_path))
        except NameError:
            raise HTTPException(
                status_code=500,
                detail="pose_sequence is not imported. ถ้าไม่ได้ใช้ endpoint นี้ ไม่ต้องสนใจ"
            )
        except TypeError as e:
            raise HTTPException(
                status_code=500,
                detail="pose_sequence() ยังไม่รองรับ output_path"
            ) from e

        if not out_path.exists() or out_path.stat().st_size < 1024:
            raise HTTPException(status_code=500, detail="Video file was not created")

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
# 12) Transcribe audio
# =========================
@app.post("/api/transcribe-audio")
async def transcribe_audio(file: UploadFile = File(...)):
    if openai_client is None:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is missing. Please set it in backend/.env"
        )

    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="กรุณาอัปโหลดไฟล์เสียงเท่านั้น")

    suffix = Path(file.filename or "audio.webm").suffix or ".webm"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = tmp.name
        tmp.write(await file.read())

    try:
        with open(tmp_path, "rb") as audio_file:
            result = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="th",
            )

        return {"text": result.text}

    except Exception as e:
        print("❌ transcribe error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail=f"แปลงเสียงเป็นข้อความไม่สำเร็จ: {type(e).__name__}"
        )

    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


# =========================
# 13) Render PosePlayer canvas -> MP4
# =========================
@app.post("/api/render_sentence_mp4")
def render_sentence_mp4(req: RenderSentenceRequest):
    try:
        if not req.pose_filenames:
            raise HTTPException(status_code=400, detail="pose_filenames cannot be empty")

        pose_urls: List[str] = []

        for name in req.pose_filenames:
            clean = clean_text(name)

            if not clean:
                continue

            p = resolve_pose_path(clean)

            if not p.exists():
                raise HTTPException(status_code=404, detail=f"Pose file not found: {clean}")

            pose_urls.append(build_pose_url(clean))

        if not pose_urls:
            raise HTTPException(status_code=400, detail="No valid pose files provided")

        out_name = clean_text(req.output_name or "")

        if not out_name:
            out_name = f"sentence_{uuid.uuid4().hex}.mp4"

        if not out_name.lower().endswith(".mp4"):
            out_name += ".mp4"

        out_path = (VIDEO_DIR / out_name).resolve()

        try:
            out_path.relative_to(VIDEO_DIR)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid output_name")

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
