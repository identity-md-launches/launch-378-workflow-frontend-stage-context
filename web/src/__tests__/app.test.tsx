import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { encodeTitle } from "../lib/checkin";
import { installFetch, makeModel, mockWallet, type Model } from "./mockRpc";

const ORGANISER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ATTENDEE = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

function withEvents(model: Model) {
  model.events.push({
    organiser: ORGANISER,
    title: encodeTitle("Sepolia meetup"),
    endsAt: BigInt(Math.floor(Date.now() / 1000) + 86_400),
    closed: false,
    reward: 5n * 10n ** 18n,
    pool: 50n * 10n ** 18n,
    attendees: 0n,
  });
  model.balances[ORGANISER.toLowerCase()] = 1_000n * 10n ** 18n;
  model.allowances[ORGANISER.toLowerCase()] = 10n * 10n ** 18n;
  model.withdrawable[ORGANISER.toLowerCase()] = 3n * 10n ** 18n;
  return model;
}

describe("App", () => {
  beforeEach(() => {
    window.location.hash = "";
    delete window.ethereum;
  });
  afterEach(() => cleanup());

  it("loads the runtime deployment configuration and reads events without a wallet", async () => {
    installFetch(withEvents(makeModel()));
    render(<App />);
    expect(await screen.findByRole("heading", { name: /Sepolia meetup/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create event" })).toBeDisabled();
    expect(screen.getByText("Connect a wallet to create an event.")).toBeInTheDocument();
    expect(screen.getByText("50 CHKN")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "EventCheckin on the explorer" })).toHaveAttribute(
      "href",
      "https://sepolia.etherscan.io/address/0xcbcc69828a4916362a3fbf1df2e6115eb27ee2e4",
    );
  });

  it("explains when no wallet is installed", async () => {
    installFetch(withEvents(makeModel()));
    render(<App />);
    await screen.findByRole("heading", { name: /Sepolia meetup/ });
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(await screen.findByText(/No browser wallet was detected/)).toBeInTheDocument();
  });

  it("shows the wrong-network state, offers wallet_addEthereumChain after 4902 and then enables organiser controls", async () => {
    installFetch(withEvents(makeModel()));
    const wallet = mockWallet(ORGANISER, 1);
    window.ethereum = wallet;
    render(<App />);
    await screen.findByRole("heading", { name: /Sepolia meetup/ });
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(await screen.findByText("Wrong network")).toBeInTheDocument();
    expect(await screen.findByText(/Your wallet is on chain 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create event" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Switch to Sepolia" }));
    await waitFor(() => expect(screen.queryByText("Wrong network")).not.toBeInTheDocument());
    const methods = wallet.calls.map((c) => c.method);
    expect(methods).toContain("wallet_addEthereumChain");
    expect(methods.indexOf("wallet_addEthereumChain")).toBeGreaterThan(methods.indexOf("wallet_switchEthereumChain"));

    // Live wallet state once connected on the right chain.
    expect(await screen.findByText("1,000 CHKN")).toBeInTheDocument();
    expect(screen.getByText("10 CHKN")).toBeInTheDocument();
    expect(screen.getByText("3 CHKN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw credit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create event" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign pass" })).toBeEnabled();
    // Fund: allowance 10 < 25 so the Approve step is the live one.
    await userEvent.type(screen.getByLabelText("Amount (CHKN)"), "25");
    expect(screen.getByRole("button", { name: "1. Approve" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2. Fund event" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Amount (CHKN)"));
    await userEvent.type(screen.getByLabelText("Amount (CHKN)"), "7");
    expect(screen.getByRole("button", { name: "1. Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2. Fund event" })).toBeEnabled();
  });

  it("validates the create form on submit and focuses the first error", async () => {
    installFetch(withEvents(makeModel()));
    window.ethereum = mockWallet(ORGANISER, 11155111, { knowsChain: true });
    render(<App />);
    await screen.findByRole("heading", { name: /Sepolia meetup/ });
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await screen.findByText("1,000 CHKN");
    await userEvent.click(screen.getByRole("button", { name: "Create event" }));
    expect(await screen.findByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveFocus();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
  });

  it("opens a pass link in the attendee view and shows the contract's revert reason", async () => {
    installFetch(withEvents(makeModel({ checkInError: "InvalidSignature" })));
    window.location.hash = `#pass?eventId=1&attendee=${ATTENDEE}&deadline=${Math.floor(Date.now() / 1000) + 3600}&signature=0x1234`;
    render(<App />);
    const tab = await screen.findByRole("tab", { name: "Attendee" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: /Pass for 0x3C44…93BC/ })).toBeInTheDocument();
    expect(await screen.findByText(/The signature is not a valid pass/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit check-in" })).toBeDisabled();
  });

  it("reports an already recorded attendance and an unknown event", async () => {
    const model = withEvents(makeModel());
    model.attended.add(`1:${ATTENDEE.toLowerCase()}`);
    installFetch(model);
    window.location.hash = `#pass?eventId=1&attendee=${ATTENDEE}&deadline=99999999999&signature=0x1234`;
    render(<App />);
    expect(await screen.findByText(/already recorded/)).toBeInTheDocument();
    cleanup();

    window.location.hash = `#pass?eventId=9&attendee=${ATTENDEE}&deadline=99999999999&signature=0x1234`;
    render(<App />);
    expect(await screen.findByText(/No event with id 9 exists/)).toBeInTheDocument();
  });

  it("loads a pasted pass and marks it ready when the simulation succeeds", async () => {
    installFetch(withEvents(makeModel()));
    render(<App />);
    await screen.findByRole("heading", { name: /Sepolia meetup/ });
    await userEvent.click(screen.getByRole("tab", { name: "Attendee" }));
    const panel = screen.getByRole("tabpanel", { name: "Attendee" });
    await userEvent.click(within(panel).getByRole("button", { name: "Load pass" }));
    expect(await within(panel).findByText("Paste the pass text or link.")).toBeInTheDocument();
    await userEvent.click(within(panel).getByLabelText("Pass text or link"));
    await userEvent.paste(
      JSON.stringify({ eventId: "1", attendee: ATTENDEE, deadline: String(Math.floor(Date.now() / 1000) + 3600), signature: "0x1234" }),
    );
    await userEvent.click(within(panel).getByRole("button", { name: "Load pass" }));
    expect(await within(panel).findByText(/The contract accepts this pass/)).toBeInTheDocument();
    expect(within(panel).getByText(/credits 5 CHKN/)).toBeInTheDocument();
    // No wallet connected: the action stays disabled with an explanation.
    expect(within(panel).getByRole("button", { name: "Submit check-in" })).toBeDisabled();
    expect(within(panel).getByText(/Connect any wallet to submit/)).toBeInTheDocument();
  });
});
