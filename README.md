# FASALSETU AI

SIH26132 — Strengthening Market Linkages and Price Discovery for Farmers · Team CODESURGE

> Know your price. Know your buyer. Sell with confidence.

FASALSETU AI tells a farmer where and how to sell a lot for the best **net** return — after transport,
market charges, storage and shrinkage — then carries the deal through offer, negotiation, a fingerprinted
digital agreement, pickup, payment and grievance resolution.

**Full documentation:** [`docs/FASALSETU_AI_Technical_Documentation.pdf`](docs/FASALSETU_AI_Technical_Documentation.pdf)
(architecture, data model, decision engine, AI, security, API, deployment, testing). Markdown and HTML versions sit
next to it.

## Live deployment

**https://fasalsetu-ai-bice.vercel.app** — Vercel (Singapore, `sin1`), Neon Postgres (Singapore), private Vercel Blob for photos.

The whole site is behind an **access code** (Vercel env var `ACCESS_CODE`). Visitors enter it once; a
30-day cookie holds a hash of it. Without it every page redirects to `/access` and every API/action returns
401, so strangers cannot use the app or spend the Gemini quota. Only `/api/health` and the device API
(`/api/iot/readings`, which needs a per-device key) are reachable without the code. Wrong guesses are
limited to 8 per 10 minutes per IP.

Secrets live only as encrypted Vercel environment variables — never in the code or the upload
(`.vercelignore` excludes every `.env*` file). The Gemini key is used only on the server.

```bash
vercel env add GEMINI_API_KEY production   # paste the key when prompted (stored as sensitive)
vercel env rm ACCESS_CODE production && vercel env add ACCESS_CODE production   # rotate the code
vercel deploy --prod                        # env var changes take effect on the next deploy
```

## Run locally

```bash
npm install
vercel env pull .env.local     # Neon + Blob credentials (project is linked in .vercel/)
npm run dev                    # http://localhost:3000 — access code is off unless ACCESS_CODE is set
npm run seed                   # resets demo data IN THE SHARED NEON DATABASE and prints new device keys
```

Prisma CLI commands read `.env` only, so load the pulled credentials first:
`set -a; source .env.local; set +a; npx prisma db push`.

Login is **demo mode**: pick any seeded account on `/login` (no passwords), or press
**Judge quick start** to land directly on a farmer's SmartSell decision.

## AI features (Google Gemini)

