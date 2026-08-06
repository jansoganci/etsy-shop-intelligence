import { createMemory, loadMemories, type D1Database } from "./_db";
import { isMemoryType, validateMemoryInput } from "./_validation";

type Context = {
  request: Request;
  env: { DB: D1Database };
};

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const memoryTypeParam = url.searchParams.get("memoryType");
    const memoryType = isMemoryType(memoryTypeParam) ? memoryTypeParam : undefined;
    const memories = await loadMemories(context.env.DB, { memoryType });
    return Response.json({ ok: true, memories });
  } catch {
    return Response.json({ ok: false, error: "memories_load_failed" }, { status: 500 });
  }
}

export async function onRequestPost(context: Context): Promise<Response> {
  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return Response.json(
      { ok: false, error: "invalid_json", message: "The request body must contain valid JSON." },
      { status: 400 },
    );
  }

  const validation = validateMemoryInput(payload);
  if (!validation.valid || !validation.normalized) {
    return Response.json({ ok: false, error: "validation_failed", ...validation }, { status: 422 });
  }

  try {
    const memory = await createMemory(context.env.DB, validation.normalized, "user");
    return Response.json({ ok: true, memory }, { status: 201 });
  } catch {
    return Response.json(
      { ok: false, error: "memory_save_failed", message: "The memory could not be saved." },
      { status: 500 },
    );
  }
}
