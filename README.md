# 🎯 SP2025-DST-SignLanguageApp

> Thai Speech/Text → Thai Sign Language Translation Web Application  
> ระบบแปล **เสียงพูด / ข้อความภาษาไทย → ภาษามือไทย (แอนิเมชัน + วิดีโอ)**

---

## 🚀 website 

🌐  https://signproject.duckdns.org 

📌 Why This Project?

การสื่อสารระหว่างคนทั่วไปกับผู้มีความบกพร่องทางการได้ยินยังมีข้อจำกัด
ระบบนี้ถูกพัฒนาเพื่อ:

- ลดช่องว่างการสื่อสาร
- ทำให้ภาษามือเข้าถึงง่ายผ่านเว็บ
- ใช้ AI + Animation ช่วยแปลภาษา

##🌟 Features
🎤 Speech-to-Text (พูดผ่านไมค์)
📝 Text Input (พิมพ์ข้อความ)
🧠 Summarization (สรุปใจความ)
🔑 Keyword Extraction
✋ Sign Language Animation (.pose)
🎬 Export Video (.GIF)
👤 Authentication (Supabase)
🕘 Translation History

##🧠 How It Works
User Input (Speech/Text)
        ↓
Speech-to-Text
        ↓
Summarization
        ↓
Keyword Extraction
        ↓
Rule-based Translation (Thai → ThSL)
        ↓
Pose Mapping (.pose)
        ↓
Animation (PosePlayer)
        ↓
Video Export (.GIF)

##🧩 Technology Stack

| Layer                 | Technology                        | Description                                     |
| --------------------- | --------------------------------- | ------------------------------------------------|
| Frontend              | React + Vite + TypeScript         | พัฒนาเว็บแอปพลิเคชันฝั่งผู้ใช้                          |
| Styling               | CSS / Tailwind CSS                | จัดการหน้าตาและ responsive UI                     |
| Backend               | FastAPI                           | พัฒนา REST API สำหรับประมวลผลข้อมูล               |
| Server                | Uvicorn                           | ใช้รัน FastAPI backend                            |
| Database              | Supabase PostgreSQL               | จัดเก็บผู้ใช้ คำศัพท์ ประวัติ และข้อมูลระบบ               |
| Authentication        | Supabase Auth                     | สมัครสมาชิก เข้าสู่ระบบ และจัดการ session             |
| Speech-to-Text        | Web Speech API                    | แปลงเสียงพูดผ่านไมโครโฟนเป็นข้อความ                 |
| Audio Transcription   | Whisper / API-based transcription | แปลงไฟล์เสียงเป็นข้อความ                           |
| NLP                   | Typhoon LLM / Summarization API   | สรุปใจความและดึงคำสำคัญ                           |
| Animation             | pose-format / PosePlayer          | อ่านและแสดงไฟล์ `.pose`                          |
| Video Rendering       | Puppeteer + FFmpeg                | สร้างวิดีโอ GIF จากแอนิเมชัน                         |
| Deployment            | ReadyIDC VPS                      | ใช้เป็นเซิร์ฟเวอร์สำหรับ backend และไฟล์ `.pose`       |
| HTTPS / Reverse Proxy | Caddy                             | จัดการ HTTPS และ reverse proxy                   |
| Frontend Hosting      | Vercel / Static build             | ใช้ deploy frontend                              |
| Version Control       | Git + GitHub                      | จัดการ source code                               |


##📂 Project Structure

Project_Sign_Language/
├── backend/
│   ├── main.py
│   ├── poses/
│   ├── videos/
│   ├── requirements.txt
│   └── .env
│   └── ...
│
├── public/
│   └── ...
│
├── src/
│   ├── components/
│   ├── pages/
│   ├── lib/
│   ├── contexts/
│   ├── services/
│   └── ...
│
├── supabase/
│   ├── functions/
│   └── ...
│
├── .env
├── .env.local
├── .env.production
├── .gitignore
├── components.json
├── eslint.config.js
├── index.html
├── package.json
├── package-lock.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vercel.json
├── vite.config.ts
└── README.md⚡ Getting Started (Run in 3 Steps)

##🖥️ Frontend Setup

npm install
npm run dev

##⚙️ Backend Setup

cd backend
python -m venv .venv
source .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
uvicorn main:app --reload

##🔐 Environment Variables (สำคัญมาก)

📁 1. backend/.env
SUPABASE_URL=your-url
SUPABASE_KEY=your-key

POSE_DIR=./poses
VIDEO_DIR=./videos

PORT=8000

CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

FRONTEND_BASE_URL=http://127.0.0.1:8080
BACKEND_PUBLIC_BASE_URL=http://127.0.0.1:8000

NODE_BIN=path-to-node
FFMPEG_BIN=ffmpeg

OPENAI_API_KEY=your-key (optional)

🌐 2. Frontend .env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx

VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_BACKEND_BASE=http://127.0.0.1:8000

🧪 3. .env.local
VITE_BACKEND_BASE=http://127.0.0.1:8000/api
VITE_API_BASE_URL=http://127.0.0.1:8000

🚀 4. .env.production
VITE_BACKEND_BASE=/api


##⚠️ Important
❌ ห้าม push .env
✅ frontend ต้องใช้ VITE_
✅ ต้องมี ffmpeg + node

##📡 API Example
POST /api/translate
{
  "text": "ฉันอยากกินข้าว"
}
Response
{
  "summary": "ฉันกินข้าว",
  "keywords": ["ฉัน", "กิน", "ข้าว"],
  "pose_files": ["ฉัน.pose", "กิน.pose", "ข้าว.pose"]
}
GET /api/resolve
/api/resolve?word=ข้าว
POST /api/render_sentence_GIF

สร้างวิดีโอจากประโยค

##🎬 Video Export Pipeline
Frontend
   ↓
Puppeteer
   ↓
Canvas Record (WebM)
   ↓
FFmpeg
   ↓
GIF Download

##⚠️ Limitations
- เสียงมีผลต่อ accuracy
- rule-based ยังไม่รองรับประโยคซับซ้อน
- vocabulary จำกัด
- animation ยังไม่สมจริง

##🔮 Future Work
- ใช้ AI แทน rule-based
- เพิ่ม vocabulary
- ใช้ 3D avatar
- improve facial expression
- improve speed

##🛠️ Troubleshooting
❌ 422 Error
→ JSON ไม่ตรง schema

❌ Mic ใช้ไม่ได้
→ ต้อง HTTPS

❌ Pose ไม่เจอ
ls backend/poses

❌ FFmpeg
ffmpeg -version

