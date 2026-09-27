import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, type Address, type PublicClient, type WalletClient } from "viem";
import { chainFromNetwork, createReadClient } from "./lib/chain";
import {
  readAllEvents,
  readContractStatus,
  readWalletState,
  type ContractStatus,
  type EventInfo,
  type WalletState,
} from "./lib/checkin";
import { explorerAddress, loadDeployment, type Deployment } from "./lib/config";
import { attendeesForEvent, newScanState, scanCheckIns, type LogScanState } from "./lib/logs";
import { parsePass, passFromHash, type Pass } from "./lib/pass";
import {
  currentChainId,
  discoverWallets,
  isUserRejection,
  requestAccounts,
  switchToNetwork,
  type DiscoveredWallet,
  type Eip1193Provider,
} from "./lib/wallet";
import { shortAddress } from "./lib/format";
import { AttendeeView } from "./components/AttendeeView";
import { EventsList } from "./components/EventsList";
import { OrganiserView } from "./components/OrganiserView";
import { WalletPanel } from "./components/WalletPanel";
import { Button, Notice, StatusRegion, announce, subscribeAnnouncements } from "./components/ui";

export interface WalletConnection {
  provider: Eip1193Provider;
  name: string;
  account: Address;
  chainId: number;
  walletClient: WalletClient;
}

export type View = "organiser" | "attendee";

const REFRESH_MS = 20_000;

