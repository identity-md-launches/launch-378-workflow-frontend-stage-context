import type { PublicClient } from "viem";
import type { WalletConnection } from "../App";
import { useAction } from "../hooks";
import { actions, type WalletState } from "../lib/checkin";
import { explorerAddress, type Deployment } from "../lib/config";
import { formatChkn, shortAddress } from "../lib/format";
import type { DiscoveredWallet } from "../lib/wallet";
import { Button, TxStatus } from "./ui";

interface Props {
  deployment: Deployment | null;
  wallet: WalletConnection | null;
  wallets: DiscoveredWallet[] | null;
  connecting: boolean;
  switching: boolean;
  onConnect: () => void;
  onConnectWith: (w: DiscoveredWallet) => void;
  onDisconnect: () => void;
  onSwitch: () => void;
  onCancelPick: () => void;
}

/** Header controls: connect, pick a wallet, switch network, disconnect. */
export function WalletPanel({ deployment, wallet, wallets, connecting, switching, onConnect, onConnectWith, onDisconnect, onSwitch, onCancelPick }: Props) {
  if (!deployment) return null;
  if (wallets && wallets.length > 1) {
    return (
      <div className="row" role="group" aria-label="Choose a wallet">
        {wallets.map((w) => (
          <Button key={w.name} primary busy={connecting} onClick={() => onConnectWith(w)}>
            Connect {w.name}
          </Button>
        ))}
        <Button onClick={onCancelPick}>Cancel</Button>
      </div>
    );
  }
  if (!wallet) {
    return (
      <div className="row">
        <Button primary busy={connecting} onClick={onConnect}>
          Connect wallet
        </Button>
      </div>
    );
  }
  const wrongChain = wallet.chainId !== deployment.chainId;
  return (
    <div className="row">
      <span className="badge" translate="no">
        {wallet.name}:{" "}
        <a href={explorerAddress(deployment, wallet.account)} target="_blank" rel="noreferrer" className="mono">
          {shortAddress(wallet.account)}
        </a>
      </span>
      {wrongChain ? (
        <>
          <span className="badge badge-warning">Wrong network</span>
          <Button primary busy={switching} onClick={onSwitch}>
            Switch to {deployment.network.name}
          </Button>
        </>
      ) : (
        <span className="badge badge-success">{deployment.network.name}</span>
      )}
      <Button onClick={onDisconnect}>Disconnect</Button>
    </div>
  );
}

interface BalancesProps {
  deployment: Deployment;
  wallet: WalletConnection | null;
  walletState: WalletState | null;
  canTransact: boolean;
  publicClient: PublicClient;
  onMined: () => void;
}

/** CHKN balance, allowance to EventCheckin and withdrawable credit, with the Withdraw control. */
function Balances({ deployment, wallet, walletState, canTransact, publicClient, onMined }: BalancesProps) {
  const withdraw = useAction(onMined);
  if (!wallet) {
    return (
      <p className="muted">
        Connect a browser wallet on {deployment.network.name} to see your CHKN balance, the allowance granted to
        EventCheckin and your withdrawable credit.
      </p>
    );
  }
  const nothing = !walletState || walletState.withdrawable === 0n;
  return (
    <div className="stack">
      <dl className="stats">
        <div>
          <dt>Balance</dt>
          <dd>{walletState ? formatChkn(walletState.balance) : "…"}</dd>
        </div>
        <div>
          <dt>Allowance to EventCheckin</dt>
          <dd>{walletState ? formatChkn(walletState.allowance) : "…"}</dd>
        </div>
        <div>
          <dt>Withdrawable credit</dt>
          <dd>{walletState ? formatChkn(walletState.withdrawable) : "…"}</dd>
        </div>
      </dl>
      <div className="row">
        <Button
          primary
          busy={withdraw.busy}
          disabled={!canTransact || nothing}
          onClick={() =>
            withdraw.run(
              (onStatus) =>
                actions.withdraw({
                  publicClient,
                  walletClient: wallet.walletClient,
                  account: wallet.account,
                  deployment,
                  onStatus,
                }),
              "Withdrawal confirmed.",
            )
          }
        >
          Withdraw credit
        </Button>
        <span className="small muted">
          {nothing
            ? "Withdraw sends your full credit (rewards and reclaimed funds) to your address; it is unavailable while the credit is zero."
            : `Sends ${formatChkn(walletState.withdrawable)} to ${shortAddress(wallet.account)}.`}
        </span>
      </div>
      <TxStatus state={withdraw.state} deployment={deployment} done="Withdrawal confirmed." />
    </div>
  );
}

WalletPanel.Balances = Balances;
