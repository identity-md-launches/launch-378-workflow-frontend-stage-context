import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import type { WalletConnection } from "../App";
import { useAction } from "../hooks";
import { actions, checkInTypedData, encodeTitle, eventState, type EventInfo, type TxContext, type WalletState } from "../lib/checkin";
import type { Deployment } from "../lib/config";
import { formatChkn, fromDatetimeLocal, nowSeconds, parseChkn, shortAddress, toDatetimeLocal } from "../lib/format";
import type { CheckInRecord } from "../lib/logs";
import { passToJson, passToLink, type Pass } from "../lib/pass";
import { isUserRejection, signTypedDataV4 } from "../lib/wallet";
import { AttendeeTable, EventSummary } from "./EventsList";
import { Button, CopyButton, Notice, TxStatus, announce } from "./ui";

interface Props {
  deployment: Deployment;
  publicClient: PublicClient;
  wallet: WalletConnection | null;
  walletState: WalletState | null;
  events: EventInfo[] | null;
  canTransact: boolean;
  now: number;
  onMined: () => void;
  attendeesFor: (id: bigint) => CheckInRecord[];
}

function txContext(p: Props, onStatus: TxContext["onStatus"]): TxContext {
  if (!p.wallet) throw new Error("Connect a wallet first.");
  return {
    publicClient: p.publicClient,
    walletClient: p.wallet.walletClient,
    account: p.wallet.account,
    deployment: p.deployment,
    onStatus,
  };
}

export function OrganiserView(props: Props) {
  const { deployment, wallet, events, canTransact, now } = props;
  const mine = useMemo(
    () => (events && wallet ? events.filter((e) => e.organiser.toLowerCase() === wallet.account.toLowerCase()) : []),
    [events, wallet],
  );
  const [selectedId, setSelectedId] = useState<string>("");
  useEffect(() => {
    if (mine.length > 0 && !mine.some((e) => e.id.toString() === selectedId)) setSelectedId(mine[0]!.id.toString());
    if (mine.length === 0 && selectedId) setSelectedId("");
  }, [mine, selectedId]);
  const selected = mine.find((e) => e.id.toString() === selectedId) ?? null;

  return (
    <>
      <CreateEventCard {...props} />
      <section className="card" aria-labelledby="manage-heading">
        <header>
          <h2 id="manage-heading">Manage an event</h2>
        </header>
        {!wallet ? (
          <p className="muted">Connect the organiser wallet to fund, close, reclaim and sign passes for your events.</p>
        ) : mine.length === 0 ? (
          <div className="stack-tight">
            <p>No events organised by {shortAddress(wallet.account)} yet.</p>
            <p className="small muted">Create an event above. Only the address that created an event can sign its passes.</p>
          </div>
        ) : (
          <>
            <div className="field" style={{ maxWidth: "28rem" }}>
              <label htmlFor="manage-event">Event</label>
              <select id="manage-event" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {mine.map((e) => (
                  <option key={e.id.toString()} value={e.id.toString()}>
                    #{e.id.toString()} {e.title}
                  </option>
                ))}
              </select>
            </div>
            {selected ? (
              <div className="stack" key={selected.id.toString()}>
                <EventSummary event={selected} now={now} />
                <FundForm {...props} event={selected} />
                <CloseReclaim {...props} event={selected} />
                <SignPass {...props} event={selected} />
                <details>
                  <summary>Attendee list ({props.attendeesFor(selected.id).length})</summary>
                  <AttendeeTable deployment={deployment} records={props.attendeesFor(selected.id)} />
                </details>
              </div>
            ) : null}
          </>
        )}
        {wallet && !canTransact ? (
          <p className="small muted">Transactions stay disabled until the wallet is on {deployment.network.name} and the contracts are verified.</p>
        ) : null}
      </section>
    </>
  );
}

