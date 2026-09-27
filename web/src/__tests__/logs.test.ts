import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { attendeesForEvent, LOG_CHUNK, newScanState, REORG_OVERLAP, scanCheckIns } from "../lib/logs";

const ADDRESS = "0x000000000000000000000000000000000000cafe" as const;

function makeLog(eventId: bigint, attendee: string, blockNumber: bigint, logIndex: number, txHash = "0x01") {
  return {
    args: { eventId, attendee, submitter: attendee, reward: 5n },
    blockNumber,
    logIndex,
    transactionHash: txHash,
    removed: false,
  };
}

function fakeClient(head: bigint, logs: ReturnType<typeof makeLog>[]) {
  const ranges: [bigint, bigint][] = [];
  const client = {
    getBlockNumber: async () => head,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]);
      return logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
  } as unknown as PublicClient;
  return { client, ranges };
}

describe("scanCheckIns", () => {
  it("chunks from the deployment block to the head", async () => {
    const { client, ranges } = fakeClient(100n + LOG_CHUNK * 2n + 10n, [makeLog(1n, "0xa", 150n, 0), makeLog(1n, "0xb", 100n + LOG_CHUNK + 1n, 3, "0x02")]);
    const state = await scanCheckIns(client, ADDRESS, 100n, newScanState());
    expect(ranges).toEqual([
      [100n, 100n + LOG_CHUNK - 1n],
      [100n + LOG_CHUNK, 100n + LOG_CHUNK * 2n - 1n],
      [100n + LOG_CHUNK * 2n, 100n + LOG_CHUNK * 2n + 10n],
    ]);
    expect(state.scannedTo).toBe(100n + LOG_CHUNK * 2n + 10n);
    expect(attendeesForEvent(state, 1n).map((r) => r.attendee)).toEqual(["0xa", "0xb"]);
  });

  it("rescans the overlap window, deduplicates by tx hash and log index and drops reorganised logs", async () => {
    const first = fakeClient(1000n, [makeLog(1n, "0xa", 990n, 0, "0xaa"), makeLog(1n, "0xb", 999n, 1, "0xbb")]);
    const state1 = await scanCheckIns(first.client, ADDRESS, 900n, newScanState());
    expect(state1.records.size).toBe(2);

    // On refresh the log at 999 is gone (reorg) and a new one arrives; the one at 990 is seen again.
    const second = fakeClient(1010n, [makeLog(1n, "0xa", 990n, 0, "0xaa"), makeLog(1n, "0xc", 1005n, 0, "0xcc")]);
    const state2 = await scanCheckIns(second.client, ADDRESS, 900n, state1);
    expect(second.ranges).toEqual([[1000n - REORG_OVERLAP + 1n, 1010n]]);
    expect(attendeesForEvent(state2, 1n).map((r) => r.attendee)).toEqual(["0xa", "0xc"]);
    expect(state2.records.size).toBe(2);
  });
});
