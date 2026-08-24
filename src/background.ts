// The extension's only background work: opening the options page on request.
//
// chrome.runtime.openOptionsPage is not available to content scripts, and the widget needs to
// offer it — a rate-limit message that cannot take you to the token field is a dead end. The
// content script sends a message, this answers it.

chrome.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: string } | null)?.type === "openOptions") {
    void chrome.runtime.openOptionsPage();
  }
});