function CreateEventCard(props: Props) {
  const { deployment, wallet, canTransact, onMined } = props;
  const create = useAction(onMined);
  const [title, setTitle] = useState("");
  const [endsAt, setEndsAt] = useState(() => toDatetimeLocal(nowSeconds() + 7 * 86_400));
  const [reward, setReward] = useState("0");
  const [errors, setErrors] = useState<{ title?: string; endsAt?: string; reward?: string }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    let titleHex: `0x${string}` | undefined;
    let endsSeconds = 0;
    let rewardWei = 0n;
    if (title.trim() === "") next.title = "Enter a title.";
    else {
      try {
        titleHex = encodeTitle(title);
      } catch (err) {
        next.title = (err as Error).message;
      }
    }
    try {
      endsSeconds = fromDatetimeLocal(endsAt);
      const n = nowSeconds();
      if (endsSeconds <= n) next.endsAt = "Choose an end time in the future.";
      else if (endsSeconds > n + 365 * 86_400) next.endsAt = "Choose an end time within 365 days.";
    } catch (err) {
      next.endsAt = (err as Error).message;
    }
    try {
      rewardWei = parseChkn(reward === "" ? "0" : reward);
    } catch (err) {
      next.reward = (err as Error).message;
    }
    setErrors(next);
    const firstError = Object.keys(next)[0];
    if (firstError) {
      document.getElementById(`create-${firstError}`)?.focus();
      return;
    }
    void create.run(
      (onStatus) => actions.createEvent(txContext(props, onStatus), titleHex!, BigInt(endsSeconds), rewardWei),
      "Event created.",
    );
  };

  return (
    <section className="card" aria-labelledby="create-heading">
      <header>
        <h2 id="create-heading">Create an event</h2>
      </header>
      <p className="small muted">
        You become the organiser: only your wallet can sign passes, close the event and reclaim unspent funds. The reward is
        paid from the event's pool to each attendee who checks in while the pool covers it.
      </p>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="create-title">Title</label>
            <input
              id="create-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={64}
              autoComplete="off"
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "create-title-error" : "create-title-hint"}
            />
            {errors.title ? (
              <span id="create-title-error" className="error">
                {errors.title}
              </span>
            ) : (
              <span id="create-title-hint" className="hint">
                Up to 32 bytes, stored on-chain as bytes32.
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="create-endsAt">Ends at</label>
            <input
              id="create-endsAt"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              aria-invalid={errors.endsAt ? true : undefined}
              aria-describedby={errors.endsAt ? "create-endsAt-error" : "create-endsAt-hint"}
            />
            {errors.endsAt ? (
              <span id="create-endsAt-error" className="error">
                {errors.endsAt}
              </span>
            ) : (
              <span id="create-endsAt-hint" className="hint">
                Local time; must be within the next 365 days.
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="create-reward">Reward per check-in (CHKN)</label>
            <input
              id="create-reward"
              inputMode="decimal"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              aria-invalid={errors.reward ? true : undefined}
              aria-describedby={errors.reward ? "create-reward-error" : "create-reward-hint"}
            />
            {errors.reward ? (
              <span id="create-reward-error" className="error">
                {errors.reward}
              </span>
            ) : (
              <span id="create-reward-hint" className="hint">
                0 for attendance without a reward.
              </span>
            )}
          </div>
        </div>
        <div className="row">
          <Button type="submit" primary busy={create.busy} disabled={!canTransact}>
            Create event
          </Button>
          {!wallet ? <span className="small muted">Connect a wallet to create an event.</span> : null}
        </div>
        <TxStatus state={create.state} deployment={deployment} done="Event created." />
      </form>
    </section>
  );
}

function FundForm(props: Props & { event: EventInfo }) {
  const { deployment, walletState, canTransact, event, now, onMined } = props;
  const approve = useAction(onMined);
  const fund = useAction(onMined);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = eventState(event, now) === "open";

  let amountWei: bigint | null = null;
  try {
    amountWei = amount.trim() === "" ? null : parseChkn(amount);
  } catch {
    amountWei = null;
  }
  const allowance = walletState?.allowance ?? 0n;
  const balance = walletState?.balance ?? 0n;
  const needsApproval = amountWei !== null && amountWei > 0n && allowance < amountWei;
  const insufficient = amountWei !== null && amountWei > balance;

  const validate = (): bigint | null => {
    try {
      const v = parseChkn(amount);
      if (v === 0n) throw new Error("Enter an amount greater than zero.");
      setError(null);
      return v;
    } catch (err) {
      setError((err as Error).message);
      document.getElementById("fund-amount")?.focus();
      return null;
    }
  };

  return (
    <form
      aria-labelledby="fund-heading"
      onSubmit={(e) => {
        e.preventDefault();
        const v = validate();
        if (v === null) return;
        if (allowance < v) {
          void approve.run((onStatus) => actions.approve(txContext(props, onStatus), v), "Approval confirmed. You can fund the event now.");
        } else {
          void fund.run((onStatus) => actions.fundEvent(txContext(props, onStatus), event.id, v), "Event funded.");
        }
      }}
      noValidate
    >
      <h3 id="fund-heading">Fund the reward pool</h3>
      <p className="small muted">
        Step 1 approves EventCheckin to move the amount of CHKN; step 2 calls fundEvent. Anyone can fund an open event;
        unspent funds go back to the organiser through reclaim.
      </p>
      <div className="row">
        <div className="field" style={{ flex: "1 1 12rem" }}>
          <label htmlFor="fund-amount">Amount (CHKN)</label>
          <input
            id="fund-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "fund-amount-error" : "fund-amount-hint"}
          />
          {error ? (
            <span id="fund-amount-error" className="error">
              {error}
            </span>
          ) : (
            <span id="fund-amount-hint" className="hint">
              Balance {walletState ? formatChkn(balance) : "…"}, allowance {walletState ? formatChkn(allowance) : "…"}.
            </span>
          )}
        </div>
      </div>
      <div className="row">
        <Button type="submit" primary={needsApproval || amountWei === null} busy={approve.busy} disabled={!canTransact || !open || fund.busy || (!needsApproval && amountWei !== null)}>
          1. Approve
        </Button>
        <Button type="submit" primary={!needsApproval && amountWei !== null} busy={fund.busy} disabled={!canTransact || !open || approve.busy || needsApproval || amountWei === null || insufficient}>
          2. Fund event
        </Button>
        {!open ? <span className="small muted">Funding is only possible while the event is open.</span> : null}
        {insufficient ? <span className="small muted">Your CHKN balance is below this amount.</span> : null}
      </div>
      <TxStatus state={approve.state} deployment={deployment} done="Approval confirmed. You can fund the event now." />
      <TxStatus state={fund.state} deployment={deployment} done="Event funded." />
    </form>
  );
}

function CloseReclaim(props: Props & { event: EventInfo }) {
  const { deployment, canTransact, event, now, onMined } = props;
  const close = useAction(onMined);
  const reclaim = useAction(onMined);
  const [confirmClose, setConfirmClose] = useState(false);
  const state = eventState(event, now);
  const canReclaim = state !== "open" && event.pool > 0n;

  return (
    <div className="stack-tight">
      <h3>Close and reclaim</h3>
      <p className="small muted">
        Closing is irreversible: it stops funding and check-ins immediately. Reclaim moves the unspent pool to your
        withdrawable credit once the event is closed or past its end time.
      </p>
      <div className="row">
        {!confirmClose ? (
          <Button disabled={!canTransact || event.closed} onClick={() => setConfirmClose(true)}>
            Close event
          </Button>
        ) : (
          <>
            <span className="small">Close event #{event.id.toString()} permanently?</span>
            <Button
              primary
              busy={close.busy}
              disabled={!canTransact}
              onClick={() =>
                close.run((onStatus) => actions.closeEvent(txContext(props, onStatus), event.id), "Event closed.").then(() => setConfirmClose(false))
              }
            >
              Close event
            </Button>
            <Button onClick={() => setConfirmClose(false)} disabled={close.busy}>
              Cancel
            </Button>
          </>
        )}
        <Button
          busy={reclaim.busy}
          disabled={!canTransact || !canReclaim}
          onClick={() => reclaim.run((onStatus) => actions.reclaim(txContext(props, onStatus), event.id), "Unspent pool reclaimed to your credit.")}
        >
          Reclaim {event.pool > 0n ? formatChkn(event.pool) : "pool"}
        </Button>
        {state === "open" ? <span className="small muted">Reclaim becomes available after closing or after the end time.</span> : null}
        {state !== "open" && event.pool === 0n ? <span className="small muted">The pool is empty; nothing to reclaim.</span> : null}
      </div>
      <TxStatus state={close.state} deployment={deployment} done="Event closed." />
      <TxStatus state={reclaim.state} deployment={deployment} done="Unspent pool reclaimed to your credit." />
    </div>
  );
}

function SignPass(props: Props & { event: EventInfo }) {
  const { deployment, wallet, event, now } = props;
  const [attendee, setAttendee] = useState("");
  const [deadline, setDeadline] = useState(() => toDatetimeLocal(Math.min(Number(event.endsAt), nowSeconds() + 86_400)));
  const [error, setError] = useState<{ attendee?: string; deadline?: string; sign?: string }>({});
  const [signing, setSigning] = useState(false);
  const [pass, setPass] = useState<Pass | null>(null);
  const isOrganiser = !!wallet && wallet.account.toLowerCase() === event.organiser.toLowerCase();
  const onChain = !!wallet && wallet.chainId === deployment.chainId;
  const open = eventState(event, now) === "open";

  const sign = async (e: FormEvent) => {
    e.preventDefault();
    if (!wallet) return;
    const next: typeof error = {};
    let attendeeAddress: Address | undefined;
    if (!isAddress(attendee.trim(), { strict: false })) next.attendee = "Enter the attendee's Ethereum address (0x followed by 40 hex characters).";
    else attendeeAddress = getAddress(attendee.trim());
    if (attendeeAddress && BigInt(attendeeAddress) === 0n) next.attendee = "The attendee cannot be the zero address.";
    let deadlineSeconds = 0;
    try {
      deadlineSeconds = fromDatetimeLocal(deadline);
      if (deadlineSeconds <= nowSeconds()) next.deadline = "Choose a deadline in the future.";
    } catch (err) {
      next.deadline = (err as Error).message;
    }
    setError(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`pass-${first}`)?.focus();
      return;
    }
    const message = { eventId: event.id, attendee: attendeeAddress!, deadline: BigInt(deadlineSeconds) };
    const typedData = checkInTypedData(deployment.chainId, deployment.checkin, message);
    setSigning(true);
    setPass(null);
    try {
      const signature = await signTypedDataV4(wallet.provider, wallet.account, typedData);
      setPass({ ...message, signature });
      announce("Pass signed.");
    } catch (err) {
      setError({ sign: isUserRejection(err) ? "Signing was rejected in the wallet." : (err as Error).message });
    } finally {
      setSigning(false);
    }
  };

  const pageUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;

  return (
    <form onSubmit={sign} noValidate aria-labelledby="sign-heading">
      <h3 id="sign-heading">Sign a pass</h3>
      <p className="small muted">
        The wallet signs the CheckIn typed data (event id, attendee, deadline) for this contract on chain{" "}
        {deployment.chainId}. Anyone can submit the pass; the attendance and reward always go to the attendee. A signed pass
        cannot be revoked except by closing the event or letting the deadline pass.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="pass-attendee">Attendee address</label>
          <input
            id="pass-attendee"
            value={attendee}
            onChange={(e) => setAttendee(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="0x…"
            aria-invalid={error.attendee ? true : undefined}
            aria-describedby={error.attendee ? "pass-attendee-error" : undefined}
          />
          {error.attendee ? (
            <span id="pass-attendee-error" className="error">
              {error.attendee}
            </span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="pass-deadline">Pass deadline</label>
          <input
            id="pass-deadline"
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            aria-invalid={error.deadline ? true : undefined}
            aria-describedby={error.deadline ? "pass-deadline-error" : "pass-deadline-hint"}
          />
          {error.deadline ? (
            <span id="pass-deadline-error" className="error">
              {error.deadline}
            </span>
          ) : (
            <span id="pass-deadline-hint" className="hint">
              The pass must be submitted before this time and before the event ends.
            </span>
          )}
        </div>
      </div>
      <div className="row">
        <Button type="submit" primary busy={signing} disabled={!isOrganiser || !onChain || !open}>
          Sign pass
        </Button>
        {!isOrganiser ? <span className="small muted">Only the organiser wallet can sign passes for this event.</span> : null}
        {isOrganiser && !onChain ? <span className="small muted">Switch to {deployment.network.name} first so the signature carries the right chain id.</span> : null}
        {isOrganiser && onChain && !open ? <span className="small muted">This event no longer accepts check-ins.</span> : null}
      </div>
      {error.sign ? (
        <Notice kind="error">
          <p>{error.sign}</p>
        </Notice>
      ) : null}
      {pass ? (
        <div className="pass-box">
          <div className="row">
            <strong>Signed pass for {shortAddress(pass.attendee)}</strong>
            <CopyButton text={passToJson(pass)} label="pass text" />
            <CopyButton text={passToLink(pass, pageUrl)} label="pass link" />
          </div>
          <pre>{passToJson(pass)}</pre>
          <p className="small">
            Link:{" "}
            <a className="link-box" href={passToLink(pass, pageUrl)}>
              {passToLink(pass, pageUrl)}
            </a>
          </p>
        </div>
      ) : null}
    </form>
  );
}
