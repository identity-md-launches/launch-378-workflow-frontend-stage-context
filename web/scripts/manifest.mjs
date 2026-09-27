#!/usr/bin/env node
/**
 * Writes dist/imd-deployment.json after `vite build`.
 *
 * - Copies each implementation-derived ABI (web/public/abi, a verified copy of docs/abi at the
 *   pinned source commit) is already in dist/abi via Vite's public dir; this script verifies the
 *   canonical keccak256 of each ABI against the handoff's abiHash and fails on any mismatch.
 * - Copies launchId, chainId, sourceCommit, attestationHash and the exact contract set from
 *   web/handoff/deployment.json (a byte-for-byte copy of .imd/reads/deployment.json).
 * - Copies the `network` block from web/handoff/network.json unchanged.
 * - Enumerates every file under dist/ except imd-deployment.json and records its SHA-256.
 *
 * `--check` verifies an existing manifest instead of writing it.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, stringToHex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const dist = resolve(repoRoot, "dist");
const check = process.argv.includes("--check");

const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const EXPORT_BUDGET_BYTES = 24 * 1024 * 1024; // well under half of the checker's 64 MiB budget

function fail(message) {
  console.error(`manifest: ${message}`);
  process.exit(1);
}

/** Canonical JSON: compact separators, object keys sorted recursively (matches the handoff's abiHash). */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!existsSync(dist) || !existsSync(join(dist, "index.html"))) fail("dist/index.html is missing; run the build first.");

const deployment = JSON.parse(readFileSync(join(webRoot, "handoff", "deployment.json"), "utf8"));
const networkFile = JSON.parse(readFileSync(join(webRoot, "handoff", "network.json"), "utf8"));
if (!networkFile.network) fail("handoff/network.json has no network block.");
if (networkFile.network.chainId !== deployment.chainId) fail("network chainId differs from deployment chainId.");

// Verify every ABI in the export against the handoff hash and the pinned source export.
const contracts = deployment.contracts.map((c) => {
  const abiPath = `abi/${c.name}.json`;
  const distAbi = join(dist, abiPath);
  if (!existsSync(distAbi)) fail(`${abiPath} is missing from dist/.`);
  const raw = readFileSync(distAbi, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) fail(`${abiPath} is not a raw JSON array.`);
  const hash = keccak256(stringToHex(canonicalJson(parsed))).slice(2);
  if (hash !== c.abiHash) fail(`${abiPath} canonical keccak ${hash} does not match handoff abiHash ${c.abiHash}.`);
  const source = join(repoRoot, "docs", "abi", `${c.name}.json`);
  if (existsSync(source) && readFileSync(source, "utf8") !== raw) fail(`${abiPath} differs from docs/abi/${c.name}.json.`);
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath };
});

const assets = walk(dist)
  .map((full) => relative(dist, full).split("\\").join("/"))
  .filter((path) => path !== "imd-deployment.json")
  .sort()
  .map((path) => {
    const buffer = readFileSync(join(dist, path));
    if (buffer.length > MAX_FILE_BYTES) fail(`${path} exceeds 8 MiB.`);
    return { path, sha256: sha256(buffer), bytes: buffer.length };
  });

if (assets.length > MAX_ASSETS) fail(`${assets.length} assets exceed the limit of ${MAX_ASSETS}.`);
if (!assets.some((a) => a.path === "index.html")) fail("index.html is not in the asset list.");
const total = assets.reduce((n, a) => n + a.bytes, 0);
if (total > EXPORT_BUDGET_BYTES) fail(`export is ${total} bytes, above the ${EXPORT_BUDGET_BYTES} byte budget.`);

const manifest = {
  version: 1,
  launchId: deployment.launchId,
  chainId: deployment.chainId,
  sourceCommit: deployment.sourceCommit,
  attestationHash: deployment.attestationHash,
  contracts,
  assets: assets.map(({ path, sha256 }) => ({ path, sha256 })),
  network: networkFile.network,
};

const text = `${JSON.stringify(manifest, null, 2)}\n`;
const target = join(dist, "imd-deployment.json");

if (check) {
  if (!existsSync(target)) fail("dist/imd-deployment.json is missing.");
  const current = readFileSync(target, "utf8");
  if (current !== text) fail("dist/imd-deployment.json is stale; rerun `npm run manifest`.");
  console.log(`manifest: dist/imd-deployment.json is current (${assets.length} assets, ${total} bytes).`);
} else {
  writeFileSync(target, text);
  // Sanity: the network block must round-trip identically to the handoff file's block.
  const written = JSON.parse(readFileSync(target, "utf8"));
  if (JSON.stringify(written.network) !== JSON.stringify(networkFile.network)) fail("network block changed while writing.");
  console.log(`manifest: wrote dist/imd-deployment.json (${assets.length} assets, ${total} bytes).`);
  for (const a of assets) console.log(`  ${a.sha256}  ${a.path} (${a.bytes} B)`);
}
