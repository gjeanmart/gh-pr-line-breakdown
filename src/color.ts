// Category colours reach the DOM in three places — the badge on a file header, the swatch in
// the widget, the swatch in the popup — and in all three they used to be interpolated into
// markup or into an inline style unchecked. A colour arriving from an imported config file can
// therefore close the attribute it sits in, or append declarations to the style it sits in.
// Everything goes through safeCssColor() now, which admits hex and nothing else: the options
// page's colour input only ever produces #rrggbb, so no legitimate value is turned away.

/** Used when a category has no colour, or one that is not a plain hex value. */
export const DEFAULT_CATEGORY_COLOR = "#8c959f";

/** GitHub's default ink — the dark option when a badge needs dark text. */
const DARK_TEXT = "#1f2328";
const LIGHT_TEXT = "#ffffff";

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function safeCssColor(value: string | undefined, fallback = DEFAULT_CATEGORY_COLOR): string {
  const trimmed = value?.trim();
  return trimmed && HEX.test(trimmed) ? trimmed : fallback;
}

/**
 * Black or white text for a badge on `background`, whichever has more contrast against it.
 * Badges were always white-on-colour, so a pale category colour — and the colour picker
 * happily offers white — produced an unreadable pill.
 */
export function readableTextColor(background: string): string {
  const rgb = toRgb(safeCssColor(background));
  if (!rgb) return LIGHT_TEXT;

  const bg = relativeLuminance(rgb);
  const ink = relativeLuminance(toRgb(DARK_TEXT)!);

  // WCAG contrast ratio, (lighter + 0.05) / (darker + 0.05), for each candidate
  const againstWhite = 1.05 / (bg + 0.05);
  const againstInk = (bg + 0.05) / (ink + 0.05);

  return againstInk > againstWhite ? DARK_TEXT : LIGHT_TEXT;
}

function toRgb(hex: string): [number, number, number] | null {
  let body = hex.slice(1);
  // #rgb and #rgba shorthands expand by doubling each digit
  if (body.length === 3 || body.length === 4) {
    body = body
      .split("")
      .map((d) => d + d)
      .join("");
  }
  if (body.length !== 6 && body.length !== 8) return null;

  const value = Number.parseInt(body.slice(0, 6), 16);
  if (Number.isNaN(value)) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}
