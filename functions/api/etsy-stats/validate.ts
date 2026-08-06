import { validateMonthlyStats } from "./_validation";

export async function onRequestPost(context: { request: Request }): Promise<Response> {
  let payload: unknown;

  try {
    payload = await context.request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        valid: false,
        errors: ["The request body must contain valid JSON."],
        warnings: [],
        normalized: null,
      },
      { status: 400 },
    );
  }

  const result = validateMonthlyStats(payload);
  return Response.json(
    {
      ok: true,
      ...result,
    },
    { status: result.valid ? 200 : 422 },
  );
}
