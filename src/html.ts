// Escaping for the three places that build markup as strings: the widget's shadow root, the
// popup, and the options page. Each used to carry its own copy, and they had already drifted —
// the options page escaped quotes because it writes attribute values, the other two did not.

/** For text between tags. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** For a value inside a double-quoted attribute — also escapes the quotes. */
export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