On Vercel: `vercel env add GEMINI_API_KEY production`, then `vercel deploy --prod`. Locally: put
`GEMINI_API_KEY=...` in `.env` — picked up within ~10 seconds, no restart.
Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`; if that model is unavailable the app auto-picks an
available Flash model). Without a key every AI control shows "add a key" and the rest of the app works normally.

| Feature | Where | What it does |
|---|---|---|
| Kisan Sahayak chat | `/assistant`, floating "✨ Ask AI" | Chat grounded in the user's own lots, offers, orders, sensor alerts and live DEMO prices; role-aware for farmer/FPO/buyer/admin; voice input + read-aloud |
| EN / हिंदी / मराठी | top bar toggle | Every AI answer, spoken input and read-aloud follows the chosen language |
| Explain SmartSell | lot page | Plain-language explanation of where to sell and what the farmer actually keeps |
| Voice/text lot entry | "Create a digital lot" | "120 quintal kanda kal kaata, size 50mm" → AI fills commodity, quantity (unit conversion), harvest date, grade/measurements |
| AI photo grading | lot photos (auto on upload, ✨ Re-check) | Gemini vision estimates quality parameters, graded with the platform's own rules; flags wrong-commodity photos; shown to buyers as "AI photo grade" |
| Negotiation copilot | each pending offer | Accept / counter (with price) / reject / wait, compared against mandi net and other demand |
| Fair-offer advisor | buyer marketplace | Offer range between the seller's mandi floor and the buyer's landed cost from mandis |
| Market brief | PricePulse | 4-bullet market summary per commodity |
| Fayda explanation | Fayda forecast | Explains the profit scenarios, break-even and how to improve margin |
| Storage & field advisory | Field Nigrani | Actions from sensor readings (ventilation, sorting, irrigation, sell sooner) |
| Scheme explainer | Schemes | Which suggested schemes to check first and how — never an eligibility decision |
| FPO pooling advisor | FPO dashboard | Which member lots to pool, grade trade-offs, where to sell |
| Grievance triage | order page (admin) | Severity, likely cause, suggested resolution (copy into the note), evidence to request |

Guard rails: every AI call re-checks login and ownership; answers are grounded in platform data with an
instruction never to invent figures; 15 AI calls/min per user and 300/hour overall protect the key on the
public link; AI output is always labelled as AI-generated.

## Hindi interface (हिंदी)

The **EN / हिं / मरा** toggle in the top bar switches the whole interface to Hindi — every page, label, status,
SmartSell recommendation, match reason, scheme text and server message. AI answers, voice input and read-aloud follow
the same setting in English, Hindi or Marathi (Marathi keeps the interface in English for now).

How it works: screens write strings inline as `t("English", "हिंदी")` (`getT()` on the server, `useT()` in client
components); the decision engine takes a language parameter so numbers are identical and only sentences change;
server-action messages are translated by the catalogue in `src/lib/actionMessages.ts`, and a unit test fails if any
fixed server message is missing its Hindi version.

## Features (blueprint §5)

| Blueprint feature | Status in this build | Where |
|---|---|---|
| 5.1 PricePulse | Live over seeded + imported data; 30-day trends, sparklines, 7-day projection, freshness | `/markets` |
| 5.2 Fayda Forecast | Profit scenarios from the farmer's own yield/cost inputs; trend band ≤ 30 days, historical range beyond — never extrapolated | `/farmer/fayda` |
| 5.3 SmartSell | Ranks every mandi **and** every live buyer offer by net ₹/qt; confidence + reasons; sell-now vs store 7/14 days | lot page |
| 5.4 NetRealise | Deterministic: real road-distance estimate, cheapest vehicle plan, loading, 2% market charges | `src/lib/engine/netRealise.ts` |
| 5.5 Digital Lot & Quality Hub | Commodity-specific measurements → rule-based grade (live preview), or self-declared; photo evidence validated by file content, SHA-256 fingerprinted, served through an auth-checked route | lot form, lot page |
| 5.6 Assured Contract Bridge | Every accepted offer creates agreement terms + SHA-256 fingerprint; re-verified on every view (tamper → MISMATCH) | `/orders/[id]/agreement` |
| 5.7 Verified buyer matching | Weighted score (distance, quantity fit, quality, price vs mandi net, verification) with reasons; admin verification | lot page, buyer marketplace, admin |
| 5.8 Digital offers | Offer → counter → accept/decline/withdraw; 48 h server-side expiry; partial-quantity sales; oversized offers auto-closed | lot page, buyer page |
| 5.9 Field Nigrani (IoT) | Device registration (key shown once, stored hashed), HTTPS ingestion API with validation + rate limit, 48 h dashboards, comfort-band alerts feeding SmartSell | `/farmer/field`, `POST /api/iot/readings` |
| 5.10 Maha-Subsidy recommender | Rule-based suggestions from farmer profile with reasons and official links; explicitly **not** an eligibility decision | `/farmer/schemes` |
| 5.11 Logistics | MOCK provider: pickup quote uses the same vehicle model as NetRealise | order page |
| 5.12 Storage | MOCK provider: compatible facilities by distance, capacity-checked booking/cancel | lot page |
| 5.13 Payment tracker | MOCK provider: buyer pays after delivery, farmer confirms receipt | order page |
| 5.14 Trust & grievance | Either party raises; admin resolves; closing blocked while any grievance is open; full audit trail | order page, admin |
| FPO role (§4) | Members, aggregate supply, pooled lots (grade = lowest contributed), pro-rata payout to members | `/fpo` |
| Admin (§4) | Verification, grievances, cross-tenant orders, CSV market-data import with row-level errors, source registry | `/admin` |

Order lifecycle (enforced server-side; each party only sees its own buttons):
`CREATED → LOGISTICS_BOOKED → IN_TRANSIT → DELIVERED → PAYMENT_INITIATED → PAID → CLOSED`

## Demo script (~6 min)

1. `/login` → **Judge quick start**. Ramesh's 120 qt onion lot opens on SmartSell: best market after costs,
   the nearest market for comparison, a Field Nigrani humidity alert, and a sell-now-vs-store table.
2. Scroll: quality evidence (measured), storage booking, all options ranked by net ₹/qt, buyers looking for onion.
3. Switch user → **Nashik Fresh Produce Co** → offer ₹1,880 × 100 qt on that lot.
   Switch → **FarmDirect Exports** → offer ₹1,900 × 120 qt.
4. Switch → **Ramesh**: SmartSell now recommends the best *offer* vs mandi. Counter Nashik Fresh at ₹1,950.
5. Switch → **Nashik Fresh**: accept the counter. The order is created, 20 qt stays on the lot, and FarmDirect's
   120 qt offer auto-closes. Open the order → **View digital agreement** (fingerprint intact).
6. Buyer: book pickup → mark picked up → confirm delivery → pay. Raise a grievance.
   Switch → **Ramesh**: confirm payment; closing is blocked by the open grievance.
7. Switch → **Platform Admin**: resolve the grievance; show verification, data sources and CSV import
   (download the sample file from the admin page — it backfills a stale feed and shows row-level rejections).
8. Switch → **Nashik Kanda Producers FPO**: pool member onion lots into one bulk lot, and show the payout split.

## Device API (Field Nigrani)

```bash
curl -X POST https://fasalsetu-ai-bice.vercel.app/api/iot/readings \
  -H 'x-device-key: <device key>' -H 'content-type: application/json' \
  -d '{"readings":[{"metric":"humidity_pct","value":68.5},{"metric":"temperature_c","value":27.9}]}'
