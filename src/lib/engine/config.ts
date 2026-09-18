// Every cost assumption lives here so the UI can cite it and admins can tune it.
// All values are DEMO assumptions, not live quotes.

export const COMMODITIES = ["Onion", "Soybean", "Wheat"] as const;
export type Commodity = (typeof COMMODITIES)[number];

export const QUALITY_GRADES = ["C", "B", "A", "PREMIUM"] as const;
export type QualityGrade = (typeof QUALITY_GRADES)[number];
export const QUALITY_RANK: Record<string, number> = { C: 1, B: 2, A: 3, PREMIUM: 4 };

export const DISTRICT_COORDS: Record<string, { lat: number; lng: number }> = {
  Nashik: { lat: 19.9975, lng: 73.7898 },
  Pune: { lat: 18.5204, lng: 73.8567 },
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Ahmednagar: { lat: 19.0948, lng: 74.748 },
  Solapur: { lat: 17.6599, lng: 75.9064 },
};
export const DISTRICTS = Object.keys(DISTRICT_COORDS);

export const ROAD_FACTOR = 1.25; // straight-line → road distance
export const MIN_DISTANCE_KM = 8; // farm to nearest local yard

export type Vehicle = { name: string; capacityQt: number; ratePerKm: number };
export const VEHICLES: Vehicle[] = [
  { name: "Tempo (2.5 T)", capacityQt: 25, ratePerKm: 22 },
  { name: "Mini truck (7 T)", capacityQt: 70, ratePerKm: 32 },
  { name: "Truck (10 T)", capacityQt: 100, ratePerKm: 42 },
  { name: "Large truck (16 T)", capacityQt: 160, ratePerKm: 55 },
];
export const MIN_TRIP_CHARGE = 800;
export const LOADING_PER_QT = 12; // hamali: loading + unloading

export const MARKET_CHARGES_PCT = 0.02; // mandi cess + commission + weighing

export const STORAGE_HANDLING_PER_QT = 8; // in + out of storage
export const STORAGE_HORIZONS_DAYS = [7, 14];
// Physiological weight loss per day in storage
export const SHRINKAGE_PER_DAY: Record<string, number> = {
  Onion: 0.002,
  Soybean: 0.0002,
  Wheat: 0.0001,
};
// Storage must beat selling now by this margin to be recommended
export const STORAGE_MIN_GAIN_PCT = 0.02;

export const OFFER_PRICE_MAX = 100000; // ₹/qt sanity ceiling

export const GRIEVANCE_CATEGORIES = [
  "Quality mismatch",
  "Quantity shortfall",
  "Delivery delay",
  "Payment issue",
  "Other",
] as const;

export const OFFER_TTL_HOURS = 48;

export const MEDIA_MAX_BYTES = 3 * 1024 * 1024;
export const MEDIA_MAX_PER_LOT = 4;

export const IOT_METRICS = {
  temperature_c: { label: "Temperature", unit: "°C", min: -20, max: 70 },
  humidity_pct: { label: "Relative humidity", unit: "%", min: 0, max: 100 },
  soil_moisture_pct: { label: "Soil moisture", unit: "%", min: 0, max: 100 },
} as const;
export type IotMetric = keyof typeof IOT_METRICS;

// Configured comfort bands used to raise alerts (DEMO thresholds, tune per deployment).
export const COMFORT_BANDS: Record<"STORAGE" | "FIELD", Partial<Record<IotMetric, [number, number]>>> = {
  STORAGE: { temperature_c: [25, 30], humidity_pct: [65, 70] },
  FIELD: { soil_moisture_pct: [20, 60] },
};
