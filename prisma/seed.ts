import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 90;
const OFFER_TTL_MS = 48 * 60 * 60 * 1000;

// Fresh random keys on every seed; printed once so the device API can be tried. Never published.
const DEMO_DEVICE_KEYS = {
  storage: `fsd_${randomBytes(18).toString("base64url")}`,
  field: `fsd_${randomBytes(18).toString("base64url")}`,
};

// Deterministic PRNG so every reseed produces identical demo numbers.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MARKETS = [
  { key: "LSG", name: "Lasalgaon APMC", district: "Nashik", lat: 20.15, lng: 74.2333, priceFactor: 1.0, arrivals: 1400 },
  { key: "NSK", name: "Nashik APMC", district: "Nashik", lat: 20.0059, lng: 73.791, priceFactor: 0.99, arrivals: 600 },
  { key: "PNE", name: "Pune Market Yard", district: "Pune", lat: 18.4884, lng: 73.865, priceFactor: 1.05, arrivals: 900 },
  { key: "VSH", name: "Vashi APMC (Navi Mumbai)", district: "Thane", lat: 19.0771, lng: 73.0087, priceFactor: 1.08, arrivals: 1100 },
  { key: "AHN", name: "Ahmednagar APMC", district: "Ahmednagar", lat: 19.0952, lng: 74.7496, priceFactor: 0.97, arrivals: 500 },
  { key: "SLP", name: "Solapur APMC", district: "Solapur", lat: 17.6599, lng: 75.9064, priceFactor: 1.01, arrivals: 450 },
];

// trendPerDay: market-wide drift; noise: daily variation; spread: min/max around modal
const COMMODITIES = [
  { name: "Onion", base: 1850, trendPerDay: 0.0025, noise: 0.025, spread: 0.12, arrivalsFactor: 1 },
  { name: "Soybean", base: 4350, trendPerDay: -0.0006, noise: 0.008, spread: 0.05, arrivalsFactor: 0.35 },
  { name: "Wheat", base: 2480, trendPerDay: 0.0003, noise: 0.005, spread: 0.04, arrivalsFactor: 0.25 },
];

// One feed goes quiet 4 days ago so the UI shows how stale data lowers confidence.
const STALE_FEEDS: Record<string, number> = { "SLP:Wheat": 4 };