```

Metrics: `temperature_c`, `humidity_pct`, `soil_moisture_pct`. Up to 100 readings per request and
30 requests per minute per device; `recordedAt` (ISO-8601) is optional and must be within the last 7 days.
Keys are shown once: on device registration, or printed by `npm run seed` for the two seeded sensors.

Health: `GET /api/health` (process) and `GET /api/ready` (database + latest market record).

## Architecture

- **Next.js 16 App Router** — Server Components read data; every mutation is a Server Action that
  authenticates, authorizes by role *and* ownership, validates with zod, and changes state with a
  guarded `updateMany` (so double-clicks and races fail cleanly instead of double-applying).
- **Prisma + PostgreSQL (Neon)** — pooled connection for the app, direct connection for schema pushes.
- **Pure engine** (`src/lib/engine/`) — distance, transport, forecast, NetRealise, matching, quality grading,
  agreement hashing, profit scenarios, scheme rules, CSV parsing and the order state machine. No I/O, fully
  unit-tested (`*.test.ts`).
- **Audit trail** — every business action writes an `AuditEvent`; shown per lot, per order and platform-wide.

## Honest limitations

- Market prices are **seeded DEMO/SAMPLE data** plus admin CSV imports. AGMARKNET/e-NAM is an adapter slot
  only, not connected.
- Logistics, storage and payment are **mock providers**. No real vehicle is booked and no money moves.
- Login is demo mode (pick an account). There are no passwords or OTP by design for the judge demo.
- Distances are straight-line × 1.25 road factor from district/market coordinates, not a routing API.
- Scheme rules are unverified suggestions. Fayda uses the farmer's own yield and cost inputs; there is no
  trained yield model.
- Rate limits (AI calls, access-code guesses, device API) are in-memory per server instance; on Vercel they
  are best-effort, so the access code is the real protection. Use Redis/Upstash for strict global limits.
- Interface is English and Hindi; Marathi applies to AI answers and voice only.
