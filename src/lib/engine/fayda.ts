export type FaydaInput = {
  areaAcres: number;
  yieldQtPerAcre: number;
  costPerAcre: number;
  deductionPerQt: number; // transport + market charges at the reference market
  prices: { label: string; price: number }[];
};

export type FaydaScenario = {
  label: string;
  price: number;
  revenue: number;
  deductions: number;
  cultivationCost: number;
  profit: number;
  profitPerAcre: number;
};

export type FaydaResult = {
  quantityQt: number;
  scenarios: FaydaScenario[];
  breakevenPricePerQt: number;
};

export function faydaScenarios(input: FaydaInput): FaydaResult {
  const quantityQt = input.areaAcres * input.yieldQtPerAcre;
  const cultivationCost = input.areaAcres * input.costPerAcre;
  const deductions = input.deductionPerQt * quantityQt;
  const scenarios = input.prices.map(({ label, price }) => {
    const revenue = price * quantityQt;
    const profit = revenue - deductions - cultivationCost;
    return {
      label,
      price,
      revenue,
      deductions,
      cultivationCost,
      profit,
      profitPerAcre: input.areaAcres > 0 ? profit / input.areaAcres : 0,
    };
  });
  const breakevenPricePerQt = quantityQt > 0 ? cultivationCost / quantityQt + input.deductionPerQt : 0;
  return { quantityQt, scenarios, breakevenPricePerQt };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
