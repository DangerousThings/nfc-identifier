/**
 * Official Dangerous Things product detection via ATS historical bytes.
 *
 * DT batches its smart card products with a fixed ASCII string written into
 * the ATS historical bytes (via the JCOP4Params applet). Reading it back is a
 * positive, high-confidence signal that the card is a genuine DT product —
 * and, for implants, it's the tiebreaker that finally separates a flexSecure
 * from a bare J3R180 (they share silicon and storage size; only the
 * historical bytes differ).
 *
 * Signature source: open_smartcard_batching `main.py` `hist_bytes` map.
 *
 *   JDNGRfS180 → flexSecure        (implant, J3R180 silicon)
 *   JDNGRfS452 → flexSecure 452    (implant, J3R452 silicon)
 *   J3R180DNGR → J3R180 card       (regular card, J3R180 silicon)
 *   J3R452DNGR → J3R452 card       (regular card, J3R452 silicon)
 */

export interface DtProductMatch {
  /** Product display name, e.g. "flexSecure" or "J3R452". */
  name: string;
  /** Implant (installable) vs a regular card. */
  kind: 'implant' | 'card';
  /** The ASCII token that matched, for evidence/logging. */
  signature: string;
}

/**
 * `JDNGRfS180` / `JDNGRfS452` — the DT marker followed by a product code.
 * `fS` is flexSecure; the digits are the chip family it's built on. The model
 * is optional (some cards carry the marker without one). Matches implants.
 */
const DT_PRODUCT_PATTERN = /^J?DNGR(fS)(\d{3})?$/i;

/**
 * `J3R452DNGR` / `J3R180DNGR` — the chip name followed by the DT marker. The
 * card is ours but is named after the silicon rather than a product. Matches
 * regular cards.
 */
const DT_CHIP_PATTERN = /^(J3R\d{3})DNGR$/i;

/**
 * flexSecure display name for a matched product model.
 *
 * The original flexSecure (built on J3R180) is branded plainly "flexSecure";
 * later silicon carries the number, e.g. "flexSecure 452".
 */
function flexSecureName(model: string | undefined): string {
  return !model || model === '180' ? 'flexSecure' : `flexSecure ${model}`;
}

/**
 * Split the decoded historical bytes into runs of printable ASCII (0x20–0x7E),
 * so a category-indicator/status byte around the identity string doesn't
 * defeat the anchored match.
 */
function printableTokens(hex: string): string[] {
  const clean = hex.replace(/[:\s-]/g, '');
  const tokens: string[] = [];
  let current = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 0x20 && code <= 0x7e) {
      current += String.fromCharCode(code);
    } else if (current) {
      tokens.push(current);
      current = '';
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Match a tag's ATS historical bytes against the official DT identity patterns.
 *
 * Mirrors the reference app (`global platform mobile`): each printable-ASCII run
 * is anchor-matched against the product and chip patterns, so new models
 * (a future `J3R###`, or the marker without a model) match with no code change.
 * Returns `undefined` when no official identity is present.
 */
export function matchDtHistoricalSignature(
  historicalBytes: string | undefined,
): DtProductMatch | undefined {
  if (!historicalBytes) {
    return undefined;
  }

  for (const token of printableTokens(historicalBytes)) {
    const product = token.match(DT_PRODUCT_PATTERN);
    if (product) {
      return {
        name: flexSecureName(product[2]),
        kind: 'implant',
        signature: token,
      };
    }
    const chip = token.match(DT_CHIP_PATTERN);
    if (chip) {
      return {
        name: chip[1].toUpperCase(),
        kind: 'card',
        signature: token,
      };
    }
  }
  return undefined;
}
