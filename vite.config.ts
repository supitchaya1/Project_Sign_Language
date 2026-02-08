import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // ✅ เพิ่มบรรทัดนี้: บอก Vite ว่าถ้าเจอ import 'buffer' ให้ไปใช้ package ชื่อ 'buffer/'
      buffer: "buffer/",
    },
  },
  // ✅ เพิ่มส่วนนี้: เพื่อแก้ปัญหา Library บางตัวที่พยายามเรียกใช้ตัวแปร global
  define: {
    "global": {},
  },
}));