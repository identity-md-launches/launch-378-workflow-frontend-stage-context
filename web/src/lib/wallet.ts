/**
 * Browser wallet access over EIP-1193 (window.ethereum and EIP-6963 announced providers).
 * No WalletConnect project id is configured; see README for the optional setup.
 */
import { getAddress, type Address } from "viem";
import { walletAddChainParams, type NetworkBlock } from "./config";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface DiscoveredWallet {
  name: string;
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<{ info: { name: string; uuid: string }; provider: Eip1193Provider }>;
  }
}

/** Discover wallets: EIP-6963 announcements first, then the legacy window.ethereum. */
export function discoverWallets(timeoutMs = 300): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (event: WindowEventMap["eip6963:announceProvider"]) => {
      const { info, provider } = event.detail;
      if (!found.has(info.uuid)) found.set(info.uuid, { name: info.name, provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const wallets = [...found.values()];
      if (wallets.length === 0 && window.ethereum) wallets.push({ name: "Browser wallet", provider: window.ethereum });
      resolve(wallets);
    }, timeoutMs);
  });
}

export interface ProviderRpcError extends Error {
  code?: number;
  data?: unknown;
}

export function isUserRejection(error: unknown): boolean {
  const e = error as ProviderRpcError & { cause?: ProviderRpcError };
  return e?.code === 4001 || e?.cause?.code === 4001 || /user rejected|user denied/i.test(String(e?.message ?? ""));
}

export async function requestAccounts(provider: Eip1193Provider): Promise<Address[]> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  return accounts.map((a) => getAddress(a));
}

export async function currentChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

function isUnknownChainError(error: unknown): boolean {
  const e = error as ProviderRpcError & { data?: { originalError?: { code?: number } }; cause?: ProviderRpcError };
  const code = e?.code ?? e?.data?.originalError?.code ?? e?.cause?.code;
  if (code === 4902) return true;
  return /unrecognized chain|unknown chain|not been added|does not exist|4902/i.test(String(e?.message ?? ""));
}

/**
 * Ask the wallet to switch to the configured chain. If the wallet does not know the
 * chain (code 4902 or an equivalent message) offer wallet_addEthereumChain and switch again.
 */
export async function switchToNetwork(provider: Eip1193Provider, network: NetworkBlock): Promise<void> {
  const chainId = `0x${network.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    return;
  } catch (error) {
    if (isUserRejection(error) || !isUnknownChainError(error)) throw error;
  }
  await provider.request({ method: "wallet_addEthereumChain", params: [walletAddChainParams(network)] });
  const now = await currentChainId(provider);
  if (now !== network.chainId) {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
}

/** Sign typed data with the exact payload; the JSON string is what the wallet receives. */
export async function signTypedDataV4(provider: Eip1193Provider, account: Address, typedData: object): Promise<`0x${string}`> {
  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [account, JSON.stringify(typedData)],
  });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error("The wallet returned an unexpected signature format.");
  }
  return signature as `0x${string}`;
}
