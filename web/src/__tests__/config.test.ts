import { describe, expect, it } from "vitest";
import deployment from "../../handoff/deployment.json";
import networkFile from "../../handoff/network.json";
import { parseManifest } from "../lib/config";

const valid = {
  version: 1,
  launchId: deployment.launchId,
  chainId: deployment.chainId,
  sourceCommit: deployment.sourceCommit,
  attestationHash: deployment.attestationHash,
  contracts: deployment.contracts.map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` })),
  assets: [{ path: "index.html", sha256: "00" }],
  network: networkFile.network,
};

describe("parseManifest", () => {
  it("accepts the handoff-shaped manifest", () => {
    const m = parseManifest(valid);
    expect(m.contracts.map((c) => c.name)).toEqual(["LaunchToken", "EventCheckin"]);
    expect(m.network?.rpcUrls.length).toBe(3);
  });

  it("rejects ABI paths that are URLs or traverse upwards", () => {
    expect(() => parseManifest({ ...valid, contracts: [{ ...valid.contracts[0], abiPath: "https://x/abi.json" }] })).toThrow("relative");
    expect(() => parseManifest({ ...valid, contracts: [{ ...valid.contracts[0], abiPath: "../abi.json" }] })).toThrow("relative");
  });

  it("rejects a wrong version, missing contracts and a chain mismatch", () => {
    expect(() => parseManifest({ ...valid, version: 2 })).toThrow("version");
    expect(() => parseManifest({ ...valid, contracts: [] })).toThrow("contracts");
    expect(() => parseManifest({ ...valid, network: { ...valid.network, chainId: 1 } })).toThrow("chain id");
  });
});
