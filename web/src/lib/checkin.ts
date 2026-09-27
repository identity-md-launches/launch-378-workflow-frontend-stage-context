/**
 * EventCheckin and CHKN reads, typed data and transaction helpers.
 * All chain access goes through viem clients built from the runtime deployment configuration.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  bytesToHex,
  bytesToString,
  hexToBytes,
  stringToBytes,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { Deployment } from "./config";

export interface EventInfo {
  id: bigint;
  organiser: Address;
  title: string;
  titleRaw: Hex;
  endsAt: bigint;
  closed: boolean;
  rewardPerCheckIn: bigint;
  pool: bigint;
  attendeeCount: bigint;
}

export interface WalletState {
  balance: bigint;
  allowance: bigint;
  withdrawable: bigint;
}

export interface ContractStatus {
  checkinHasCode: boolean;
  tokenHasCode: boolean;
  /** EventCheckin.token() as read from chain. */
  tokenFromContract: Address | null;
  /** True when token() equals the LaunchToken address of the handoff. */
  tokenMatches: boolean;
}

/** UTF-8 encode a title into bytes32 (right-padded). Longer titles are rejected, not cut. */
export function encodeTitle(title: string): Hex {
  const bytes = stringToBytes(title.trim());
  if (bytes.length > 32) throw new Error("Use a title of at most 32 bytes (about 32 Latin characters).");
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return bytesToHex(padded);
}

export function decodeTitle(raw: Hex): string {
  const bytes = hexToBytes(raw);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  const text = bytesToString(bytes.slice(0, end)).replace(/[\u0000-\u001f]/g, "");
  return text || "(untitled)";
}

/** The exact EIP-712 payload for eth_signTypedData_v4 (docs/ABI.md). */
export function checkInTypedData(chainId: number, verifyingContract: Address, pass: { eventId: bigint; attendee: Address; deadline: bigint }) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      CheckIn: [
        { name: "eventId", type: "uint256" },
        { name: "attendee", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "CheckIn",
    domain: {
      name: "EventCheckin",
      version: "1",
      chainId,
      verifyingContract,
    },
    message: {
      eventId: pass.eventId.toString(),
      attendee: pass.attendee,
      deadline: pass.deadline.toString(),
    },
  } as const;
}

export async function readContractStatus(client: PublicClient, d: Deployment): Promise<ContractStatus> {
  const [checkinCode, tokenCode] = await Promise.all([
    client.getCode({ address: d.checkin }),
    client.getCode({ address: d.token }),
  ]);
  const checkinHasCode = !!checkinCode && checkinCode !== "0x";
  const tokenHasCode = !!tokenCode && tokenCode !== "0x";
  let tokenFromContract: Address | null = null;
  if (checkinHasCode) {
    tokenFromContract = (await client.readContract({
      address: d.checkin,
      abi: d.checkinAbi,
      functionName: "token",
    })) as Address;
  }
  return {
    checkinHasCode,
    tokenHasCode,
    tokenFromContract,
    tokenMatches: !!tokenFromContract && tokenFromContract.toLowerCase() === d.token.toLowerCase(),
  };
}

export async function readEventCount(client: PublicClient, d: Deployment): Promise<bigint> {
  return (await client.readContract({ address: d.checkin, abi: d.checkinAbi, functionName: "eventCount" })) as bigint;
}

export async function readEvent(client: PublicClient, d: Deployment, id: bigint): Promise<EventInfo> {
  const r = (await client.readContract({
    address: d.checkin,
    abi: d.checkinAbi,
    functionName: "eventInfo",
    args: [id],
  })) as readonly [Address, Hex, bigint, boolean, bigint, bigint, bigint];
  return {
    id,
    organiser: r[0],
    titleRaw: r[1],
    title: decodeTitle(r[1]),
    endsAt: r[2],
    closed: r[3],
    rewardPerCheckIn: r[4],
    pool: r[5],
    attendeeCount: r[6],
  };
}

export async function readAllEvents(client: PublicClient, d: Deployment): Promise<EventInfo[]> {
  const count = await readEventCount(client, d);
  const ids: bigint[] = [];
  for (let i = count; i >= 1n; i -= 1n) ids.push(i);
  const events: EventInfo[] = [];
  // Small batches keep public RPC usage modest.
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map((id) => readEvent(client, d, id)));
    events.push(...batch);
  }
  return events;
}

