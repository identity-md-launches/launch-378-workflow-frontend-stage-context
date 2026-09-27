# Frontend validation record: Event Checkin website

Worker-side validation of the `lab-event-checkin` static export. This is the worker's report, not an independent network certification.

## 1. Scope and assumptions

- **Pages and flows reviewed:** the single page (`dist/index.html`) with its organiser view (create, approve + fund, close, reclaim, sign pass), attendee view (open/paste pass, submit check-in, withdraw), CHKN panel (balance, allowance, withdrawable credit, withdraw) and the all-events list with per-event attendee lists from `CheckedIn` logs.
- **Build and export:** source in `web/`, export in `dist/` (6 assets, 589,126 bytes; the manifest `dist/imd-deployment.json` is additional), base `./`, hash routing only (`#organiser`, `#attendee`, `#pass?…`).
- **Deployment inputs:** `.imd/reads/deployment.json` and `.imd/reads/network.json` copied verbatim to `web/handoff/`; `docs/abi/*.json` copied verbatim to `web/public/abi/`. Canonical keccak256 (compact JSON, keys sorted) of both ABIs equals the handoff `abiHash` values (`38880b8e…37bee` for LaunchToken, `8e5c9a57…599a4` for EventCheckin), verified by `scripts/manifest.mjs` on every build. HEAD `4b6f1d84…` equals the handoff `sourceCommit`.
- **Live chain facts checked before building** (public RPCs, 2026-09-27): chain id `0xaa36a7`; both addresses return nonempty code; `EventCheckin.token()` returns the LaunchToken address; the live EventCheckin runtime bytecode equals the pinned compiler output byte for byte outside the eight immutable slots (cached domain separator, chain id 11155111, contract address, name/version hashes, the `EventCheckin`/`1` short strings and the token address); LaunchToken runtime code is identical to the compiled output.
- **Inferred design choices:** light theme only, system font stack (no font files), two ARIA tabs for the two views, one filled primary action per form, inline confirmation for the irreversible close. The requested "one small page" is kept: no routes, no dialogs.
- **Exclusions:** no in-page swap (approved design says CHKN comes from the launch pool; the page says so and links the PoolManager from the network block). ERC-1271 organisers are supported on-chain only; the page signs with the connected EOA (approved design).
- **Scope note:** `DESIGN.md` is at `web/DESIGN.md` because the repository root is outside this assignment's write scope (`web/**`, `dist/**`, `docs/**`).

## 2. Better Interface coverage

