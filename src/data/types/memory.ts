export const MEMORY_TYPES = [
  "goal",
  "preference",
  "decision",
  "experiment",
  "result",
  "avoid_suggestion",
  "shop_info",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  goal: "Hedef",
  preference: "Tercih",
  decision: "Karar",
  experiment: "Deney",
  result: "Sonuç",
  avoid_suggestion: "Kaçınılacak öneri",
  shop_info: "Mağaza bilgisi",
};

export type MemoryRecord = {
  id: number;
  memoryType: MemoryType;
  content: string;
  importance: string | null;
  source: "user" | "ai";
  createdAt: string;
  updatedAt: string;
};

export type MemoryInput = {
  memoryType: MemoryType;
  content: string;
  importance?: string | null;
};
