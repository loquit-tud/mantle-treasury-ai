/**
 * Minimal smoke tests for the Quorum backend.
 *
 * Usage:
 *   BACKEND_URL=http://localhost:3001 node scripts/smoke.mjs
 *
 * Optional:
 *   API_SECRET=...            # for mutation endpoints when enabled
 *   SMOKE_ADDRESS=0x...       # address to evaluate/borrow for
 *   SMOKE_AMOUNT=1000000      # raw USDT (6 decimals)
 */
const BASE = (process.env.BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const API_SECRET = process.env.API_SECRET || "";
const ADDR = process.env.SMOKE_ADDRESS || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const AMOUNT = process.env.SMOKE_AMOUNT || "1000000";

function url(path) {
  return `${BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function request(path, { method = "GET", headers = {}, body } = {}) {
  const h = new Headers(headers);
  if (API_SECRET) h.set("x-api-key", API_SECRET);
  if (body != null && !h.has("content-type")) h.set("content-type", "application/json");

  const res = await fetch(url(path), {
    method,
    headers: h,
    body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-json response
  }
  return { res, text, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const results = [];
  const startedAt = Date.now();

  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const data = await fn();
      results.push({ name, ok: true, ms: Date.now() - t0, data });
    } catch (e) {
      results.push({ name, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
    }
  };

  await step("GET /health", async () => {
    const { res, json, text } = await request("/health");
    assert(res.ok, `HTTP ${res.status}: ${text}`);
    assert(json?.status === "healthy", `unexpected status: ${JSON.stringify(json)}`);
    return { status: json.status, agents: json.agents };
  });

  await step("GET /api/dashboard", async () => {
    const { res, json, text } = await request("/api/dashboard");
    assert(res.ok, `HTTP ${res.status}: ${text}`);
    assert(json?.success === true, `unexpected response: ${text}`);
    return { ok: true };
  });

  await step("GET /api/db/stats", async () => {
    const { res, json, text } = await request("/api/db/stats");
    assert(res.ok, `HTTP ${res.status}: ${text}`);
    assert(json?.success === true, `unexpected response: ${text}`);
    return { engine: json.engine, tables: json.tables };
  });

  await step("GET /api/audit/trail?limit=1", async () => {
    const { res, json, text } = await request("/api/audit/trail?limit=1");
    assert(res.ok, `HTTP ${res.status}: ${text}`);
    assert(json?.success === true, `unexpected response: ${text}`);
    return { chains: json.data?.chains?.length ?? 0 };
  });

  // Mutations (best-effort): works in dev (API_SECRET disabled) or when API_SECRET provided.
  await step("POST /api/credit/:address/evaluate", async () => {
    const { res, json, text } = await request(`/api/credit/${ADDR}/evaluate`, { method: "POST" });
    assert(res.ok, `HTTP ${res.status}: ${text}`);
    assert(json?.success === true, `unexpected response: ${text}`);
    return { score: json.data?.score, limit: json.data?.limit };
  });

  await step("POST /api/credit/:address/borrow (propose disbursement)", async () => {
    const { res, json, text } = await request(`/api/credit/${ADDR}/borrow`, {
      method: "POST",
      body: { amount: AMOUNT },
    });
    // In production without API_SECRET, this may be 401/403 by design.
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    assert(json?.success === true, `unexpected response: ${text}`);
    const disb = json.data?.disbursementTxHash ?? null;
    return { loanId: json.data?.loan?.id, disbursementTxHash: disb };
  });

  const failed = results.filter(r => !r.ok);
  const totalMs = Date.now() - startedAt;

  // Print summary
  console.log(`Smoke: ${BASE}`);
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`${status}  ${r.name}  (${r.ms}ms)`);
    if (!r.ok) console.log(`      ${r.error}`);
  }
  console.log(`Done in ${totalMs}ms`);

  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