| Domain | Status | Inspected states and evidence | Not performed |
| --- | --- | --- | --- |
| Accessibility | Checked | Source: every input has a `<label for>`, errors use `aria-invalid` + `aria-describedby` and focus the first invalid field, live region `role="status"` rendered from the start, `role="alert"` only for error notices, tabs follow the APG pattern (roving tabindex, arrow/Home/End), skip link first in DOM, one `<main>`, native `<button>`/`<a>`/`<details>` only, decorative icons `aria-hidden`. Browser (e2e): first Tab stop is the skip link; `:focus-visible` ring 2px solid measured 6.87:1–7.24:1 against page/card (ring sits 2px outside controls, screenshot 02); all non-inline targets ≥ 24px at 320px and 768px; reduced-motion disables the spinner animation; no console errors. | Screen-reader session; automated accessibility audit tool (none installed); forced-colors rendering (source rule only); native 200% zoom (320px reflow used instead). |
| Layout | Checked | Source: logical properties (`padding-inline`, `inset-inline-start`, `margin-inline`), gaps 16px within forms and 24px between cards, `env(safe-area-inset-*)`, no fixed heights on text containers, wrapping `.row`/`.form-grid` with `auto-fit`. Browser: no horizontal overflow at 320px and 768px (`scrollWidth == clientWidth`), screenshots 08 and 09; desktop 1280px screenshots 01–07. | RTL mirror (no localisation in scope); widths other than 320/768/1280. |
| Writing | Checked | Source review: verb-first buttons ("Connect wallet", "Create event", "1. Approve", "2. Fund event", "Sign pass", "Submit check-in", "Withdraw credit"), sentence case throughout, errors state the fix beside the field ("Choose an end time within 365 days."), revert reasons mapped to plain sentences, empty states point forward ("No events yet… Create one in the Organiser view"), links describe destinations ("EventCheckin on the explorer"), test-toy disclaimer in header and footer. | None beyond source review (the domain needs no browser). |
| Typography | Checked | Source: system stack, six-step rem scale, headings `text-wrap: balance` and line-height 1.15, body 1.5, `text-wrap: pretty` on paragraphs, measure capped at 68ch, `tabular-nums` on changing values, `overflow-wrap: anywhere` on addresses/hashes, inputs 16px (no iOS zoom), underline metrics `from-font`. Browser: long addresses and the pass link wrap inside their boxes at 320px (screenshot 08). | Font-loading checks (no web fonts by design). |
| Colors | Checked | Tokens: one neutral ramp, one indigo accent ramp, three status ramps that render (success, error, warning), semantic tokens only in components. Browser measurement of 24 rendered pairs, all ≥ 5.14:1 for text and ≥ 6.87:1 for the focus ring (table in §4). | Dark theme (not implemented, deliberately); P3 gamut check (all values sRGB-safe by construction, not measured). |
| UI | Checked | Source: concentric radii (card 16px, controls 10px, inputs 6px), shadow for card elevation and borders only for structure, transitions name exact properties, `scale(0.96)` press feedback under `prefers-reduced-motion: no-preference`, spinner kept as feedback with animation disabled under reduced motion, every async state has a static text cue. Browser: hover/active/disabled/loading states walked in the e2e flow; loading and confirmed notices visible in screenshots 04–07. | Animations-panel replay at 10% speed. |

## 3. Findings and fixes

| Sev | Location | Evidence | Change | Recheck |
| --- | --- | --- | --- | --- |
| HIGH | `web/src/styles.css` `.stack` (display: flex) vs `hidden` on the tab panels in `web/src/App.tsx` | Screenshots from the first e2e run showed both tab panels rendered at once under either tab (class display overrode the UA `[hidden]` rule); tabs were meaningless and the page doubled in length. | Added `[hidden] { display: none !important; }`. | e2e "only the selected tab panel is visible" passes; screenshots 05/06/09 show one panel. |
| MEDIUM | `web/index.html` | First e2e run recorded a failed resource load: `/favicon.ico` 404 on the static host. | Inline SVG data-URI icon. | "no failed resource loads" passes. |
| LOW | `web/src/components/ui.tsx` `TxStatus` | Approve and Fund both showed the same "Transaction confirmed." notice stacked in one form (screenshot from the first run), so the two steps were not distinguishable after the fact. | `TxStatus` takes a `done` label; each action names its outcome ("Approval confirmed…", "Event funded.", "Event closed.", …). | Screenshot 07; e2e waits on the specific texts. |
| LOW | `web/src/styles.css` table/badge links | Links that stand alone in a table cell or badge measured 15–17px tall. | `td > a, .badge > a` get 4px block padding with negative margin (24px hit area, unchanged row height). | Target-size check passes at 320px and 768px. |
| Note | Footer links (`web/src/App.tsx`) | Inline links inside sentences and list items are 17px tall; they fall under the WCAG 2.5.8 inline exception and were left as text links. | None. | Recorded, not counted as a failure. |
| Note | First e2e attempt (script, not app) | `createEvent` reverted with `InvalidEndTime` on a fresh anvil: anvil's `eth_call` at the genesis block reports a wrong timestamp. | Test script mines a block first; later switched to a Sepolia fork. | Reproduced with `cast call`, not an app defect. |

No unresolved HIGH or MEDIUM findings remain.

## 4. Verification

### Commands and outcomes (worker, 2026-09-27)

