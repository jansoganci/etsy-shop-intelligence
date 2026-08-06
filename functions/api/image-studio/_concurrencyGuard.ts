// Best-effort, single-isolate guard only. Cloudflare Workers isolates are not
// shared or durable across requests/instances — this module-level flag lives
// only as long as one warm isolate and cannot enforce a true cross-deployment
// limit of one in-flight generation. It exists solely to reject an obvious,
// same-isolate double-submission, per the spec's "when practical" wording.
let inFlight = false;

export function tryAcquireGenerationSlot(): boolean {
  if (inFlight) {
    return false;
  }

  inFlight = true;
  return true;
}

export function releaseGenerationSlot(): void {
  inFlight = false;
}
