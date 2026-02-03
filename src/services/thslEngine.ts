// src/services/thslEngine.ts

import { TaggedWord, THSL_RULES, uniqPreserveOrder, Role } from "./thslRules";

function isNumberToken(token: string) {
  return /^[0-9]+$/.test(token);
}

function isNeg(token: string) {
  return token === "ไม่" || token === "ไม่มี" || token === "ห้าม";
}

function isTimeWord(token: string) {
  const timeWords = ["วันนี้","พรุ่งนี้","เมื่อวาน","ตอนนี้","เช้า","สาย","บ่าย","เย็น","กลางคืน"];
  return timeWords.includes(token);
}

function isPlaceWord(token: string) {
  const placeWords = ["บ้าน","โรงเรียน","มหาวิทยาลัย","ตลาด","โรงพยาบาล","ที่ทำงาน","ห้องน้ำ"];
  return placeWords.includes(token);
}

function isQuestionWord(token: string) {
  const wh = ["เมื่อไหร่","ทำไม","ที่ไหน","อย่างไร","ยังไง"];
  return wh.includes(token);
}

function isWhat(token: string) {
  return token === "อะไร";
}

function isWho(token: string) {
  return token === "ใคร";
}

function isWhose(token: string) {
  return token === "ของใคร";
}

function isQParticle(token: string) {
  return token === "ไหม" || token === "หรือเปล่า" || token === "?";
}

// ทาย role แบบง่ายๆ (prototype)
export function tagTokens(tokens: string[]): TaggedWord[] {
  const cleaned = uniqPreserveOrder(tokens);

  return cleaned.map((w) => {
    if (isNeg(w)) return { word: w, role: "NEG" };
    if (isNumberToken(w)) return { word: w, role: "Number" };
    if (isTimeWord(w)) return { word: w, role: "Adv(Time)" };
    if (isPlaceWord(w)) return { word: w, role: "PP(Place)" };
    if (isQuestionWord(w)) return { word: w, role: "When/Why/Where/How(?)" };
    if (isWhat(w)) return { word: w, role: "What(?)" };
    if (isWhose(w)) return { word: w, role: "Whose(?)" };
    if (isWho(w)) return { word: w, role: "Who(?)" };
    if (isQParticle(w)) return { word: w, role: "Q(?)" };

    // heuristic สุดง่าย: คำขึ้นต้นมักเป็นประธาน/สรรพนาม
    if (["ฉัน","ผม","หนู","เรา","คุณ","เขา","เธอ","มัน","พวกเรา"].includes(w)) {
      return { word: w, role: "S" };
    }

    // heuristic กริยาแบบง่าย (คุณเพิ่มได้)
    if (["ไป","มา","กิน","นอน","เรียน","ทำงาน","ดู","ซื้อ","ขาย","ชอบ","รัก","ช่วย"].includes(w)) {
      return { word: w, role: "V" };
    }

    // ที่เหลือเดาเป็น O ก่อน (เพื่อให้ match rule S V O ได้บ่อย)
    return { word: w, role: "O" };
  });
}

function rolesOf(tagged: TaggedWord[]) {
  return tagged.map(t => t.role).filter(r => r !== "UNK") as Role[];
}

// match แบบ exact ก่อน
function findExactRule(tagged: TaggedWord[]) {
  const pattern = rolesOf(tagged);
  for (const rule of THSL_RULES) {
    if (rule.thaiPattern.length !== pattern.length) continue;
    let ok = true;
    for (let i=0;i<pattern.length;i++){
      if (pattern[i] !== rule.thaiPattern[i]) { ok=false; break; }
    }
    if (ok) return rule;
  }
  return null;
}

// reorder ตาม rule (เลือกคำตัวแรกของ role นั้น)
function reorder(tagged: TaggedWord[], thslOrder: any[]): string[] {
  const used = new Set<number>();
  const out: string[] = [];

  for (const role of thslOrder as Role[]) {
    // special case ของ rule 27: "Age/Year"
    if (role === ("Age/Year" as any)) {
      const idxAge = tagged.findIndex((t, i) => !used.has(i) && t.role === "Age");
      const idxYear = tagged.findIndex((t, i) => !used.has(i) && t.role === "Year");
      if (idxAge >= 0) { out.push(tagged[idxAge].word); used.add(idxAge); continue; }
      if (idxYear >= 0) { out.push(tagged[idxYear].word); used.add(idxYear); continue; }
      continue;
    }

    const idx = tagged.findIndex((t, i) => !used.has(i) && t.role === role);
    if (idx >= 0) {
      out.push(tagged[idx].word);
      used.add(idx);
    }
  }

  // เติมคำที่เหลือท้ายสุด (กันคำหล่น)
  tagged.forEach((t, i) => {
    if (!used.has(i)) out.push(t.word);
  });

  return out;
}

// public API: เอา tokens → ThSL tokens
export function toThslTokens(tokens: string[]) {
  const tagged = tagTokens(tokens);
  const rule = findExactRule(tagged);

  if (!rule) {
    // fallback: คืนลำดับเดิม (แต่ลบซ้ำ/trim แล้ว)
    return { thsl: tagged.map(t => t.word), ruleId: null, tagged };
  }

  const thsl = reorder(tagged, rule.thslOrder);
  return { thsl, ruleId: rule.id, tagged };
}