| Command (in `web/`) | Outcome |
| --- | --- |
| `npm install` (vite 7.3.6, react 19.3.0, viem 2.56.9, typescript 5.9.3, vitest 3.2.7, jsdom, testing-library) | OK, lockfile committed, `node_modules` ignored |
| `npm run typecheck` (`tsc -p tsconfig.json --noEmit`, strict, tests included) | Exit 0, no errors |
| `npm run build` (`tsc && vite build && node scripts/manifest.mjs`) | Exit 0. `dist/index.html` 0.67 kB, `assets/index-*.css` 10.9 kB, `assets/index-*.js` 557 kB (172 kB gzip), `assets/ccip-*.js` 2.9 kB, `abi/EventCheckin.json` 11.3 kB, `abi/LaunchToken.json` 5.7 kB. Manifest written with 6 assets; ABI hashes verified against the handoff. |
| `npm run manifest:check` | "dist/imd-deployment.json is current" |
| `npm test` (vitest, jsdom) | 7 files, 30 tests passed, 0 failed |
| `node ../test/scratch/e2e/run.mjs` (anvil fork + Playwright Chromium) | 64/64 checks passed |

### Unit and integration tests (`web/src/__tests__/`)

- `typedData.test.ts`: the `eth_signTypedData_v4` payload equals the exact shape in `docs/ABI.md`; its hash equals an independently computed `keccak256(0x1901 ‖ domainSeparator ‖ structHash)` using the contract's `CHECKIN_TYPEHASH` string; a signature recovers to the organiser and fails for a changed event id.
- `pass.test.ts`: JSON and link round trips, malformed input messages.
- `checkin.test.ts`: bytes32 title encode/decode, CHKN formatting/parsing, inclusive end time, decoding a simulated `InvalidSignature` revert through viem into the plain sentence, wallet rejection text.
- `wallet.test.ts`: derived `wallet_addEthereumChain` parameters equal the handoff's `walletAddChain` block byte for byte (deep equal); switch → 4902 → add → switch; rejection does not add; unknown-chain message without a code is treated as 4902.
- `logs.test.ts`: 5,000-block chunking from the deployment block; overlap rescan drops a reorganised log and deduplicates by tx hash + log index.
- `config.test.ts`: manifest validation (version, contracts, URL/`..` ABI paths, chain mismatch).
- `app.test.tsx` (React, mocked JSON-RPC decoding real ABIs, mock EIP-1193 wallet): disconnected reads with explorer links; "no wallet installed" message; wrong-chain state → switch → add-chain → controls enabled and live balance/allowance/credit shown; Approve vs Fund live-step logic; create-form validation focusing the first error; pass link opens the attendee view and shows the revert reason; already-recorded and unknown-event states; pasted pass ready state with reward preview.

### End-to-end run (`test/scratch/e2e/run.mjs`, deleted before submission; described here)

One foreground command starts `anvil --fork-url <first manifest RPC>` (Sepolia at head 11,791,8xx, chain id 11155111, the real deployed contracts), seeds 1,000 CHKN to anvil account #0 via `anvil_setStorageAt`, serves `dist/` under `/preview/` on a random port, and launches headless Chromium (Playwright 1.64 from the pinned MCP install, viewport 1280×900). Requests to the manifest's public RPC URLs are routed to anvil inside the browser, so the export under test is the committed one. A mock EIP-1193 wallet (EIP-6963 announced) starts on chain 1, returns 4902 on the first switch, records `wallet_addEthereumChain` params, and delegates `eth_signTypedData_v4` and `eth_sendTransaction` to Node-side signing with anvil's dev key.

Checks that passed (64): load from a subpath with relative assets; title; skip link first; focus ring; wrong-chain state disables actions; add-chain params equal the handoff; live balance 1,000 CHKN; Withdraw disabled at zero credit; create event mined; Approve live → allowance 50 → Fund live → pool 50 CHKN; signed payload equals the exact typed data; pass link fields; fresh visitor opens the link in the attendee view with only that panel visible; dry-run accepted with "credits 5 CHKN"; Submit disabled until connected; check-in mined against the real contract (`attended` true, attendee credit 5 CHKN, proving the typed data matches the contract); attendee list from logs shows one row with the actual `CheckedIn.reward`; tampered pass for another attendee shows the `InvalidSignature` sentence; malformed link reports a readable error; close asks for confirmation; reclaim credits 45 CHKN; withdraw moves it (balance 995 CHKN); 24 rendered contrast pairs; no horizontal overflow at 320/768; target sizes; reduced motion; no console errors; no failed resource loads.