function viewFromHash(hash: string): View {
  const clean = hash.replace(/^#/, "");
  if (clean === "organiser") return "organiser";
  return "attendee" === clean || clean.startsWith("pass?") ? "attendee" : "organiser";
}

export function App() {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contractStatus, setContractStatus] = useState<ContractStatus | null>(null);
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [logState, setLogState] = useState<LogScanState>(newScanState);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [walletState, setWalletState] = useState<WalletState | null>(null);
  const [wallets, setWallets] = useState<DiscoveredWallet[] | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));
  const [incomingPass, setIncomingPass] = useState<Pass | null>(null);
  const [incomingPassError, setIncomingPassError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const logStateRef = useRef(logState);
  logStateRef.current = logState;

  const publicClient: PublicClient | null = useMemo(() => (deployment ? createReadClient(deployment.network) : null), [deployment]);

  useEffect(() => subscribeAnnouncements(setStatus), []);

  // Load runtime deployment configuration and ABIs.
  useEffect(() => {
    loadDeployment().then(setDeployment, (e: Error) => setLoadError(e.message));
  }, []);

  // Hash routing: #organiser, #attendee, #pass?eventId=…
  useEffect(() => {
    const apply = () => {
      const hash = window.location.hash;
      setView(viewFromHash(hash));
      try {
        const pass = passFromHash(hash);
        setIncomingPass(pass);
        setIncomingPassError(null);
      } catch (e) {
        setIncomingPass(null);
        setIncomingPassError((e as Error).message);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const refreshEvents = useCallback(async () => {
    if (!publicClient || !deployment) return;
    try {
      setEvents(await readAllEvents(publicClient, deployment));
      setEventsError(null);
    } catch (e) {
      setEventsError(`Unable to read events from the configured RPCs: ${(e as Error).message}`);
    }
  }, [publicClient, deployment]);

  const refreshLogs = useCallback(async () => {
    if (!publicClient || !deployment) return;
    try {
      const next = await scanCheckIns(publicClient, deployment.checkin, deployment.deploymentBlock, logStateRef.current);
      setLogState(next);
      setLogsError(null);
    } catch (e) {
      setLogsError(`Unable to read CheckedIn logs: ${(e as Error).message}`);
    }
  }, [publicClient, deployment]);

  const refreshWallet = useCallback(async () => {
    if (!publicClient || !deployment || !wallet) {
      setWalletState(null);
      return;
    }
    try {
      setWalletState(await readWalletState(publicClient, deployment, wallet.account));
    } catch (e) {
      setWalletError(`Unable to read wallet balances: ${(e as Error).message}`);
    }
  }, [publicClient, deployment, wallet]);

  const refreshAll = useCallback(() => {
    void refreshEvents();
    void refreshLogs();
    void refreshWallet();
  }, [refreshEvents, refreshLogs, refreshWallet]);

  // Verify deployed code and token linkage, then read state and poll while visible.
  useEffect(() => {
    if (!publicClient || !deployment) return;
    let cancelled = false;
    readContractStatus(publicClient, deployment).then(
      (s) => !cancelled && setContractStatus(s),
      (e: Error) => !cancelled && setEventsError(`Unable to reach the configured RPCs: ${e.message}`),
    );
    return () => {
      cancelled = true;
    };
  }, [publicClient, deployment]);

  useEffect(() => {
    if (!contractStatus?.checkinHasCode) return;
    refreshAll();
    const tick = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    const id = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [contractStatus, refreshAll]);

  // Wallet events.
  useEffect(() => {
    if (!wallet?.provider.on) return;
    const provider = wallet.provider;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts || accounts.length === 0) {
        setWallet(null);
        announce("Wallet disconnected.");
      } else {
        setWallet((w) => (w ? { ...w, account: accounts[0] as Address } : w));
      }
    };
    const onChain = (...args: unknown[]) => {
      const id = Number.parseInt(String(args[0]), 16);
      setWallet((w) => (w ? { ...w, chainId: id } : w));
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [wallet?.provider]);

  const connectWith = useCallback(
    async (w: DiscoveredWallet) => {
      if (!deployment) return;
      setConnecting(true);
      setWalletError(null);
      try {
        const [account] = await requestAccounts(w.provider);
        if (!account) throw new Error("The wallet returned no account.");
        const chainId = await currentChainId(w.provider);
        const walletClient = createWalletClient({
          account,
          chain: chainFromNetwork(deployment.network),
          transport: custom(w.provider),
        });
        setWallet({ provider: w.provider, name: w.name, account, chainId, walletClient });
        setWallets(null);
        announce(`Connected ${shortAddress(account)}.`);
      } catch (e) {
        setWalletError(isUserRejection(e) ? "Connection was rejected in the wallet." : (e as Error).message);
      } finally {
        setConnecting(false);
      }
    },
    [deployment],
  );

  const connect = useCallback(async () => {
    setWalletError(null);
    setConnecting(true);
    const found = await discoverWallets();
    setConnecting(false);
    if (found.length === 0) {
      setWalletError("No browser wallet was detected. Install a wallet extension such as MetaMask or Rabby, then reload this page.");
      return;
    }
    if (found.length === 1) await connectWith(found[0]!);
    else setWallets(found);
  }, [connectWith]);

  const disconnect = useCallback(() => {
    setWallet(null);
    setWalletState(null);
    announce("Wallet disconnected from this page.");
  }, []);

  const switchChain = useCallback(async () => {
    if (!wallet || !deployment) return;
    setSwitching(true);
    setWalletError(null);
    try {
      await switchToNetwork(wallet.provider, deployment.network);
      const chainId = await currentChainId(wallet.provider);
      setWallet((w) => (w ? { ...w, chainId } : w));
    } catch (e) {
      setWalletError(
        isUserRejection(e)
          ? "The network switch was rejected in the wallet."
          : `Unable to switch networks: ${(e as Error).message}`,
      );
    } finally {
      setSwitching(false);
    }
  }, [wallet, deployment]);

  const onChainReady = !!wallet && !!deployment && wallet.chainId === deployment.chainId;
  const contractsReady = !!contractStatus?.checkinHasCode && !!contractStatus.tokenHasCode && contractStatus.tokenMatches;
  const canTransact = onChainReady && contractsReady;

  const changeView = (next: View) => {
    setView(next);
    const hash = window.location.hash.replace(/^#/, "");
    if (next === "organiser" || !hash.startsWith("pass?")) window.history.replaceState(null, "", `#${next}`);
  };

  const loadPassText = (text: string) => {
    const pass = parsePass(text);
    setIncomingPass(pass);
    setIncomingPassError(null);
    return pass;
  };

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <StatusRegion message={status} />
      <div className="page">
        <header className="site-header">
          <div>
            <h1>Event Checkin</h1>
            <p className="lede">
              Organiser passes and CHKN attendance rewards on {deployment?.network.name ?? "Sepolia"}. A test toy:
              attendance records are not tickets or credentials.
            </p>
          </div>
          <WalletPanel
            deployment={deployment}
            wallet={wallet}
            wallets={wallets}
            connecting={connecting}
            switching={switching}
            onConnect={connect}
            onConnectWith={connectWith}
            onDisconnect={disconnect}
            onSwitch={switchChain}
            onCancelPick={() => setWallets(null)}
          />
        </header>

        <main id="main" className="stack" tabIndex={-1}>
          {loadError ? (
            <Notice kind="error">
              <p>{loadError}</p>
              <p>The page cannot read contract addresses or ABIs without its deployment configuration.</p>
            </Notice>
          ) : null}
          {walletError ? (
            <Notice kind="error">
              <p>{walletError}</p>
            </Notice>
          ) : null}
          {deployment && contractStatus && !contractsReady ? (
            <Notice kind="error">
              <p>
                {!contractStatus.checkinHasCode || !contractStatus.tokenHasCode
                  ? "The configured RPC reports no contract code at a configured address. Transactions are disabled."
                  : "EventCheckin.token() does not match the configured CHKN address. Transactions are disabled."}
              </p>
            </Notice>
          ) : null}
          {deployment && wallet && !onChainReady ? (
            <Notice kind="warning">
              <p>
                Your wallet is on chain {wallet.chainId}. This page only works on {deployment.network.name} (chain{" "}
                {deployment.chainId}). Use the “Switch to {deployment.network.name}” control to continue.
              </p>
            </Notice>
          ) : null}
          {eventsError ? (
            <Notice kind="warning">
              <p>{eventsError}</p>
              <p>
                <Button small onClick={refreshAll}>
                  Retry reading
                </Button>
              </p>
            </Notice>
          ) : null}
          {incomingPassError ? (
            <Notice kind="error">
              <p>The pass in this link could not be read: {incomingPassError}</p>
            </Notice>
          ) : null}

          {deployment && publicClient ? (
            <>
              <section className="card" aria-labelledby="wallet-heading">
                <header>
                  <h2 id="wallet-heading">Your CHKN</h2>
                  {wallet ? (
                    <Button small onClick={refreshAll}>
                      Refresh
                    </Button>
                  ) : null}
                </header>
                <WalletPanel.Balances
                  deployment={deployment}
                  wallet={wallet}
                  walletState={walletState}
                  canTransact={canTransact}
                  publicClient={publicClient}
                  onMined={refreshAll}
                />
              </section>

              <div className="tabs" role="tablist" aria-label="Page view">
                {(["organiser", "attendee"] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    id={`tab-${v}`}
                    className="tab"
                    aria-selected={view === v}
                    aria-controls={`panel-${v}`}
                    tabIndex={view === v ? 0 : -1}
                    onClick={() => changeView(v)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
                        e.preventDefault();
                        const next: View = e.key === "Home" ? "organiser" : e.key === "End" ? "attendee" : v === "organiser" ? "attendee" : "organiser";
                        changeView(next);
                        document.getElementById(`tab-${next}`)?.focus();
                      }
                    }}
                  >
                    {v === "organiser" ? "Organiser" : "Attendee"}
                  </button>
                ))}
              </div>

              <section id="panel-organiser" role="tabpanel" aria-labelledby="tab-organiser" hidden={view !== "organiser"} className="stack">
                <OrganiserView
                  deployment={deployment}
                  publicClient={publicClient}
                  wallet={wallet}
                  walletState={walletState}
                  events={events}
                  canTransact={canTransact}
                  now={now}
                  onMined={refreshAll}
                  attendeesFor={(id) => attendeesForEvent(logState, id)}
                />
              </section>
              <section id="panel-attendee" role="tabpanel" aria-labelledby="tab-attendee" hidden={view !== "attendee"} className="stack">
                <AttendeeView
                  deployment={deployment}
                  publicClient={publicClient}
                  wallet={wallet}
                  walletState={walletState}
                  events={events}
                  canTransact={canTransact}
                  now={now}
                  incomingPass={incomingPass}
                  onLoadPass={loadPassText}
                  onMined={refreshAll}
                />
              </section>

              <section className="card" aria-labelledby="events-heading">
                <header>
                  <h2 id="events-heading">All events</h2>
                  <p className="small muted">
                    Read from EventCheckin views; attendee lists from CheckedIn logs since block{" "}
                    <span className="num">{deployment.deploymentBlock.toString()}</span>
                    {logState.scannedTo !== null ? (
                      <>
                        {" "}
                        up to <span className="num">{logState.scannedTo.toString()}</span>
                      </>
                    ) : null}
                    .
                  </p>
                </header>
                {logsError ? (
                  <Notice kind="warning">
                    <p>{logsError}</p>
                  </Notice>
                ) : null}
                <EventsList deployment={deployment} events={events} now={now} attendeesFor={(id) => attendeesForEvent(logState, id)} />
              </section>
            </>
          ) : !loadError ? (
            <p className="muted">Loading deployment configuration…</p>
          ) : null}
        </main>

        {deployment ? (
          <footer className="site-footer">
            <p>
              Contracts on {deployment.network.name} (chain {deployment.chainId}), source commit{" "}
              <code>{deployment.manifest.sourceCommit.slice(0, 12)}</code>:
            </p>
            <ul>
              {deployment.manifest.contracts.map((c) => (
                <li key={c.name}>
                  <a href={explorerAddress(deployment, c.address)} target="_blank" rel="noreferrer">
                    {c.name} on the explorer
                  </a>{" "}
                  <code>{c.address}</code>
                </li>
              ))}
            </ul>
            <p>
              CHKN comes from swapping {deployment.network.nativeCurrency.symbol} in the launch pool on the Uniswap v4
              PoolManager
              {deployment.network.uniswapV4 ? (
                <>
                  {" "}
                  <a href={explorerAddress(deployment, deployment.network.uniswapV4.poolManager)} target="_blank" rel="noreferrer">
                    {shortAddress(deployment.network.uniswapV4.poolManager)}
                  </a>
                </>
              ) : null}
              . This page has no in-page swap. Attendance records are a public, permanent, non-transferable test-toy
              record and not tickets or credentials.
            </p>
          </footer>
        ) : null}
      </div>
    </>
  );
}
