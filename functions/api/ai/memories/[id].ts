import { deleteMemory, updateMemory, type D1Database } from "./_db";
import { validateMemoryInput } from "./_validation";

type Context = {
  request: Request;
  env: { DB: D1Database };
  params: { id?: string | string[] };
};

function readId(params: Context["params"]): number | null {
  const value = Array.isArray(params.id) ? params.id[0] : params.id;
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestPut(context: Context): Promise<Response> {
  const id = readId(context.params);
  if (id === null) {
    return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

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
    const memory = await updateMemory(context.env.DB, id, validation.normalized);
    if (!memory) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    return Response.json({ ok: true, memory });
  } catch {
    return Response.json({ ok: false, error: "memory_save_failed" }, { status: 500 });
  }
}

export async function onRequestDelete(context: Context): Promise<Response> {
  const id = readId(context.params);
  if (id === null) {
    return Response.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  try {
    await deleteMemory(context.env.DB, id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "memory_delete_failed" }, { status: 500 });
  }
}
