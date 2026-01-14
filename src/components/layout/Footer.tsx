import { Hand } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-secondary py-6">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Hand className="text-gold" size={24} />
            <span className="text-secondary-foreground font-medium">
              แปลเสียงและข้อความเป็นภาษามือ
            </span>
          </div>
          <p className="text-secondary-foreground/70 text-sm">
            © 2024 สงวนลิขสิทธิ์ทุกประการ
          </p>
        </div>
      </div>
    </footer>
  );
}
