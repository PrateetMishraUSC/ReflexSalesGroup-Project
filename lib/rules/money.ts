// Exact money maths with integers: unit costs in 1/10,000 dollar, line values and totals in cents.
import { MAX_COST_DECIMALS } from "./config";

export type CostUnits = number;
export type Cents = number;

export const UNITS_PER_DOLLAR = 10_000;

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export function isPlainDecimal(text: string): boolean {
  return DECIMAL.test(text);
}

export function decimalPlaces(text: string): number {
  return DECIMAL.exec(text)?.[3]?.length ?? 0;
}

export function numberToDecimal(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(Number(value.toPrecision(15)));
  return isPlainDecimal(text) ? text : null;
}

export function decimalToUnits(text: string): CostUnits | null {
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > MAX_COST_DECIMALS || whole.length > 9) return null;
  const units = Number(whole) * UNITS_PER_DOLLAR + Number(fraction.padEnd(MAX_COST_DECIMALS, "0"));
  return sign === "-" ? -units : units;
}

export function unitsToDecimal(units: CostUnits): string {
  const sign = units < 0 ? "-" : "";
  const abs = Math.abs(units);
  const whole = Math.floor(abs / UNITS_PER_DOLLAR);
  const fraction = String(abs % UNITS_PER_DOLLAR).padStart(4, "0").replace(/0{1,2}$/, "");
  return `${sign}${whole}.${fraction.padEnd(2, "0")}`;
}

export function lineValueCents(quantity: number, unitCost: CostUnits): Cents {
  const hundredthsOfCent = quantity * unitCost;
  const remainder = hundredthsOfCent % 100;
  const cents = (hundredthsOfCent - remainder) / 100;
  return remainder >= 50 ? cents + 1 : cents;
}

export function centsToDecimal(cents: Cents | bigint): string {
  const value = BigInt(cents);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
