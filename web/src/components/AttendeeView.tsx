import { useEffect, useState, type FormEvent } from "react";
import type { PublicClient } from "viem";
import type { WalletConnection } from "../App";
import { useAction } from "../hooks";
import { actions, describeError, eventState, readAttended, simulateCheckIn, type EventInfo, type TxContext, type WalletState } from "../lib/checkin";
import type { Deployment } from "../lib/config";
import { formatChkn, formatTimestamp, shortAddress } from "../lib/format";
import type { Pass } from "../lib/pass";
import { EventSummary } from "./EventsList";
import { Button, Notice, TxStatus } from "./ui";

interface Props {
  deployment: Deployment;
  publicClient: PublicClient;
  wallet: WalletConnection | null;
  walletState: WalletState | null;
  events: EventInfo[] | null;
  canTransact: boolean;
  now: number;
  incomingPass: Pass | null;
  onLoadPass: (text: string) => Pass;
  onMined: () => void;
}

type PassCheck =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "attended" }
  | { kind: "blocked"; reason: string };

export function AttendeeView(props: Props) {
  const { deployment, publicClient, wallet, walletState, events, canTransact, now, incomingPass, onLoadPass, onMined } = props;
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [check, setCheck] = useState<PassCheck | null>(null);
  const submit = useAction(onMined);
  const pass = incomingPass;
  const event = pass && events ? events.find((e) => e.id === pass.eventId) ?? null : null;

  // Verify an imported pass against the selected deployment before offering the action.
  useEffect(() => {
    if (!pass) {
      setCheck(null);
      return;
    }
    if (events === null) {
      setCheck({ kind: "checking" });
      return;
    }
    if (!event) {
      setCheck({ kind: "blocked", reason: `No event with id ${pass.eventId.toString()} exists on this deployment.` });
      return;
    }
    let cancelled = false;
    setCheck({ kind: "checking" });
    (async () => {
      try {
        if (await readAttended(publicClient, deployment, pass.eventId, pass.attendee)) {
          if (!cancelled) setCheck({ kind: "attended" });
          return;
        }
        const state = eventState(event, now);
        if (state !== "open") {
          if (!cancelled) setCheck({ kind: "blocked", reason: state === "closed" ? "This event is closed." : "This event has ended." });
          return;
        }
        if (BigInt(now) > pass.deadline) {
          if (!cancelled) setCheck({ kind: "blocked", reason: "This pass has passed its deadline." });
          return;
        }
        // Dry-run from the attendee's address (anyone may submit, so the sender does not matter).
        await simulateCheckIn(publicClient, deployment, wallet?.account ?? pass.attendee, pass);
        if (!cancelled) setCheck({ kind: "ready" });
      } catch (err) {
        if (!cancelled) setCheck({ kind: "blocked", reason: describeError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `now` is intentionally excluded so the simulation does not rerun every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass, event, events === null, publicClient, deployment, wallet?.account, submit.state.phase]);

  const load = (e: FormEvent) => {
    e.preventDefault();
    try {
      const p = onLoadPass(text);
      setParseError(null);
      window.history.replaceState(null, "", `#pass?eventId=${p.eventId}&attendee=${p.attendee}&deadline=${p.deadline}&signature=${p.signature}`);
    } catch (err) {
      setParseError((err as Error).message);
      document.getElementById("pass-text")?.focus();
    }
  };

  const ctx = (onStatus: TxContext["onStatus"]): TxContext => {
    if (!wallet) throw new Error("Connect a wallet first.");
    return { publicClient, walletClient: wallet.walletClient, account: wallet.account, deployment, onStatus };
  };

  const rewardNow = event && event.pool >= event.rewardPerCheckIn ? event.rewardPerCheckIn : 0n;

  return (
    <>
      <section className="card" aria-labelledby="import-heading">
        <header>
          <h2 id="import-heading">Your pass</h2>
        </header>
        <p className="small muted">
          Paste the pass text or link the organiser gave you, or open the link directly. The pass is checked against this
          deployment before you can submit it. Anyone can submit a pass; the attendance and reward always go to the
          attendee named in it.
        </p>
        <form onSubmit={load} noValidate>
          <div className="field">
            <label htmlFor="pass-text">Pass text or link</label>
            <textarea
              id="pass-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder='{"eventId": "1", "attendee": "0x…", "deadline": "…", "signature": "0x…"}'
              aria-invalid={parseError ? true : undefined}
              aria-describedby={parseError ? "pass-text-error" : undefined}
            />
            {parseError ? (
              <span id="pass-text-error" className="error">
                {parseError}
              </span>
            ) : null}
          </div>
          <div className="row">
            <Button type="submit" primary={!pass}>
              Load pass
            </Button>
          </div>
        </form>

        {pass ? (
          <div className="stack" aria-live="polite">
            <h3>
              Pass for {shortAddress(pass.attendee)} · event #{pass.eventId.toString()}
            </h3>
            <dl className="stats">
              <div>
                <dt>Attendee</dt>
                <dd className="mono">{pass.attendee}</dd>
              </div>
              <div>
                <dt>Pass deadline</dt>
                <dd>{formatTimestamp(pass.deadline)}</dd>
              </div>
              <div>
                <dt>Signature</dt>
                <dd className="mono">{pass.signature.slice(0, 14)}…</dd>
              </div>
            </dl>
            {event ? (
              <>
                <h3>
                  <span className="muted num">#{event.id.toString()}</span> {event.title}
                </h3>
                <EventSummary event={event} now={now} />
              </>
            ) : null}
            {check?.kind === "checking" ? (
              <p className="small muted">
                <span className="spinner" aria-hidden="true" /> Checking the pass against the contract…
              </p>
            ) : null}
            {check?.kind === "attended" ? (
              <Notice kind="success">
                <p>Attendance for this attendee is already recorded for this event. Nothing more to submit.</p>
              </Notice>
            ) : null}
            {check?.kind === "blocked" ? (
              <Notice kind="error">
                <p>This pass cannot be submitted: {check.reason}</p>
              </Notice>
            ) : null}
            {check?.kind === "ready" ? (
              <Notice kind="success">
                <p>
                  The contract accepts this pass. Submitting records attendance for {shortAddress(pass.attendee)}
                  {event ? (rewardNow > 0n ? ` and credits ${formatChkn(rewardNow)} to that address` : " without a reward (the pool does not cover one)") : ""}.
                </p>
              </Notice>
            ) : null}
            <div className="row">
              <Button
                primary
                busy={submit.busy}
                disabled={!canTransact || check?.kind !== "ready"}
                onClick={() => submit.run((onStatus) => actions.checkIn(ctx(onStatus), pass.eventId, pass.attendee, pass.deadline, pass.signature), "Check-in confirmed.")}
              >
                Submit check-in
              </Button>
              {!wallet ? <span className="small muted">Connect any wallet to submit; the attendee address in the pass is credited.</span> : null}
            </div>
            <TxStatus state={submit.state} deployment={deployment} done="Check-in confirmed. Attendance is recorded." />
          </div>
        ) : null}
      </section>

      <section className="card" aria-labelledby="rewards-heading">
        <header>
          <h2 id="rewards-heading">Rewards</h2>
        </header>
        <p className="small muted">
          Rewards accrue as withdrawable credit for the attendee address. Use “Withdraw credit” in the CHKN panel above to
          transfer {wallet && walletState ? formatChkn(walletState.withdrawable) : "your credit"} to your wallet. CHKN
          for funding events comes from swapping {deployment.network.nativeCurrency.symbol} in the launch pool; this page
          has no in-page swap.
        </p>
      </section>
    </>
  );
}
