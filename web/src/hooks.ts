import { useCallback, useRef, useState } from "react";
import type { Hex } from "viem";
import { describeError, type TxContext } from "./lib/checkin";
import { actionBusy, announce, idleAction, type ActionState } from "./components/ui";

/**
 * Tracks one transaction flow: simulate → sign → pending → mined, or error.
 * `run` receives a status callback compatible with TxContext.onStatus.
 */
export function useAction(onMined?: () => void) {
  const [state, setState] = useState<ActionState>(idleAction);
  const running = useRef(false);

  const run = useCallback(
    async (work: (onStatus: TxContext["onStatus"]) => Promise<Hex | void>, successMessage?: string) => {
      if (running.current) return;
      running.current = true;
      setState({ phase: "simulating" });
      try {
        await work((phase, hash) => setState({ phase, hash }));
        setState((s) => ({ phase: "mined", hash: s.hash }));
        if (successMessage) announce(successMessage);
        onMined?.();
      } catch (error) {
        const message = describeError(error);
        setState({ phase: "error", error: message });
        announce(`Failed: ${message}`);
      } finally {
        running.current = false;
      }
    },
    [onMined],
  );

  const reset = useCallback(() => setState(idleAction), []);
  return { state, run, reset, busy: actionBusy(state) };
}