Contrast measured in the browser from computed styles (oklch converted to sRGB, WCAG 2.x formula):

| Pair | Foreground | Background | Ratio | Needs |
| --- | --- | --- | --- | --- |
| body text on page | oklch(0.52 0.014 80) | oklch(0.976 0.005 80) | 5.14:1 | 4.5:1 |
| primary text on card | oklch(0.22 0.014 80) | oklch(0.994 0.002 80) | 17.03:1 | 4.5:1 |
| muted / hint text, table header, stat label on card | oklch(0.52 0.014 80) | oklch(0.994 0.002 80) | 5.42:1 | 4.5:1 |
| primary button text | oklch(0.994 0.002 80) | oklch(0.46 0.17 262) | 7.24:1 | 4.5:1 |
| secondary button text, input text, error field text | oklch(0.22 0.014 80) | oklch(0.994 0.002 80) | 17.03:1 | 4.5:1 |
| accent link on card / on page, selected tab | oklch(0.4 0.16 262) | oklch(0.994 0.002 80) / oklch(0.976 0.005 80) | 9.37:1 / 8.89:1 | 4.5:1 |
| unselected tab | oklch(0.52 0.014 80) | oklch(0.976 0.005 80) | 5.14:1 | 4.5:1 |
| success badge / notice | oklch(0.38 0.11 150) | oklch(0.95 0.04 150) | 8.31:1 | 4.5:1 |
| error badge / notice | oklch(0.42 0.17 25) | oklch(0.955 0.03 25) | 7.95:1 | 4.5:1 |
| warning badge / notice | oklch(0.4 0.1 70) | oklch(0.96 0.05 85) | 8.31:1 | 4.5:1 |
| neutral badge | oklch(0.22 0.014 80) | oklch(0.945 0.007 80) | 14.74:1 | 4.5:1 |
| info notice | oklch(0.22 0.014 80) | oklch(0.935 0.04 262) | 14.24:1 | 4.5:1 |
| focus ring on card / on page | oklch(0.46 0.17 262) | oklch(0.994 0.002 80) / oklch(0.976 0.005 80) | 7.24:1 / 6.87:1 | 3:1 |

Badge, notice and error-text pairs were measured on sample elements injected with the real component classes into the live page, because not every state exists at one moment.

### Screenshots (`docs/validation/screenshots/`, from the final export)

`01-desktop-disconnected.png`, `02-focus-ring-connect.png`, `03-wrong-network.png`, `04-organiser-signed-pass.png`, `05-attendee-pass-ready.png`, `06-attendee-after-checkin.png`, `07-organiser-closed-reclaimed-withdrawn.png`, `08-mobile-320.png`, `09-tablet-768.png`.

## 5. Untested and limitations

- **No real Sepolia transaction was broadcast.** Writes were exercised on an anvil fork of Sepolia; the contracts and block numbers are the live ones, the wallet is a mock signing with anvil dev keys. Real wallet extensions (MetaMask, Rabby), their EIP-6963 announcements and their `wallet_addEthereumChain` prompts were not exercised.
- Public RPC behaviour under load, `eth_getLogs` range limits for long histories and rate limiting were not exercised beyond the small live range (deployment block to head). Chunk size is 5,000 blocks; a stricter provider would surface as the visible "Unable to read CheckedIn logs" notice with a Retry control.
- Reorganisation handling is unit-tested with a fake client only.
- Better Interface checks not performed: screen-reader session, automated accessibility audit, native 200% zoom, RTL, forced-colors rendering, physical devices, Animations-panel replay. The MCP browser tool had no managed preview file (`test/scratch/browser/preview.json` was absent), so browser inspection used the bounded Playwright script above, and screenshots were inspected as images.
- Publication checks (CID, named entrypoint, asset hashes, RPC chain id and code) run after submission and are not claimed here.

## 6. Completion

**Complete for the stated scope.** Build, typecheck, unit/integration tests and the browser end-to-end run pass on the final source and export; the manifest was regenerated after the last source change and `npm run manifest:check` confirms it. Remaining limitations are listed in §5.
