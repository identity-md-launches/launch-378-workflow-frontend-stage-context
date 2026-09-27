import type { ReactNode } from "react";
import type { Hex } from "viem";
import { explorerTx, type Deployment } from "../lib/config";

export function Notice({ kind, children }: { kind: "warning" | "error" | "success" | "info"; children: ReactNode }) {
  const icon = kind === "error" ? "!" : kind === "success" ? "✓" : kind === "warning" ? "△" : "i";
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : undefined}>
      <span className="notice-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="stack-tight">{children}</div>
    </div>
  );
}

export type TxPhase = "idle" | "simulating" | "signing" | "pending" | "mined" | "error";

export interface ActionState {
  phase: TxPhase;
  hash?: Hex;
  error?: string;
}

export const idleAction: ActionState = { phase: "idle" };

export function actionBusy(state: ActionState): boolean {
  return state.phase === "simulating" || state.phase === "signing" || state.phase === "pending";
}

const PHASE_TEXT: Record<Exclude<TxPhase, "idle">, string> = {
  simulating: "Checking the call…",
  signing: "Confirm in your wallet…",
  pending: "Waiting for the transaction to be mined…",
  mined: "Transaction confirmed.",
  error: "",
};

/** Shows a transaction's progress, explorer link and error text. */
export function TxStatus({ state, deployment, done }: { state: ActionState; deployment: Deployment; done?: string }) {
  if (state.phase === "idle") return null;
  if (state.phase === "error") {
    return (
      <Notice kind="error">
        <p>{state.error ?? "Something went wrong."}</p>
      </Notice>
    );
  }
  const busy = actionBusy(state);
  return (
    <div className={`notice ${state.phase === "mined" ? "notice-success" : "notice-info"}`}>
      {busy ? <span className="spinner" aria-hidden="true" /> : <span className="notice-icon" aria-hidden="true">✓</span>}
      <div className="stack-tight">
        <p>{state.phase === "mined" && done ? done : PHASE_TEXT[state.phase]}</p>
        {state.hash ? (
          <p>
            <a href={explorerTx(deployment, state.hash)} target="_blank" rel="noreferrer">
              View transaction {state.hash.slice(0, 10)}… on the explorer
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function Button({
  children,
  primary,
  busy,
  small,
  ...rest
}: { children: ReactNode; primary?: boolean; busy?: boolean; small?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn${primary ? " btn-primary" : ""}${small ? " btn-sm" : ""}`}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      small
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          announce(`${label} copied.`);
        } catch {
          announce("Copy failed. Select the text and copy it manually.");
        }
      }}
    >
      Copy {label}
    </Button>
  );
}

/** Polite live region shared by the page; rendered once from the start. */
export function StatusRegion({ message }: { message: string }) {
  return (
    <div role="status" className="sr-only">
      {message}
    </div>
  );
}

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function announce(message: string): void {
  for (const l of listeners) l(message);
}

export function subscribeAnnouncements(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
