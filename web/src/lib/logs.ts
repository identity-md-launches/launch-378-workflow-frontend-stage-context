/**
 * Attendee lists come from CheckedIn logs only. Ranges are scanned in chunks from the
 * deployment block, deduplicated by transaction hash and log index, and the last few
 * blocks are rescanned on refresh so a shallow reorganisation cannot leave a stale entry.
 */
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";

export interface CheckInRecord {
  eventId: bigint;
  attendee: Address;
  submitter: Address;
  reward: bigint;
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
}

export const CHECKED_IN_EVENT = parseAbiItem(
  "event CheckedIn(uint256 indexed eventId, address indexed attendee, address indexed submitter, uint256 reward)",
);

export const LOG_CHUNK = 5_000n;
/** Blocks rescanned on every refresh to absorb shallow reorganisations. */
export const REORG_OVERLAP = 64n;

export interface LogScanState {
  records: Map<string, CheckInRecord>;
  /** Highest block scanned so far (inclusive). */
  scannedTo: bigint | null;
}

export function newScanState(): LogScanState {
  return { records: new Map(), scannedTo: null };
}

export function recordKey(txHash: Hex, logIndex: number): string {
  return `${txHash}:${logIndex}`;
}

/**
 * Scan CheckedIn logs from `fromBlock` to the latest block in chunks of LOG_CHUNK blocks.
 * Returns the updated state; callers pass the previous state for incremental updates.
 */
export async function scanCheckIns(
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
  state: LogScanState,
  latest?: bigint,
): Promise<LogScanState> {
  const head = latest ?? (await client.getBlockNumber());
  let start = state.scannedTo === null ? fromBlock : state.scannedTo - REORG_OVERLAP + 1n;
  if (start < fromBlock) start = fromBlock;
  const records = new Map(state.records);
  if (state.scannedTo !== null) {
    // Drop entries in the overlap window; they are re-added if the logs are still canonical.
    for (const [key, r] of records) if (r.blockNumber >= start) records.delete(key);
  }
  while (start <= head) {
    const end = start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n;
    const logs = await client.getLogs({ address, event: CHECKED_IN_EVENT, fromBlock: start, toBlock: end });
    for (const log of logs) {
      if (log.removed || log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
      const { eventId, attendee, submitter, reward } = log.args;
      if (eventId === undefined || attendee === undefined || submitter === undefined || reward === undefined) continue;
      records.set(recordKey(log.transactionHash, log.logIndex), {
        eventId,
        attendee,
        submitter,
        reward,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
      });
    }
    start = end + 1n;
  }
  return { records, scannedTo: head };
}

export function attendeesForEvent(state: LogScanState, eventId: bigint): CheckInRecord[] {
  return [...state.records.values()]
    .filter((r) => r.eventId === eventId)
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}
