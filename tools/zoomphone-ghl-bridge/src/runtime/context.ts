import type { ExecCtx } from "./types";

// Background work scheduled via `waitUntil` runs detached; we just make sure a
// rejection is logged instead of becoming an unhandledRejection. The process
// stays alive, so there is nothing to keep open (unlike on Workers).
export function createExecCtx(onError: (err: unknown) => void = (e) => console.error("[waitUntil]", e)): ExecCtx {
  return {
    waitUntil(promise: Promise<unknown>): void {
      Promise.resolve(promise).catch(onError);
    },
  };
}
