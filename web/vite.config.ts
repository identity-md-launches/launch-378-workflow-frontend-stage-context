import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const deployment = JSON.parse(readFileSync(here("./handoff/deployment.json"), "utf8"));
const network = JSON.parse(readFileSync(here("./handoff/network.json"), "utf8"));

const deploymentBlock = Math.min(
  ...deployment.contracts.map((c: { blockNumber: number }) => c.blockNumber),
);

/**
 * During `vite dev` there is no built export, so serve a manifest with the same shape
 * as dist/imd-deployment.json (minus asset hashes) generated from the handoff copies.
 * The production manifest is written by scripts/manifest.mjs after `vite build`.
 */
function devDeploymentManifest(): Plugin {
  return {
    name: "imd-dev-deployment-manifest",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.split("?")[0]!.endsWith("/imd-deployment.json")) return next();
        const manifest = {
          version: 1,
          launchId: deployment.launchId,
          chainId: deployment.chainId,
          sourceCommit: deployment.sourceCommit,
          attestationHash: deployment.attestationHash,
          contracts: deployment.contracts.map((c: { name: string; address: string; abiHash: string }) => ({
            name: c.name,
            address: c.address,
            abiHash: c.abiHash,
            abiPath: `abi/${c.name}.json`,
          })),
          assets: [],
          network: network.network,
        };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(manifest, null, 2));
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), devDeploymentManifest()],
  define: {
    __IMD_DEPLOYMENT_BLOCK__: JSON.stringify(deploymentBlock),
    __IMD_LAUNCH_ID__: JSON.stringify(deployment.launchId),
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    // One main chunk is intended for content-addressed static hosting; the export is ~0.6 MB.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
