import { eventState, type EventInfo } from "../lib/checkin";
import { explorerAddress, explorerTx, type Deployment } from "../lib/config";
import { formatChkn, formatTimestamp, shortAddress } from "../lib/format";
import type { CheckInRecord } from "../lib/logs";

export function StateBadge({ event, now }: { event: EventInfo; now: number }) {
  const state = eventState(event, now);
  const cls = state === "open" ? "badge badge-success" : state === "closed" ? "badge badge-error" : "badge badge-warning";
  const text = state === "open" ? "Open" : state === "closed" ? "Closed" : "Ended";
  return <span className={cls}>{text}</span>;
}

export function AttendeeTable({ deployment, records }: { deployment: Deployment; records: CheckInRecord[] }) {
  if (records.length === 0) {
    return <p className="small muted">No check-ins yet. Attendees appear here once a pass is submitted and mined.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Checked-in attendees</caption>
        <thead>
          <tr>
            <th scope="col">Attendee</th>
            <th scope="col" className="num">
              Reward
            </th>
            <th scope="col">Submitted by</th>
            <th scope="col">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={`${r.txHash}:${r.logIndex}`}>
              <td className="mono">
                <a href={explorerAddress(deployment, r.attendee)} target="_blank" rel="noreferrer">
                  {shortAddress(r.attendee)}
                </a>
              </td>
              <td className="num">{r.reward === 0n ? "none" : formatChkn(r.reward)}</td>
              <td className="mono">{r.submitter.toLowerCase() === r.attendee.toLowerCase() ? "self" : shortAddress(r.submitter)}</td>
              <td className="mono">
                <a href={explorerTx(deployment, r.txHash)} target="_blank" rel="noreferrer">
                  {r.txHash.slice(0, 10)}…
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EventSummary({ event, now }: { event: EventInfo; now: number }) {
  return (
    <dl className="stats">
      <div>
        <dt>Organiser</dt>
        <dd className="mono">{shortAddress(event.organiser)}</dd>
      </div>
      <div>
        <dt>Ends</dt>
        <dd>{formatTimestamp(event.endsAt)}</dd>
      </div>
      <div>
        <dt>Reward per check-in</dt>
        <dd>{formatChkn(event.rewardPerCheckIn)}</dd>
      </div>
      <div>
        <dt>Pool</dt>
        <dd>{formatChkn(event.pool)}</dd>
      </div>
      <div>
        <dt>Attendees</dt>
        <dd>{event.attendeeCount.toString()}</dd>
      </div>
      <div>
        <dt>State</dt>
        <dd>
          <StateBadge event={event} now={now} />
        </dd>
      </div>
    </dl>
  );
}

interface Props {
  deployment: Deployment;
  events: EventInfo[] | null;
  now: number;
  attendeesFor: (id: bigint) => CheckInRecord[];
}

export function EventsList({ deployment, events, now, attendeesFor }: Props) {
  if (events === null) return <p className="muted">Reading events…</p>;
  if (events.length === 0) {
    return (
      <div className="stack-tight">
        <p>No events yet.</p>
        <p className="small muted">Create one in the Organiser view; it appears here as soon as the transaction is mined.</p>
      </div>
    );
  }
  return (
    <ul className="event-list">
      {events.map((e) => {
        const records = attendeesFor(e.id);
        return (
          <li key={e.id.toString()} className="event-item">
            <div className="card-title-row">
              <h3>
                <span className="muted num">#{e.id.toString()}</span> {e.title}
              </h3>
              <StateBadge event={e} now={now} />
            </div>
            <EventSummary event={e} now={now} />
            <details>
              <summary>
                Attendee list ({records.length})
              </summary>
              <AttendeeTable deployment={deployment} records={records} />
            </details>
          </li>
        );
      })}
    </ul>
  );
}
