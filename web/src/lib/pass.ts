/**
 * A pass is the organiser's EIP-712 signature over CheckIn(eventId, attendee, deadline).
 * It travels as copyable JSON text or as a link fragment; both carry the same four fields.
 * Imported passes are untrusted until checked against the selected deployment on-chain.
 */
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

export interface Pass {
  eventId: bigint;
  attendee: Address;
  deadline: bigint;
  signature: Hex;
}

export interface PassText {
  eventId: string;
  attendee: string;
  deadline: string;
  signature: string;
}

export const PASS_ROUTE = "pass";

export function passToText(pass: Pass): PassText {
  return {
    eventId: pass.eventId.toString(),
    attendee: pass.attendee,
    deadline: pass.deadline.toString(),
    signature: pass.signature,
  };
}

export function passToJson(pass: Pass): string {
  return JSON.stringify(passToText(pass), null, 2);
}

/** Build a link to this page carrying the pass in the hash (no server routing needed). */
export function passToLink(pass: Pass, pageUrl: string): string {
  const params = new URLSearchParams({ ...passToText(pass) });
  const base = pageUrl.split("#")[0]!;
  return `${base}#${PASS_ROUTE}?${params.toString()}`;
}

function parseUint(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(`The pass field "${field}" must be a whole number.`);
  }
  return BigInt(value.trim());
}

export function passFromFields(fields: Record<string, unknown>): Pass {
  const attendee = fields.attendee;
  if (typeof attendee !== "string" || !isAddress(attendee.trim(), { strict: false })) {
    throw new Error('The pass field "attendee" must be an Ethereum address.');
  }
  const signature = fields.signature;
  if (typeof signature !== "string" || !isHex(signature.trim()) || signature.trim().length < 4) {
    throw new Error('The pass field "signature" must be hex starting with 0x.');
  }
  const eventId = parseUint(fields.eventId, "eventId");
  if (eventId === 0n) throw new Error("Event ids start at 1.");
  return {
    eventId,
    attendee: getAddress(attendee.trim()),
    deadline: parseUint(fields.deadline, "deadline"),
    signature: signature.trim() as Hex,
  };
}

/** Parse a pass from pasted JSON text or from a full/partial link. */
export function parsePass(input: string): Pass {
  const text = input.trim();
  if (text === "") throw new Error("Paste the pass text or link.");
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("The pass text is not valid JSON. Paste the whole pass, including the braces.");
    }
    if (!parsed || typeof parsed !== "object") throw new Error("The pass text must be a JSON object.");
    return passFromFields(parsed as Record<string, unknown>);
  }
  const hashIndex = text.indexOf("#");
  const fragment = hashIndex >= 0 ? text.slice(hashIndex + 1) : text;
  const query = fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment;
  const params = new URLSearchParams(query);
  if (!params.has("signature")) throw new Error("Paste the pass JSON or a pass link that contains eventId, attendee, deadline and signature.");
  return passFromFields(Object.fromEntries(params.entries()));
}

/** Read a pass from the current location hash, if the hash is a pass route. */
export function passFromHash(hash: string): Pass | null {
  const clean = hash.replace(/^#/, "");
  if (!clean.startsWith(`${PASS_ROUTE}?`)) return null;
  return parsePass(clean);
}
