/**
 * A minimal JSON-RPC mock for the app's reads: decodes eth_call against the real ABIs and
 * answers from an in-memory model. Used by the React integration test instead of a live chain.
 */
import { decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeFunctionResult, type Abi, type Hex } from "viem";
import checkinAbi from "../../public/abi/EventCheckin.json";
import tokenAbi from "../../public/abi/LaunchToken.json";
import deployment from "../../handoff/deployment.json";
import networkFile from "../../handoff/network.json";

export const CHECKIN = deployment.contracts.find((c) => c.name === "EventCheckin")!.address;
export const TOKEN = deployment.contracts.find((c) => c.name === "LaunchToken")!.address;

export interface Model {
  events: { organiser: string; title: Hex; endsAt: bigint; closed: boolean; reward: bigint; pool: bigint; attendees: bigint }[];
  balances: Record<string, bigint>;
  allowances: Record<string, bigint>;
  withdrawable: Record<string, bigint>;
  attended: Set<string>;
  /** Error name returned by checkIn simulation, or null for success. */
  checkInError: string | null;
  head: bigint;
}

export function makeModel(partial: Partial<Model> = {}): Model {
  return {
    events: [],
    balances: {},
    allowances: {},
    withdrawable: {},
    attended: new Set(),
    checkInError: null,
    head: BigInt(deployment.contracts[0]!.blockNumber) + 10n,
    ...partial,
  };
}

export function manifestFor(assets: { path: string; sha256: string }[] = []) {
  return {
    version: 1,
    launchId: deployment.launchId,
    chainId: deployment.chainId,
    sourceCommit: deployment.sourceCommit,
    attestationHash: deployment.attestationHash,
    contracts: deployment.contracts.map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` })),
    assets,
    network: networkFile.network,
  };
}

const RPC_HOSTS = networkFile.network.rpcUrls;

class RpcError extends Error {
  constructor(
    message: string,
    public code: number,
    public data?: Hex,
  ) {
    super(message);
  }
}

function lower(s: string) {
  return s.toLowerCase();
}

export function handleRpc(model: Model, method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return `0x${deployment.chainId.toString(16)}`;
    case "eth_blockNumber":
      return `0x${model.head.toString(16)}`;
    case "eth_getCode":
      return "0x6080";
    case "eth_getLogs":
      return [];
    case "eth_estimateGas":
      return "0x5208";
    case "eth_call": {
      const { to, data } = params[0] as { to: string; data: Hex };
      if (lower(to) === lower(TOKEN)) {
        const { functionName, args } = decodeFunctionData({ abi: tokenAbi as Abi, data });
        const a = args as readonly string[];
        if (functionName === "balanceOf") return encodeFunctionResult({ abi: tokenAbi as Abi, functionName, result: model.balances[lower(a[0]!)] ?? 0n });
        if (functionName === "allowance") return encodeFunctionResult({ abi: tokenAbi as Abi, functionName, result: model.allowances[lower(a[0]!)] ?? 0n });
        throw new RpcError(`unhandled token call ${functionName}`, -32000);
      }
      if (lower(to) === lower(CHECKIN)) {
        const { functionName, args } = decodeFunctionData({ abi: checkinAbi as Abi, data });
        const abi = checkinAbi as Abi;
        switch (functionName) {
          case "token":
            return encodeFunctionResult({ abi, functionName, result: TOKEN });
          case "eventCount":
            return encodeFunctionResult({ abi, functionName, result: BigInt(model.events.length) });
          case "eventInfo": {
            const id = Number((args as readonly bigint[])[0]);
            const e = model.events[id - 1];
            if (!e) throw new RpcError("execution reverted", 3, encodeErrorResult({ abi, errorName: "UnknownEvent" }));
            return encodeAbiParameters(
              [{ type: "address" }, { type: "bytes32" }, { type: "uint64" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
              [e.organiser as Hex, e.title, e.endsAt, e.closed, e.reward, e.pool, e.attendees],
            );
          }
          case "withdrawable":
            return encodeFunctionResult({ abi, functionName, result: model.withdrawable[lower((args as readonly string[])[0]!)] ?? 0n });
          case "attended": {
            const [id, who] = args as readonly [bigint, string];
            return encodeFunctionResult({ abi, functionName, result: model.attended.has(`${id}:${lower(who)}`) });
          }
          case "checkIn":
            if (model.checkInError) throw new RpcError("execution reverted", 3, encodeErrorResult({ abi, errorName: model.checkInError }));
            return "0x";
          default:
            throw new RpcError(`unhandled checkin call ${functionName}`, -32000);
        }
      }
      throw new RpcError(`unknown contract ${to}`, -32000);
    }
    default:
      throw new RpcError(`unhandled method ${method}`, -32601);
  }
}

/** Install a fetch stub serving the manifest, ABIs and JSON-RPC from the model. */
export function installFetch(model: Model) {
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/imd-deployment.json")) return Response.json(manifestFor());
    if (url.endsWith("/abi/EventCheckin.json")) return Response.json(checkinAbi);
    if (url.endsWith("/abi/LaunchToken.json")) return Response.json(tokenAbi);
    if (RPC_HOSTS.some((h) => url.startsWith(h))) {
      const body = JSON.parse(String(init?.body));
      const requests = Array.isArray(body) ? body : [body];
      const responses = requests.map((r: { id: number; method: string; params: unknown[] }) => {
        try {
          return { jsonrpc: "2.0", id: r.id, result: handleRpc(model, r.method, r.params ?? []) };
        } catch (e) {
          const err = e as RpcError;
          return { jsonrpc: "2.0", id: r.id, error: { code: err.code ?? -32000, message: err.message, data: err.data } };
        }
      });
      return Response.json(Array.isArray(body) ? responses : responses[0]);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  globalThis.fetch = fetchImpl as typeof fetch;
}

/** A mock EIP-1193 wallet whose chain can start wrong and be switched/added. */
export function mockWallet(account: string, startChainId: number, opts: { knowsChain?: boolean } = {}) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let chainId = startChainId;
  let knows = opts.knowsChain ?? false;
  const calls: { method: string; params?: unknown }[] = [];
  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((l) => l(...args));
  const provider = {
    calls,
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      calls.push({ method, params });
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account];
        case "eth_chainId":
          return `0x${chainId.toString(16)}`;
        case "wallet_switchEthereumChain": {
          const target = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16);
          if (!knows && target !== startChainId) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
          chainId = target;
          emit("chainChanged", `0x${chainId.toString(16)}`);
          return null;
        }
        case "wallet_addEthereumChain":
          knows = true;
          chainId = Number.parseInt((params as [{ chainId: string }])[0].chainId, 16);
          emit("chainChanged", `0x${chainId.toString(16)}`);
          return null;
        default:
          throw new Error(`mock wallet: unhandled ${method}`);
      }
    },
    on: (event: string, l: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(l);
    },
    removeListener: (event: string, l: (...args: unknown[]) => void) => listeners.get(event)?.delete(l),
  };
  return provider;
}