async function main() {
  console.log("Clearing existing data...");
  await prisma.auditEvent.deleteMany();
  await prisma.iotReading.deleteMany();
  await prisma.device.deleteMany();
  await prisma.storageBooking.deleteMany();
  await prisma.lotMedia.deleteMany();
  await prisma.grievance.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.logisticsBooking.deleteMany();
  await prisma.order.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.buyerDemand.deleteMany();
  await prisma.poolContribution.deleteMany();
  await prisma.lot.deleteMany();
  await prisma.priceRecord.deleteMany();
  await prisma.storageFacility.deleteMany();
  await prisma.market.deleteMany();
  await prisma.user.updateMany({ data: { fpoId: null } });
  await prisma.user.deleteMany();

  console.log("Seeding markets and price history...");
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  const marketIds: Record<string, string> = {};
  let priceRows = 0;

  for (const [mi, m] of MARKETS.entries()) {
    const market = await prisma.market.create({
      data: { name: m.name, district: m.district, lat: m.lat, lng: m.lng },
    });
    marketIds[m.key] = market.id;

    for (const [ci, c] of COMMODITIES.entries()) {
      const rand = mulberry32(1000 * (mi + 1) + ci);
      const localTrend = (rand() - 0.5) * 0.002;
      const staleDays = STALE_FEEDS[`${m.key}:${c.name}`] ?? 0;
      const rows = [];
      for (let d = HISTORY_DAYS - 1; d >= staleDays; d--) {
        const date = new Date(today.getTime() - d * DAY_MS);
        if (date.getDay() === 0) continue; // APMCs closed on Sundays
        const drift = 1 - (c.trendPerDay + localTrend) * d;
        const seasonal = 1 + 0.02 * Math.sin((d / 45) * Math.PI);
        const noise = 1 + (rand() - 0.5) * 2 * c.noise;
        const modal = Math.round(c.base * m.priceFactor * drift * seasonal * noise);
        const min = Math.round(modal * (1 - c.spread * (0.6 + rand() * 0.4)));
        const max = Math.round(modal * (1 + c.spread * (0.6 + rand() * 0.4)));
        const arrivals = Math.round(m.arrivals * c.arrivalsFactor * (0.7 + rand() * 0.6));
        rows.push({ marketId: market.id, commodity: c.name, date, minPrice: min, modalPrice: modal, maxPrice: max, arrivalsQt: arrivals });
      }
      await prisma.priceRecord.createMany({ data: rows });
      priceRows += rows.length;
    }
  }

  console.log("Seeding storage facilities...");
  await prisma.storageFacility.createMany({
    data: [
      { name: "Niphad Onion Storage Co-op (DEMO)", district: "Nashik", lat: 20.08, lng: 74.11, commodities: "Onion", capacityQt: 5000, availableQt: 3200, costPerQtPerDay: 1.1 },
      { name: "Nashik Agri Warehouse (DEMO)", district: "Nashik", lat: 19.95, lng: 73.83, commodities: "Soybean,Wheat", capacityQt: 8000, availableQt: 5000, costPerQtPerDay: 0.35 },
      { name: "Pune Grain Storage (DEMO)", district: "Pune", lat: 18.55, lng: 73.92, commodities: "Soybean,Wheat", capacityQt: 6000, availableQt: 2500, costPerQtPerDay: 0.4 },
      { name: "Ahmednagar Cold Chain Hub (DEMO)", district: "Ahmednagar", lat: 19.1, lng: 74.72, commodities: "Onion,Soybean", capacityQt: 3000, availableQt: 1500, costPerQtPerDay: 1.4 },
    ],
  });

  console.log("Seeding users...");
  const mk = (
    role: "FARMER" | "FPO" | "BUYER" | "ADMIN",
    name: string,
    phone: string,
    district: string,
    verified: boolean,
    extra: { fpoId?: string; landAcres?: number; socialCategory?: string } = {}
  ) => prisma.user.create({ data: { role, name, phone, district, verified, ...extra } });

  const fpo = await mk("FPO", "Nashik Kanda Producers FPO (DEMO)", "9800000021", "Nashik", true);
  const ramesh = await mk("FARMER", "Ramesh Patil", "9800000001", "Nashik", true, { fpoId: fpo.id, landAcres: 6, socialCategory: "OBC" });
  const sunita = await mk("FARMER", "Sunita Jadhav", "9800000002", "Pune", true, { landAcres: 11, socialCategory: "GENERAL" });
  const vikram = await mk("FARMER", "Vikram More", "9800000003", "Nashik", false, { fpoId: fpo.id, landAcres: 3.5, socialCategory: "SC" });
  const anita = await mk("FARMER", "Anita Shinde", "9800000004", "Nashik", true, { fpoId: fpo.id, landAcres: 2, socialCategory: "ST" });

  const agroTrade = await mk("BUYER", "AgroTrade Mumbai Pvt Ltd", "9800000011", "Mumbai", true);
  const nashikFresh = await mk("BUYER", "Nashik Fresh Produce Co", "9800000012", "Nashik", true);
  const puneWholesale = await mk("BUYER", "Pune Wholesale Grains", "9800000013", "Pune", false);
  const farmDirect = await mk("BUYER", "FarmDirect Exports", "9800000014", "Nashik", true);

  const admin = await mk("ADMIN", "Platform Admin", "9800000099", "Nashik", true);

  console.log("Seeding lots...");
  const harvested = new Date(today.getTime() - 3 * DAY_MS);
  type Spec = { farmer: { id: string; name: string; district: string }; commodity: string; qty: number; grade: string; params?: Record<string, number> };
  const lotSpecs: Spec[] = [
    { farmer: ramesh, commodity: "Onion", qty: 120, grade: "A", params: { bulbSizeMm: 52, damagedPct: 3.5, sproutedPct: 1.2 } },
    { farmer: ramesh, commodity: "Soybean", qty: 60, grade: "B" },
    { farmer: sunita, commodity: "Wheat", qty: 200, grade: "A", params: { moisturePct: 11.5, foreignMatterPct: 0.6, brokenPct: 2.1 } },
    { farmer: sunita, commodity: "Onion", qty: 80, grade: "B" },
    { farmer: vikram, commodity: "Onion", qty: 150, grade: "PREMIUM", params: { bulbSizeMm: 61, damagedPct: 1.4, sproutedPct: 0.5 } },
    { farmer: vikram, commodity: "Soybean", qty: 40, grade: "C" },
    { farmer: anita, commodity: "Soybean", qty: 35, grade: "B", params: { moisturePct: 12.8, foreignMatterPct: 1.2, damagedPct: 2.5 } },
    { farmer: anita, commodity: "Onion", qty: 45, grade: "A", params: { bulbSizeMm: 48, damagedPct: 4.1, sproutedPct: 2.0 } },
  ];
  const lots: Record<string, string> = {};
  for (const s of lotSpecs) {
    const lot = await prisma.lot.create({
      data: {
        farmerId: s.farmer.id,
        commodity: s.commodity,
        quantityQt: s.qty,
        availableQt: s.qty,
        qualityGrade: s.grade,
        qualityParams: s.params ? JSON.stringify(s.params) : null,
        harvestDate: harvested,
        district: s.farmer.district,
        createdAt: new Date(today.getTime() - 2 * DAY_MS),
      },
    });
    lots[`${s.farmer.name}:${s.commodity}`] = lot.id;
    await prisma.auditEvent.create({
      data: {
        action: "LOT_CREATED",
        detail: `${s.commodity} ${s.qty} qt, grade ${s.grade} (${s.params ? "measured" : "self-declared"})`,
        actorId: s.farmer.id,
        lotId: lot.id,
        createdAt: lot.createdAt,
      },
    });
  }

  console.log("Seeding buyer demand...");
  await prisma.buyerDemand.createMany({
    data: [
      { buyerId: agroTrade.id, commodity: "Onion", quantityQt: 100, qualityMin: "B", district: "Mumbai", pricePerQt: 1950, deliveryDays: 5 },
      { buyerId: nashikFresh.id, commodity: "Onion", quantityQt: 130, qualityMin: "A", district: "Nashik", pricePerQt: 1900, deliveryDays: 3 },
      { buyerId: farmDirect.id, commodity: "Onion", quantityQt: 150, qualityMin: "A", district: "Nashik", pricePerQt: 1960, deliveryDays: 4 },
      { buyerId: puneWholesale.id, commodity: "Wheat", quantityQt: 200, qualityMin: "B", district: "Pune", pricePerQt: 2550, deliveryDays: 6 },
      { buyerId: nashikFresh.id, commodity: "Soybean", quantityQt: 50, qualityMin: "B", district: "Nashik", pricePerQt: 4300, deliveryDays: 5 },
      { buyerId: agroTrade.id, commodity: "Soybean", quantityQt: 60, qualityMin: "C", district: "Mumbai", pricePerQt: 4250, deliveryDays: 7 },
    ],
  });

  console.log("Seeding open offers...");
  const openOffers = [
    { lot: lots["Sunita Jadhav:Wheat"], buyer: puneWholesale, price: 2520, qty: 150, score: 71 },
    { lot: lots["Vikram More:Onion"], buyer: farmDirect, price: 1960, qty: 150, score: 88 },
  ];
  for (const o of openOffers) {
    const offer = await prisma.offer.create({
      data: {
        lotId: o.lot,
        buyerId: o.buyer.id,
        pricePerQt: o.price,
        quantityQt: o.qty,
        matchScore: o.score,
        matchReasons: JSON.stringify(["Seeded demo offer."]),
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 6 * 60 * 60 * 1000 + OFFER_TTL_MS),
      },
    });
    await prisma.auditEvent.create({
      data: {
        action: "OFFER_SENT",
        detail: `${o.buyer.name} offered ₹${o.price}/qt for ${o.qty} qt`,
        actorId: o.buyer.id,
        lotId: o.lot,
        offerId: offer.id,
        createdAt: offer.createdAt,
      },
    });
  }

  console.log("Seeding Field Nigrani devices...");
  const hash = (k: string) => createHash("sha256").update(k).digest("hex");
  const storage = await prisma.device.create({
    data: { farmerId: ramesh.id, name: "Onion storage shed sensor", purpose: "STORAGE", keyHash: hash(DEMO_DEVICE_KEYS.storage), keyHint: DEMO_DEVICE_KEYS.storage.slice(-4) },
  });
  const field = await prisma.device.create({
    data: { farmerId: ramesh.id, name: "North plot soil probe", purpose: "FIELD", keyHash: hash(DEMO_DEVICE_KEYS.field), keyHint: DEMO_DEVICE_KEYS.field.slice(-4) },
  });
  const readings = [];
  const rnd = mulberry32(42);
  for (let h = 47; h >= 0; h--) {
    const at = new Date(Date.now() - h * 60 * 60 * 1000);
    const hourOfDay = at.getHours();
    const temp = 27.5 + 2.2 * Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI) + (rnd() - 0.5);
    // Humidity creeps up over the last day — a realistic spoilage-risk signal for stored onion.
    const humidity = 66 + Math.max(0, 24 - h) * 0.45 + (rnd() - 0.5) * 1.5;
    const soil = 34 - (47 - h) * 0.33 + (rnd() - 0.5);
    readings.push(
      { deviceId: storage.id, metric: "temperature_c", value: +temp.toFixed(1), recordedAt: at },
      { deviceId: storage.id, metric: "humidity_pct", value: +humidity.toFixed(1), recordedAt: at },
      { deviceId: field.id, metric: "soil_moisture_pct", value: +soil.toFixed(1), recordedAt: at }
    );
  }
  await prisma.iotReading.createMany({ data: readings });

  await prisma.auditEvent.create({
    data: { action: "DEMO_SEEDED", detail: `Demo environment reset: ${priceRows} price records across ${MARKETS.length} markets`, actorId: admin.id },
  });

  console.log(`Device keys (save them now, they are not stored): storage=${DEMO_DEVICE_KEYS.storage} field=${DEMO_DEVICE_KEYS.field}`);
  console.log(`Seed complete: ${priceRows} price records, ${lotSpecs.length} lots, ${openOffers.length} open offers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
