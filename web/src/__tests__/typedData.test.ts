import { describe, expect, it } from "vitest";
import { concatHex, encodeAbiParameters, hashTypedData, keccak256, stringToHex, toHex, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkInTypedData } from "../lib/checkin";

const CONTRACT = "0x1111111111111111111111111111111111111111" as const;

/** The wallet receives the JSON text; viem's helpers want bigint message fields for their generics. */
function forViem(typed: ReturnType<typeof checkInTypedData>) {
  return {
    domain: typed.domain,
    types: { CheckIn: typed.types.CheckIn },
    primaryType: typed.primaryType,
    message: { eventId: BigInt(typed.message.eventId), attendee: typed.message.attendee, deadline: BigInt(typed.message.deadline) },
  } as const;
}

describe("CheckIn typed data", () => {
  it("matches the exact eth_signTypedData_v4 shape from docs/ABI.md", () => {
    const typed = checkInTypedData(11155111, CONTRACT, {
      eventId: 1n,
      attendee: "0x000000000000000000000000000000000000CAFE",
      deadline: 1800000000n,
    });
    expect(JSON.parse(JSON.stringify(typed))).toEqual({
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
      domain: { name: "EventCheckin", version: "1", chainId: 11155111, verifyingContract: CONTRACT },
      message: { eventId: "1", attendee: "0x000000000000000000000000000000000000CAFE", deadline: "1800000000" },
    });
  });

  it("hashes to keccak256(0x1901 || domainSeparator || structHash) with the contract's CHECKIN_TYPEHASH", () => {
    const message = { eventId: 7n, attendee: "0x000000000000000000000000000000000000cafe" as const, deadline: 1900000000n };
    const typed = checkInTypedData(11155111, CONTRACT, message);
    // Independent computation following the Solidity source.
    const typehash = keccak256(stringToHex("CheckIn(uint256 eventId,address attendee,uint256 deadline)"));
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
        [typehash, message.eventId, message.attendee, message.deadline],
      ),
    );
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
          keccak256(stringToHex("EventCheckin")),
          keccak256(stringToHex("1")),
          11155111n,
          CONTRACT,
        ],
      ),
    );
    const digest = keccak256(concatHex(["0x1901", domainSeparator, structHash]));
    expect(hashTypedData(forViem(typed))).toBe(digest);
    expect(toHex(BigInt(typed.message.eventId))).toBe("0x7");
  });

  it("produces a signature that recovers to the organiser", async () => {
    const organiser = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const typed = checkInTypedData(11155111, CONTRACT, { eventId: 1n, attendee: organiser.address, deadline: 1800000000n });
    const signature = await organiser.signTypedData(forViem(typed));
    expect(await verifyTypedData({ ...forViem(typed), address: organiser.address, signature })).toBe(true);
    const other = forViem(typed);
    expect(
      await verifyTypedData({ ...other, message: { ...other.message, eventId: 2n }, address: organiser.address, signature }),
    ).toBe(false);
  });
});
