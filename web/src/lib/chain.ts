import { createPublicClient, fallback, http, type Chain, type PublicClient } from "viem";
import type { NetworkBlock } from "./config";

/** Build a viem chain from the manifest's network block; nothing is hard-coded. */
export function chainFromNetwork(network: NetworkBlock): Chain {
  return {
    id: network.chainId,
    name: network.name,
    testnet: network.testnet,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: network.explorer } },
  };
}

/** Public read client over the configured public RPC URLs, trying each in order. */
export function createReadClient(network: NetworkBlock): PublicClient {
  const chain = chainFromNetwork(network);
  return createPublicClient({
    chain,
    transport: fallback(
      network.rpcUrls.map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
      { rank: false },
    ),
  });
}
