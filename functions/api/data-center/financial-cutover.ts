type Context = {
  request: Request;
  env: { DB: unknown };
};

/**
 * Phase 9: cutover gates are obsolete after canonical views select by API row
 * existence. Keep the route for old clients with a static not-applicable payload.
 * Do not drop etsy_financial_cutover_settings — table retained for rollback.
 */
export async function onRequestGet(_context: Context): Promise<Response> {
  return Response.json({
    ok: true,
    legacy: true,
    message: "Financial cutover is not applicable after Commerce Sync Phase 9.",
    settings: {
      shopId: null,
      ordersApiFirst: true,
      paymentsApiFirst: true,
      updatedAt: null,
    },
    readiness: {
      orders: { allowed: false, blockingReasons: ["not_applicable"], warnings: [] },
      payments: { allowed: false, blockingReasons: ["not_applicable"], warnings: [] },
    },
  });
}

export async function onRequestPost(_context: Context): Promise<Response> {
  return Response.json(
    {
      ok: false,
      error: "cutover_not_applicable",
      message: "Financial cutover toggles were removed in Commerce Sync Phase 9.",
    },
    { status: 410 },
  );
}
