// The filename → file header map, and the contract that goes with it.
//
// This map is the seam between three modules: badges.ts populates it while injecting badges,
// the category filter reads it to find files to collapse, and collapse.ts works outward from
// whatever it holds. Three separate bugs have come from those callers disagreeing about what
// "the header" is, so the contract is written here rather than assumed:
//
//   1. The element is somewhere INSIDE the file's header row. It is usually NOT the row
//      itself — findHeaderContainer stops at the first ancestor whose class matches
//      DiffFileHeader-module__*, which is normally the inner file-path section.
//   2. It always contains the file name. Anything anchored to the name (the badge) can be
//      placed relative to it and will stay inside this element.
//   3. It does NOT necessarily contain the header's action buttons. The collapse chevron
//      lives in a sibling of the path section, so anything looking for a control must climb
//      out — see collapse.ts, which does exactly that.
//   4. Entries go stale. GitHub re-renders headers constantly; a stored element may be
//      detached. Callers should tolerate that rather than assume liveness, and the next
//      injection pass refreshes the entry.
//
// The three bugs, for anyone tempted to simplify this away: the eye icon did nothing at all
// in v0.1.6 (looked for the chevron inside the stored element — rule 3), the badge sat on
// different sides of the file name depending on whether the file was expanded in v0.1.7
// (positioned relative to buttons that come and go — rules 1 and 3), and every pass added
// another badge in v0.1.8 (placed the badge outside the stored element, so the
// already-badged check could not see it — rule 2).

const headers = new Map<string, HTMLElement>();

/** Files this extension collapsed, so it never expands one the user had collapsed. */
const collapsedByUs = new Set<string>();

export function rememberHeader(filename: string, header: HTMLElement): void {
  headers.set(filename, header);
}

export function headerFor(filename: string): HTMLElement | undefined {
  return headers.get(filename);
}

/** How many files we currently know a header for — used to decide if a pass can be skipped. */
export function knownHeaderCount(): number {
  return headers.size;
}

export function markCollapsedByUs(filename: string): void {
  collapsedByUs.add(filename);
}

export function forgetCollapsedByUs(filename: string): void {
  collapsedByUs.delete(filename);
}

export function wasCollapsedByUs(filename: string): boolean {
  return collapsedByUs.has(filename);
}

export function filesCollapsedByUs(): string[] {
  return Array.from(collapsedByUs);
}

/** Navigating to another PR invalidates everything here. */
export function forgetAllHeaders(): void {
  headers.clear();
  collapsedByUs.clear();
}
