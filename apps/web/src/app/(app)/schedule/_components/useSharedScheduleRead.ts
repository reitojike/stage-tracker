"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { UserId } from "@stage-tracker/domain";
import { readSharedScheduleAction } from "@/lib/actions/schedule/shared-schedule-read-actions";

type Input = Parameters<typeof readSharedScheduleAction>[0];
type Snapshot = NonNullable<
  Awaited<ReturnType<typeof readSharedScheduleAction>>
>["data"];
type State =
  | {
      readonly version: number;
      readonly status:
        "checking" | "error" | "unavailable" | "identity-changed";
    }
  | {
      readonly version: number;
      readonly status: "ready";
      readonly data: NonNullable<Snapshot>;
    };

/** No cached shared data is trusted on mount/re-entry. The explicit read promise
 * supplies the result; transition completion and HTTP status are not permission.
 * A local request version only ignores late replies (it never authorizes reads). */
export function useSharedScheduleRead(
  input: Input,
  actorId: UserId,
  scope = "",
) {
  const host = useRef<HTMLDivElement>(null);
  const version = useRef(0);
  const retry = useRef<() => void>(() => {});
  const [state, setState] = useState<State>({ version: 0, status: "checking" });
  const entryId = input.kind === "detail" ? input.entryId : undefined;
  const kind = input.kind;

  useLayoutEffect(() => {
    let frame: number | undefined;
    const active = () =>
      document.visibilityState === "visible" &&
      host.current !== null &&
      host.current.getClientRects().length > 0;
    function invalidate(synchronous: boolean) {
      const next = ++version.current;
      // Also masks a retained Activity/Document before it can paint. The next
      // committed checking state restores the owner's-only projection below.
      if (host.current) host.current.style.visibility = "hidden";
      const update = () => setState({ version: next, status: "checking" });
      if (synchronous) flushSync(update);
      else update();
      return next;
    }
    async function read(synchronous = false) {
      const request = invalidate(synchronous);
      if (!active()) return;
      try {
        const result = await readSharedScheduleAction(
          kind === "detail" && entryId ? { kind, entryId } : { kind: "list" },
        );
        if (request !== version.current || !active()) return;
        if (!result?.data) {
          setState({
            version: request,
            status:
              result?.serverError?.kind === "unauthenticated" ||
              result?.serverError?.kind === "permission-denied"
                ? "unavailable"
                : "error",
          });
        } else if (result.data.actorId !== actorId) {
          setState({ version: request, status: "identity-changed" });
        } else {
          setState({ version: request, status: "ready", data: result.data });
        }
      } catch {
        if (request === version.current && active())
          setState({ version: request, status: "error" });
      }
    }
    function resume() {
      invalidate(true);
      if (frame !== undefined) cancelAnimationFrame(frame);
      // A frame callback observes the restored route, not an elapsed-time guess.
      frame = requestAnimationFrame(() => {
        frame = undefined;
        void read();
      });
    }
    function away() {
      invalidate(true);
    }
    function visibility() {
      if (document.visibilityState === "visible") resume();
      else away();
    }
    function pageshow(event: PageTransitionEvent) {
      if (event.persisted) resume();
    }
    retry.current = () => {
      void read(true);
    };
    void read();
    window.addEventListener("popstate", resume);
    window.addEventListener("pagehide", away);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("blur", away);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      ++version.current;
      if (host.current) host.current.style.visibility = "hidden";
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("popstate", resume);
      window.removeEventListener("pagehide", away);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [actorId, kind, entryId, scope]);

  useLayoutEffect(() => {
    if (state.version === version.current && host.current)
      host.current.style.removeProperty("visibility");
  }, [state]);
  return { host, state, retry: () => retry.current() };
}
