export async function onRequestGet(): Promise<Response> {
  return Response.json({
    ok: true,
    service: "your-pages-api",
  });
}