export async function readWalletState(client: PublicClient, d: Deployment, account: Address): Promise<WalletState> {
  const [balance, allowance, withdrawable] = await Promise.all([
    client.readContract({ address: d.token, abi: d.tokenAbi, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
    client.readContract({ address: d.token, abi: d.tokenAbi, functionName: "allowance", args: [account, d.checkin] }) as Promise<bigint>,
    client.readContract({ address: d.checkin, abi: d.checkinAbi, functionName: "withdrawable", args: [account] }) as Promise<bigint>,
  ]);
  return { balance, allowance, withdrawable };
}

export async function readAttended(client: PublicClient, d: Deployment, eventId: bigint, attendee: Address): Promise<boolean> {
  return (await client.readContract({
    address: d.checkin,
    abi: d.checkinAbi,
    functionName: "attended",
    args: [eventId, attendee],
  })) as boolean;
}

export type EventOpenState = "open" | "closed" | "ended";

export function eventState(e: EventInfo, now: number): EventOpenState {
  if (e.closed) return "closed";
  if (BigInt(now) > e.endsAt) return "ended";
  return "open";
}

/** Human-readable revert reasons for the contract's custom errors. */
const ERROR_TEXT: Record<string, string> = {
  InvalidEndTime: "The end time must be in the future and at most 365 days ahead.",
  UnknownEvent: "No event has this id.",
  EventNotOpen: "This event is closed or has ended, so it no longer accepts funding or check-ins.",
  NotOrganiser: "Only the organiser of this event can do that.",
  AlreadyClosed: "This event is already closed.",
  InvalidAmount: "Enter an amount greater than zero.",
  UnexpectedTokenAmount: "The token transfer moved an unexpected amount.",
  InvalidAttendee: "The attendee address cannot be the zero address.",
  PassExpired: "This pass has passed its deadline.",
  AlreadyAttended: "This attendee is already checked in to this event.",
  InvalidSignature: "The signature is not a valid pass from this event's organiser.",
  EventStillOpen: "The event is still open. Close it or wait for its end time before reclaiming.",
  NothingToWithdraw: "There is nothing to withdraw for this account.",
  ERC20InsufficientAllowance: "The CHKN allowance for EventCheckin is too small. Approve first.",
  ERC20InsufficientBalance: "The CHKN balance is too small for this amount.",
};

/** Turn a viem/wallet error into a short sentence with the revert reason when there is one. */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = reverted?.data?.errorName;
    if (name && ERROR_TEXT[name]) return ERROR_TEXT[name]!;
    if (name) return `The contract rejected the call: ${name}.`;
    if (reverted?.reason) return `The contract rejected the call: ${reverted.reason}.`;
    if (/user rejected|user denied/i.test(error.shortMessage)) return "The wallet request was rejected.";
    return error.shortMessage;
  }
  const e = error as { code?: number; message?: string };
  if (e?.code === 4001) return "The wallet request was rejected.";
  if (e?.message) return e.message.length > 200 ? `${e.message.slice(0, 200)}…` : e.message;
  return "Something went wrong. Try again.";
}

export interface TxContext {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  deployment: Deployment;
  /** Progress callback used by the UI to show pending/mined state. */
  onStatus: (phase: "simulating" | "signing" | "pending" | "mined", hash?: Hex) => void;
}

interface CallSpec {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

/** Simulate, ask the wallet to sign, wait for the receipt. Throws with a readable message on failure. */
export async function sendCall(ctx: TxContext, call: CallSpec): Promise<Hex> {
  ctx.onStatus("simulating");
  const chain = ctx.publicClient.chain;
  const { request } = await ctx.publicClient.simulateContract({
    ...call,
    account: ctx.account,
    chain,
  });
  ctx.onStatus("signing");
  const hash = await ctx.walletClient.writeContract({ ...request, account: ctx.account, chain });
  ctx.onStatus("pending", hash);
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error("The transaction was mined but reverted.");
  ctx.onStatus("mined", hash);
  return hash;
}

export const actions = {
  approve: (ctx: TxContext, amount: bigint) =>
    sendCall(ctx, { address: ctx.deployment.token, abi: ctx.deployment.tokenAbi, functionName: "approve", args: [ctx.deployment.checkin, amount] }),
  createEvent: (ctx: TxContext, title: Hex, endsAt: bigint, reward: bigint) =>
    sendCall(ctx, { address: ctx.deployment.checkin, abi: ctx.deployment.checkinAbi, functionName: "createEvent", args: [title, endsAt, reward] }),
  fundEvent: (ctx: TxContext, eventId: bigint, amount: bigint) =>
    sendCall(ctx, { address: ctx.deployment.checkin, abi: ctx.deployment.checkinAbi, functionName: "fundEvent", args: [eventId, amount] }),
  closeEvent: (ctx: TxContext, eventId: bigint) =>
    sendCall(ctx, { address: ctx.deployment.checkin, abi: ctx.deployment.checkinAbi, functionName: "closeEvent", args: [eventId] }),
  reclaim: (ctx: TxContext, eventId: bigint) =>
    sendCall(ctx, { address: ctx.deployment.checkin, abi: ctx.deployment.checkinAbi, functionName: "reclaim", args: [eventId] }),
  checkIn: (ctx: TxContext, eventId: bigint, attendee: Address, deadline: bigint, signature: Hex) =>
    sendCall(ctx, { address: ctx.deployment.checkin, abi: ctx.deployment.checkinAbi, functionName: "checkIn", args: [eventId, attendee, deadline, signature] }),
  withdraw: (ctx: TxContext) =>
    sendCall(ctx, { address: ctx.deployment.checkin, abi: ctx.deployment.checkinAbi, functionName: "withdraw", args: [] }),
};

/** Dry-run a check-in to surface the revert reason before asking anyone to sign. */
export async function simulateCheckIn(client: PublicClient, d: Deployment, account: Address, pass: { eventId: bigint; attendee: Address; deadline: bigint; signature: Hex }): Promise<void> {
  await client.simulateContract({
    address: d.checkin,
    abi: d.checkinAbi,
    functionName: "checkIn",
    args: [pass.eventId, pass.attendee, pass.deadline, pass.signature],
    account,
  });
}
