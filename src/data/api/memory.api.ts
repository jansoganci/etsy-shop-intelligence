import type { MemoryInput, MemoryRecord, MemoryType } from "../types/memory";

type ApiFailure = {
  ok: false;
  error?: string;
  message?: string;
  errors?: string[];
};

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Server returned an invalid response.");
  }
}

function failureMessage(failure: ApiFailure, fallback: string): string {
  return failure.message || failure.errors?.join(" ") || fallback;
}

export async function fetchMemories(memoryType?: MemoryType): Promise<MemoryRecord[]> {
  const query = memoryType ? `?memoryType=${encodeURIComponent(memoryType)}` : "";
  const response = await fetch(`/api/ai/memories${query}`);
  const data = await readJson<{ ok: true; memories: MemoryRecord[] } | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Hafıza kayıtları yüklenemedi."));
  }
  return data.memories;
}

export async function createMemory(input: MemoryInput): Promise<MemoryRecord> {
  const response = await fetch("/api/ai/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson<{ ok: true; memory: MemoryRecord } | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Hafıza kaydı oluşturulamadı."));
  }
  return data.memory;
}

export async function updateMemory(id: number, input: MemoryInput): Promise<MemoryRecord> {
  const response = await fetch(`/api/ai/memories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson<{ ok: true; memory: MemoryRecord } | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Hafıza kaydı güncellenemedi."));
  }
  return data.memory;
}

export async function deleteMemory(id: number): Promise<void> {
  const response = await fetch(`/api/ai/memories/${id}`, { method: "DELETE" });
  const data = await readJson<{ ok: true } | ApiFailure>(response);
  if (!response.ok || !data.ok) {
    throw new Error(failureMessage(data as ApiFailure, "Hafıza kaydı silinemedi."));
  }
}
