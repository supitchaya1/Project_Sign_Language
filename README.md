<!-- run web 2 terminal -->
* run front 
 - npm run dev

* run backend 
 - cd backend 
 - .\.venv\Scripts\Activate.ps1
 - uvicorn main:app --reload --host 127.0.0.1 --port 8000


- ติดตั้ง CLI แบบ dev dependency (ครั้งเดียว)
npm install supabase --save-dev
- เช็กว่า CLI ใช้งานได้
npx supabase --version