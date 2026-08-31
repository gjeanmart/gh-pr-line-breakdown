// Tracing for the one thing unit tests cannot reach: how the collapse filter behaves against
// GitHub's live markup.
//
// This logs from inside the real code path rather than from a copy of it. A standalone
// console script was tried and deleted — it reimplemented the logic it was meant to explain,
// and was reporting the wrong answer within two commits, because the code moved and the copy
// did not. Instrumentation that ships with the thing it describes cannot drift.
//
// Turn it on in the page console, then reload:
//   localStorage.setItem("glb-debug", "1")
// and off again with:
//   localStorage.removeItem("glb-debug")

let enabled: boolean | null = null;

export function debugEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem("glb-debug") === "1";
    } catch {
      // Storage can throw outright when a page's settings block it
      enabled = false;
    }
  }
  return enabled;
}

export function debug(...args: unknown[]): void {
  if (debugEnabled()) console.log("[line-breakdown]", ...args);
}
