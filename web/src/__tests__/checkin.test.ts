import { describe, expect, it } from "vitest";
import { createPublicClient, custom, encodeErrorResult, type Abi } from "viem";
import checkinAbi from "../../public/abi/EventCheckin.json";
import { decodeTitle, describeError, encodeTitle, eventState, type EventInfo } from "../lib/checkin";
import { formatChkn, parseChkn } from "../lib/format";

describe("titles", () => {
  it("encodes UTF-8 into right-padded bytes32 and decodes it back", () => {
    const hex = encodeTitle("Sepolia meetup ☕");
    expect(hex).toHaveLength(66);
    expect(decodeTitle(hex)).toBe("Sepolia meetup ☕");
    expect(decodeTitle(`0x${"00".repeat(32)}`)).toBe("(untitled)");
  });
  it("rejects titles above 32 bytes instead of cutting them", () => {
    expect(() => encodeTitle("x".repeat(33))).toThrow("at most 32 bytes");
  });
});

describe("amounts", () => {
  it("formats base units with the CHKN symbol", () => {
    expect(formatChkn(0n)).toBe("0 CHKN");
    expect(formatChkn(1_500_000_000_000_000_000n)).toBe("1.5 CHKN");
    expect(formatChkn(1_234_567_800_000_000_000_000n)).toBe("1,234.5678 CHKN");
    expect(formatChkn(1_234_567_890_000_000_000_000n)).toBe("≈1,234.5678 CHKN");
    expect(formatChkn(1n)).toBe("≈0 CHKN");
  });
  it("parses decimals and explains mistakes", () => {
    expect(parseChkn("2.5")).toBe(2_500_000_000_000_000_000n);
    expect(parseChkn("1,000")).toBe(1_000_000_000_000_000_000_000n);
    expect(() => parseChkn("abc")).toThrow("digits");
    expect(() => parseChkn("1." + "0".repeat(19))).toThrow("18 decimal");
  });
});

describe("event state", () => {
  const base: EventInfo = {
    id: 1n,
    organiser: "0x000000000000000000000000000000000000cafe",
    title: "t",
    titleRaw: `0x${"00".repeat(32)}`,
    endsAt: 1000n,
    closed: false,
    rewardPerCheckIn: 0n,
    pool: 0n,
    attendeeCount: 0n,
  };
  it("treats the end time as inclusive and closure as final", () => {
    expect(eventState(base, 1000)).toBe("open");
    expect(eventState(base, 1001)).toBe("ended");
    expect(eventState({ ...base, closed: true }, 1)).toBe("closed");
  });
});

describe("revert reasons", () => {
  it("maps the contract's custom errors from a simulated call to plain sentences", async () => {
    const abi = checkinAbi as Abi;
    const revertData = encodeErrorResult({ abi, errorName: "InvalidSignature" });
    const client = createPublicClient({
      transport: custom({
        request: async ({ method }: { method: string }) => {
          if (method === "eth_call") {
            throw Object.assign(new Error("execution reverted"), { code: 3, data: revertData });
          }
          if (method === "eth_chainId") return "0xaa36a7";
          throw new Error(`unexpected ${method}`);
        },
      }),
    });
    let message = "";
    try {
      await client.simulateContract({
        address: "0x000000000000000000000000000000000000cafe",
        abi,
        functionName: "checkIn",
        args: [1n, "0x000000000000000000000000000000000000cafe", 1n, "0x00"],
        account: "0x000000000000000000000000000000000000cafe",
      });
    } catch (error) {
      message = describeError(error);
    }
    expect(message).toBe("The signature is not a valid pass from this event's organiser.");
  });

  it("recognises wallet rejections", () => {
    expect(describeError(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toBe("The wallet request was rejected.");
  });
});
