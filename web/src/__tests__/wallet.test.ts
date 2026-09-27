import { describe, expect, it, vi } from "vitest";
import networkFile from "../../handoff/network.json";
import { walletAddChainParams, type NetworkBlock } from "../lib/config";
import { switchToNetwork, type Eip1193Provider } from "../lib/wallet";

const network = networkFile.network as NetworkBlock;

function provider(handler: (method: string, params: unknown) => Promise<unknown>): Eip1193Provider & { calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  return {
    calls,
    request: async ({ method, params }) => {
      calls.push([method, params]);
      return handler(method, params);
    },
  };
}

describe("wallet_addEthereumChain parameters", () => {
  it("are derived from the network block and equal the handoff's walletAddChain block", () => {
    expect(walletAddChainParams(network)).toEqual(networkFile.walletAddChain);
  });
});

describe("switchToNetwork", () => {
  it("switches directly when the wallet knows the chain", async () => {
    const p = provider(async () => null);
    await switchToNetwork(p, network);
    expect(p.calls).toEqual([["wallet_switchEthereumChain", [{ chainId: "0xaa36a7" }]]]);
  });

  it("offers wallet_addEthereumChain after a 4902 failure, then switches again", async () => {
    let added = false;
    const p = provider(async (method) => {
      if (method === "wallet_switchEthereumChain" && !added) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      if (method === "wallet_addEthereumChain") {
        added = true;
        return null;
      }
      if (method === "eth_chainId") return "0x1";
      return null;
    });
    await switchToNetwork(p, network);
    expect(p.calls.map(([m]) => m)).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId", "wallet_switchEthereumChain"]);
    expect(p.calls[1]![1]).toEqual([networkFile.walletAddChain]);
  });

  it("does not add the chain when the user rejected the switch", async () => {
    const p = provider(async (method) => {
      if (method === "wallet_switchEthereumChain") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      return null;
    });
    await expect(switchToNetwork(p, network)).rejects.toThrow("User rejected");
    expect(p.calls.map(([m]) => m)).toEqual(["wallet_switchEthereumChain"]);
  });

  it("treats an unknown-chain message without a code as 4902", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "wallet_switchEthereumChain" && request.mock.calls.length === 1) throw new Error("Chain 0xaa36a7 has not been added");
      if (method === "eth_chainId") return "0xaa36a7";
      return null;
    });
    await switchToNetwork({ request }, network);
    expect(request.mock.calls.map(([a]) => a.method)).toEqual(["wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_chainId"]);
  });
});
