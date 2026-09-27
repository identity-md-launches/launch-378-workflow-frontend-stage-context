import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { parsePass, passFromHash, passToJson, passToLink, type Pass } from "../lib/pass";

const pass: Pass = {
  eventId: 3n,
  attendee: getAddress("0x000000000000000000000000000000000000cafe"),
  deadline: 1800000000n,
  signature: "0xabcdef",
};

describe("pass encoding", () => {
  it("round-trips through JSON text", () => {
    const text = passToJson(pass);
    expect(JSON.parse(text)).toEqual({ eventId: "3", attendee: pass.attendee, deadline: "1800000000", signature: "0xabcdef" });
    expect(parsePass(text)).toEqual(pass);
  });

  it("round-trips through a hash link and ignores an existing hash", () => {
    const link = passToLink(pass, "https://example.org/ipfs/Qm/#organiser");
    expect(link).toBe(
      `https://example.org/ipfs/Qm/#pass?eventId=3&attendee=${pass.attendee}&deadline=1800000000&signature=0xabcdef`,
    );
    expect(parsePass(link)).toEqual(pass);
    expect(passFromHash(new URL(link).hash)).toEqual(pass);
    expect(passFromHash("#organiser")).toBeNull();
  });

  it("explains what is wrong with bad input", () => {
    expect(() => parsePass("")).toThrow("Paste the pass text or link.");
    expect(() => parsePass("{not json")).toThrow("not valid JSON");
    expect(() => parsePass('{"eventId":"1","attendee":"nope","deadline":"1","signature":"0x00"}')).toThrow("Ethereum address");
    expect(() => parsePass('{"eventId":"0","attendee":"0x000000000000000000000000000000000000cafe","deadline":"1","signature":"0x00"}')).toThrow(
      "Event ids start at 1",
    );
    expect(() => parsePass('{"eventId":"1","attendee":"0x000000000000000000000000000000000000cafe","deadline":"x","signature":"0x00"}')).toThrow(
      'field "deadline"',
    );
    expect(() => parsePass("https://example.org/#organiser")).toThrow("pass link");
  });
});
