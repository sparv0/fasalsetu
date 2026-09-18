import {
  DISTRICT_COORDS,
  LOADING_PER_QT,
  MIN_DISTANCE_KM,
  MIN_TRIP_CHARGE,
  ROAD_FACTOR,
  VEHICLES,
} from "./config";

export type Point = { lat: number; lng: number };

export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function roadDistanceKm(a: Point, b: Point): number {
  return Math.max(MIN_DISTANCE_KM, Math.round(haversineKm(a, b) * ROAD_FACTOR));
}

export function districtPoint(district: string): Point {
  const p = DISTRICT_COORDS[district];
  if (!p) throw new Error(`Unknown district: ${district}`);
  return p;
}

export type TransportQuote = {
  vehicle: string;
  trips: number;
  distanceKm: number;
  freight: number;
  loading: number;
  total: number;
};

// Cheapest single-vehicle-type plan for moving `quantityQt` over `distanceKm`.
export function quoteTransport(quantityQt: number, distanceKm: number): TransportQuote {
  if (quantityQt <= 0) throw new Error("Quantity must be positive");
  let best: TransportQuote | null = null;
  for (const v of VEHICLES) {
    const trips = Math.ceil(quantityQt / v.capacityQt);
    const freight = trips * Math.max(MIN_TRIP_CHARGE, v.ratePerKm * distanceKm);
    const loading = LOADING_PER_QT * quantityQt;
    const total = freight + loading;
    if (!best || total < best.total) {
      best = { vehicle: v.name, trips, distanceKm, freight, loading, total };
    }
  }
  return best!;
}
