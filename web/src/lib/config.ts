/**
 * Runtime deployment configuration.
 *
 * The only source of contract addresses, chain id, ABIs and public RPC settings is
 * `imd-deployment.json`, which sits next to `index.html` in the static export and is
 * generated from the workflow handoff by `scripts/manifest.mjs`. The app fetches it at
 * start-up and then fetches each ABI JSON it references. Nothing else in the source
 * holds an address or RPC URL.
 */
import type { Abi, Address, Hex } from "viem";
import { getAddress, isAddress } from "viem";

export interface ManifestContract {
  name: string;
  address: string;
  abiHash: string;
  abiPath: string;
}

export interface ManifestAsset {
  path: string;
  sha256: string;
}

export interface UniswapV4Addresses {
  poolManager: string;
  universalRouter: string;
  quoter: string;
  stateView: string;
  positionManager: string;
  permit2: string;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets?: string[];
  uniswapV4?: UniswapV4Addresses;
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: ManifestAsset[];
  network?: NetworkBlock;
}

export interface Deployment {
  manifest: DeploymentManifest;
  network: NetworkBlock;
  chainId: number;
  /** Address of EventCheckin from the handoff. */
  checkin: Address;
  /** Address of LaunchToken (CHKN) from the handoff. The app cross-checks it with EventCheckin.token(). */
  token: Address;
  checkinAbi: Abi;
  tokenAbi: Abi;
  /** First block to scan for logs: the deployment block from the handoff (build-time constant). */
  deploymentBlock: bigint;
  explorer: string;
}

export const CONTRACT_NAMES = { checkin: "EventCheckin", token: "LaunchToken" } as const;

export class DeploymentError extends Error {}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DeploymentError(`Deployment configuration is missing "${field}".`);
  }
  return value;
}

function safeRelativePath(path: string): string {
  if (/^[a-z]+:/i.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
    throw new DeploymentError(`ABI path "${path}" must be relative to the export.`);
  }
  return path;
}

export function parseManifest(raw: unknown): DeploymentManifest {
  if (!raw || typeof raw !== "object") throw new DeploymentError("Deployment configuration is not an object.");
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) throw new DeploymentError("Deployment configuration version is not 1.");
  if (typeof m.chainId !== "number") throw new DeploymentError('Deployment configuration is missing "chainId".');
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) {
    throw new DeploymentError('Deployment configuration is missing "contracts".');
  }
  const contracts = m.contracts.map((c: Record<string, unknown>) => {
    const address = assertString(c.address, "contracts[].address");
    if (!isAddress(address, { strict: false })) throw new DeploymentError(`Invalid address for ${String(c.name)}.`);
    return {
      name: assertString(c.name, "contracts[].name"),
      address,
      abiHash: assertString(c.abiHash, "contracts[].abiHash"),
      abiPath: safeRelativePath(assertString(c.abiPath, "contracts[].abiPath")),
    };
  });
  const network = m.network as NetworkBlock | undefined;
  if (network) {
    if (typeof network.chainId !== "number" || !Array.isArray(network.rpcUrls) || network.rpcUrls.length === 0) {
      throw new DeploymentError('The "network" block needs a chainId and at least one RPC URL.');
    }
    if (network.chainId !== m.chainId) throw new DeploymentError("Network block chain id differs from chainId.");
  }
  return {
    version: 1,
    launchId: assertString(m.launchId, "launchId"),
    chainId: m.chainId,
    sourceCommit: assertString(m.sourceCommit, "sourceCommit"),
    attestationHash: assertString(m.attestationHash, "attestationHash"),
    contracts,
    assets: Array.isArray(m.assets) ? (m.assets as ManifestAsset[]) : [],
    network,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new DeploymentError(`Unable to load ${url} (HTTP ${res.status}).`);
  return res.json();
}

/** Resolve a path relative to the page (works from an IPFS gateway subpath or an ENS name). */
export function assetUrl(relative: string): string {
  return new URL(relative, document.baseURI).toString();
}

export async function loadDeployment(): Promise<Deployment> {
  const manifest = parseManifest(await fetchJson(assetUrl("imd-deployment.json")));
  if (manifest.launchId !== __IMD_LAUNCH_ID__) {
    throw new DeploymentError("The deployment configuration does not belong to this build of the page.");
  }
  if (!manifest.network) {
    throw new DeploymentError("The deployment configuration has no network block, so no public RPC is configured.");
  }
  const find = (name: string) => {
    const c = manifest.contracts.find((x) => x.name === name);
    if (!c) throw new DeploymentError(`Deployment configuration has no "${name}" contract.`);
    return c;
  };
  const checkin = find(CONTRACT_NAMES.checkin);
  const token = find(CONTRACT_NAMES.token);
  const [checkinAbi, tokenAbi] = await Promise.all([
    fetchJson(assetUrl(checkin.abiPath)),
    fetchJson(assetUrl(token.abiPath)),
  ]);
  if (!Array.isArray(checkinAbi) || !Array.isArray(tokenAbi)) throw new DeploymentError("An ABI file is not a JSON array.");
  return {
    manifest,
    network: manifest.network,
    chainId: manifest.chainId,
    checkin: getAddress(checkin.address),
    token: getAddress(token.address),
    checkinAbi: checkinAbi as Abi,
    tokenAbi: tokenAbi as Abi,
    deploymentBlock: BigInt(__IMD_DEPLOYMENT_BLOCK__),
    explorer: manifest.network.explorer.replace(/\/$/, ""),
  };
}

export function explorerAddress(deployment: Pick<Deployment, "explorer">, address: string): string {
  return `${deployment.explorer}/address/${address}`;
}

export function explorerTx(deployment: Pick<Deployment, "explorer">, hash: Hex): string {
  return `${deployment.explorer}/tx/${hash}`;
}

/** Parameters for wallet_addEthereumChain, derived from the network block so there is one source. */
export function walletAddChainParams(network: NetworkBlock) {
  return {
    chainId: `0x${network.chainId.toString(16)}`,
    chainName: network.name,
    rpcUrls: network.rpcUrls,
    nativeCurrency: network.nativeCurrency,
    blockExplorerUrls: [network.explorer],
  };
}
