// src/services/thslRules.ts

export type Role =
  | "S" | "V" | "O" | "NEG"
  | "PP(Place)" | "Adv(Time)"
  | "ClausalVerb"
  | "NP" | "PAdj" | "ComparativeAdj"
  | "Money" | "Number" | "Currency"
  | "Age" | "Year" | "Break"
  | "Adj" | "Adj1" | "Adj2"
  | "When/Why/Where/How(?)"
  | "Whose(?)" | "Who(?)" | "What(?)" | "Q(?)"
  | "Pronoun" | "V2B";

export interface TaggedWord {
  word: string;
  role: Role | "UNK";
}

export interface ThslRule {
  id: number;
  thaiPattern: Role[];
  thslOrder: Role[];
}

// กฎจาก Table 1–40 (ตามรูปที่คุณส่ง)
export const THSL_RULES: ThslRule[] = [
  { id: 1, thaiPattern: ["S","V"], thslOrder: ["S","V"] },
  { id: 2, thaiPattern: ["S","NEG","V"], thslOrder: ["S","NEG","V"] },
  { id: 3, thaiPattern: ["S","V","O"], thslOrder: ["O","S","V"] },
  { id: 4, thaiPattern: ["S","NEG","V","O"], thslOrder: ["O","S","V","NEG"] },

  // diO / inDO (เราแทนเป็น O สองตัวแบบง่ายที่สุดในระบบ prototype)
  // ถ้าคุณมีการ tag แยก diO/inDO จริง ค่อยขยาย Role เพิ่ม
  { id: 5, thaiPattern: ["S","V","O","O"], thslOrder: ["O","O","S","V"] },
  { id: 6, thaiPattern: ["S","NEG","V","O","O"], thslOrder: ["O","O","S","V","NEG"] },

  { id: 7, thaiPattern: ["O","S","V"], thslOrder: ["O","S","V"] },
  { id: 8, thaiPattern: ["O","NEG","S","V"], thslOrder: ["O","S","V","NEG"] },

  { id: 9, thaiPattern: ["S","V","PP(Place)"], thslOrder: ["PP(Place)","S","V"] },
  { id: 10, thaiPattern: ["S","V","NEG","PP(Place)"], thslOrder: ["PP(Place)","S","V","NEG"] },
  { id: 11, thaiPattern: ["S","V","O","PP(Place)"], thslOrder: ["PP(Place)","O","S","V"] },
  { id: 12, thaiPattern: ["S","NEG","V","O","PP(Place)"], thslOrder: ["PP(Place)","O","S","V","NEG"] },

  { id: 13, thaiPattern: ["S","V","Adv(Time)"], thslOrder: ["Adv(Time)","S","V"] },
  { id: 14, thaiPattern: ["S","NEG","V","Adv(Time)"], thslOrder: ["Adv(Time)","S","V","NEG"] },
  { id: 15, thaiPattern: ["S","V","O","Adv(Time)"], thslOrder: ["Adv(Time)","O","S","V"] },
  { id: 16, thaiPattern: ["S","NEG","V","O","Adv(Time)"], thslOrder: ["Adv(Time)","O","S","V","NEG"] },

  { id: 17, thaiPattern: ["S","V","ClausalVerb"], thslOrder: ["ClausalVerb","S","V"] },
  { id: 18, thaiPattern: ["S","NEG","V","ClausalVerb"], thslOrder: ["ClausalVerb","S","V","NEG"] },
  { id: 19, thaiPattern: ["S","V","ClausalVerb","O"], thslOrder: ["O","ClausalVerb","S","V"] },
  { id: 20, thaiPattern: ["S","NEG","V","ClausalVerb","O"], thslOrder: ["O","ClausalVerb","S","V","NEG"] },

  { id: 21, thaiPattern: ["NP","PAdj","V"], thslOrder: ["PAdj","NP","V"] },
  { id: 22, thaiPattern: ["NP","PAdj","NEG","V"], thslOrder: ["PAdj","NP","V","NEG"] },
  { id: 23, thaiPattern: ["NP","PAdj","V","O"], thslOrder: ["O","PAdj","NP","V"] },
  { id: 24, thaiPattern: ["NP","PAdj","NEG","V","O"], thslOrder: ["O","PAdj","NP","V","NEG"] },

  { id: 25, thaiPattern: ["S","ComparativeAdj","O"], thslOrder: ["O","S","ComparativeAdj"] },

  { id: 26, thaiPattern: ["S","V","Money","Number","Currency"], thslOrder: ["Currency","Number","S","V"] },
  { id: 27, thaiPattern: ["S","Age","Number","Year"], thslOrder: ["S","Age/Year","Number"] as any }, // เราจะจัดการ "Age/Year" ในโค้ด apply (ดูด้านล่าง)
  { id: 28, thaiPattern: ["S","Break","O"], thslOrder: ["O","S","Break"] },

  { id: 29, thaiPattern: ["S","V","O","PP(Place)","Adv(Time)"], thslOrder: ["Adv(Time)","PP(Place)","O","S","V"] },
  { id: 30, thaiPattern: ["S","NEG","V","O","PP(Place)","Adv(Time)"], thslOrder: ["Adv(Time)","PP(Place)","O","S","V","NEG"] },

  // 31: S + Adj + V + O + Adj  → O + Adj + S + Adj + V
  { id: 31, thaiPattern: ["S","Adj","V","O","Adj"], thslOrder: ["O","Adj","S","Adj","V"] },

  { id: 32, thaiPattern: ["S","V","When/Why/Where/How(?)"], thslOrder: ["S","V","When/Why/Where/How(?)"] },
  { id: 33, thaiPattern: ["O","Whose(?)"], thslOrder: ["O","Whose(?)"] },
  { id: 34, thaiPattern: ["Pronoun","V2B","Who(?)"], thslOrder: ["Pronoun","V2B","Who(?)"] },

  { id: 35, thaiPattern: ["S","V","O","Q(?)"], thslOrder: ["O","S","V","Q(?)"] },
  { id: 36, thaiPattern: ["S","V","What(?)"], thslOrder: ["S","V","What(?)"] },

  { id: 37, thaiPattern: ["O","Adj"], thslOrder: ["O","Adj"] },
  { id: 38, thaiPattern: ["O","NEG","Adj"], thslOrder: ["O","NEG","Adj"] },
  { id: 39, thaiPattern: ["O","Adj1","Adj2"], thslOrder: ["O","Adj1","Adj2"] },
  { id: 40, thaiPattern: ["O","Adj1","NEG","Adj2"], thslOrder: ["O","Adj1","Adj2","NEG"] },
];

// utility: ลบซ้ำแต่คงลำดับเดิม
export function uniqPreserveOrder(words: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = (w ?? "").trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
