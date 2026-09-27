import { formatUnits, parseUnits } from "viem";

export const CHKN_DECIMALS = 18;
export const CHKN_SYMBOL = "CHKN";

/** Format base units as a CHKN amount with at most `maxFraction` fraction digits (no rounding up). */
export function formatChkn(value: bigint, maxFraction = 4): string {
  const full = formatUnits(value, CHKN_DECIMALS);
  const [whole, fraction = ""] = full.split(".");
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, "");
  const wholeGrouped = Number.isSafeInteger(Number(whole)) ? Number(whole).toLocaleString("en-US") : whole;
  const shown = trimmed ? `${wholeGrouped}.${trimmed}` : wholeGrouped;
  const truncated = fraction.replace(/0+$/, "").length > maxFraction;
  return `${truncated ? "≈" : ""}${shown} ${CHKN_SYMBOL}`;
}

/** Parse a decimal CHKN amount typed by the user into base units. Throws with a fix hint. */
export function parseChkn(input: string): bigint {
  const text = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") {
    throw new Error("Enter an amount in CHKN using digits and at most one decimal point.");
  }
  const [, fraction = ""] = text.split(".");
  if (fraction.length > CHKN_DECIMALS) throw new Error(`Use at most ${CHKN_DECIMALS} decimal places.`);
  return parseUnits(text, CHKN_DECIMALS);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTimestamp(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000;
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Local datetime-local input value for a Unix timestamp. */
export function toDatetimeLocal(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): number {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw new Error("Choose a date and time.");
  return Math.floor(ms / 1000);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
