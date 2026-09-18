/**
 * JavaCard product identity (pure).
 *
 * Interprets the CPLC-derived silicon name, installed-applet labels, Fidesmo
 * fingerprint, and JavaCard Memory storage figures into a product name +
 * evidence trail. This is pure, side-effect-free interpretation — it does not
 * transceive; callers gather the signals (the detector historically, and now
 * the identify() adapter) and hand them in.
 *
 * Re-homed here (from the old `detector.ts`, phase 5 task 5) so it survives the
 * detector's removal in task 6.
 */

import {
  type IdentityEvidence,
  type ProductKind,
  type Transponder,
} from '../../types/detection';

/**
 * Persistent-memory baseline reported by the JavaCard Memory applet's
 * `persistentTotal` field, with a ±256-byte tolerance for reporting quirks.
 *
 * - J3R180      → 167736 bytes (0x00028F38), the bare silicon capacity;
 *                 note this is *also* what a flexSecure reports, because a
 *                 flexSecure **is** a J3R180. Storage size therefore cannot
 *                 separate the two.
 *
 * - Apex        → 84336 bytes (0x00014970), and
 * - Apex 2      → 311852 bytes (0x0004C22C), what a Fidesmo-provisioned
 *                 J3R180 / J3R452 reports once the platform has taken its
 *                 share.
 *
 * The two Apex figures are install profiles, **not** generation baselines: on
 * a Fidesmo device the *total* is set during the Fidesmo install, not just
 * `persistentFree`. A converted Apex 2 ring on the same 0xD600 silicon has
 * been measured at 162028 bytes (2026-08-22). So the generation comes from
 * the CPLC IC type — fixed in the mask ROM — and these are consulted only as
 * a fallback when CPLC is unreadable. See `APEX_GENERATION_BY_IC_TYPE`.
 */
const APEX_PERSISTENT_TOTAL = 84336;
const APEX2_PERSISTENT_TOTAL = 311852;
const J3R180_PERSISTENT_TOTAL = 167736;
const STORAGE_MATCH_TOLERANCE = 256;

function storageMatches(
  persistentTotal: number | undefined,
  baseline: number,
): boolean {
  if (persistentTotal === undefined) {
    return false;
  }
  return Math.abs(persistentTotal - baseline) <= STORAGE_MATCH_TOLERANCE;
}

/**
 * Fallback generation guess from `persistentTotal`, for cards whose CPLC
 * wouldn't answer. Install-profile figures — see the baselines above — so
 * this is only consulted after the IC type has come up empty.
 */
function apexGenerationFromStorage(persistentTotal?: number): string | undefined {
  if (storageMatches(persistentTotal, APEX_PERSISTENT_TOTAL)) {
    return 'Apex';
  }
  if (storageMatches(persistentTotal, APEX2_PERSISTENT_TOTAL)) {
    return 'Apex 2';
  }
  return undefined;
}

function isJ3R180StorageSize(persistentTotal?: number): boolean {
  return storageMatches(persistentTotal, J3R180_PERSISTENT_TOTAL);
}

/**
 * Apex generation, keyed by the CPLC IC Type name (see `JCOP_IC_TYPES` in
 * cplc.ts):
 *
 * - `J3R180` → IC Type 0xD321 → Apex
 * - `J3R452` → IC Type 0xD600 → Apex 2
 *
 * Only consulted alongside the Fidesmo fingerprint. Names a generation and
 * never a form factor — a flex and a ring share silicon. A payment applet is
 * the one signal that pins the form factor, and appends " Ring".
 */
const APEX_GENERATION_BY_IC_TYPE: Record<string, string> = {
  J3R180: 'Apex',
  J3R452: 'Apex 2',
};

/** What `getJavacardImplantName` concluded, and the evidence behind it. */
export interface ImplantIdentity {
  name?: string;
  /**
   * Always set when `name` is — `'unknown'` where the signals name a product
   * but not its form factor, so a caller can never mistake "we didn't say"
   * for "it's an implant".
   */
  kind?: ProductKind;
  evidence: IdentityEvidence[];
}

/**
 * Determine what to call a JavaCard, and record why.
 *
 * The important constraint is what the available signals *can't* do. CPLC IC
 * Type `0xD321` (J3R180) is shared by both the Apex and the flexSecure, and
 * a flexSecure reports the same 167736-byte `persistentTotal` as any other
 * J3R180 — or none at all, when the memory applet isn't installed. So:
 *
 * - Apex is identifiable: 84336 bytes *plus* the Fidesmo fingerprint, two
 *   independent signals agreeing.
 * - flexSecure is **not** identifiable from these signals alone. We report
 *   the silicon ("J3R180") and let the product matcher offer flexSecure as
 *   one of several J3R180 products, rather than asserting it here.
 *
 * The DT historical-byte signature breaks that tie, but only on cards batched
 * since it existed (`matchDtHistoricalSignature`, applied centrally in
 * `createTransponder`). A legacy J3R180 has no signature, so the 167736-byte
 * baseline is all there is — silicon, never a product name.
 *
 * Silicon identity (J3R180 / J3R452, from CPLC) is surfaced in the header,
 * not here — this function names *products*, and returns undefined when only
 * the part is known.
 *
 * - Fidesmo + payment + D321       → "Apex Ring"
 * - Fidesmo + payment + D600       → "Apex 2 Ring"
 * - Payment applets                → "<Network> Payment Card" (not an implant)
 * - Fidesmo + Apex storage         → "Apex" / "Apex 2" (generation only —
 *   storage size can't tell a ring from a flex)
 * - Fidesmo + other storage        → "Fidesmo Wearable"
 * - CPLC IC type known             → undefined (silicon shown in header)
 * - JavaCard Memory + J3R180 size  → "J3R180" only when CPLC couldn't be read
 *   (no header identity otherwise) — still not a product claim
 * - Otherwise                      → undefined (generic JavaCard)
 */
export function getJavacardImplantName(
  installedApplets?: string[],
  isFidesmo?: boolean,
  storageInfo?: Transponder['storageInfo'],
  icTypeName?: string,
): ImplantIdentity {
  const evidence: IdentityEvidence[] = [];
  const applets = installedApplets ?? [];

  if (applets.length === 0 && !icTypeName) {
    return {evidence};
  }

  const persistentTotal = storageInfo?.persistentTotal;
  const fidesmoDetected = isFidesmo || applets.includes('Fidesmo');

  if (applets.includes('Payment (PPSE)')) {
    const network = applets.find(a =>
      ['Visa', 'Mastercard', 'American Express', 'Discover', 'Maestro'].includes(
        a,
      ),
    );

    // A Fidesmo device carrying a payment applet is an Apex ring with a
    // payment credential loaded, not a bare payment card. The silicon
    // separates the generations: J3R180 (0xD321) is the Apex, J3R452
    // (0xD600) the Apex 2.
    const apexGeneration = fidesmoDetected
      ? APEX_GENERATION_BY_IC_TYPE[icTypeName ?? '']
      : undefined;
    if (apexGeneration) {
      evidence.push({
        source: 'applet-set',
        matched: true,
        note: `Fidesmo fingerprint present with payment applet${
          network ? ` (${network})` : ''
        }`,
      });
      evidence.push({
        source: 'cplc-ic-type',
        matched: true,
        note: `CPLC IC Type identifies ${icTypeName} silicon`,
      });
      return {name: `${apexGeneration} Ring`, kind: 'wearable', evidence};
    }

    evidence.push({
      source: 'applet-set',
      matched: true,
      note: `Payment applet present${network ? ` (${network})` : ''}`,
    });
    return {
      name: network ? `${network} Payment Card` : 'Payment Card',
      kind: 'payment-card',
      evidence,
    };
  }

  if (icTypeName) {
    evidence.push({
      source: 'cplc-ic-type',
      matched: true,
      note: `CPLC IC Type identifies ${icTypeName} silicon`,
    });
  }

  if (fidesmoDetected) {
    evidence.push({
      source: 'applet-set',
      matched: true,
      note: 'Fidesmo fingerprint present',
    });

    // IC type first: it's mask-ROM fixed, so it survives any install profile.
    const generation = APEX_GENERATION_BY_IC_TYPE[icTypeName ?? ''];
    if (generation) {
      // The `cplc-ic-type` line above already records the silicon. Generation
      // only — a ring and a flex share it, so the form factor stays unknown.
      return {name: generation, kind: 'unknown', evidence};
    }

    const guessed = apexGenerationFromStorage(persistentTotal);
    if (guessed) {
      evidence.push({
        source: 'persistent-total',
        matched: true,
        note: `CPLC unreadable; ${persistentTotal} bytes is the ${guessed} install profile`,
      });
      return {name: guessed, kind: 'unknown', evidence};
    }

    evidence.push({
      source: 'persistent-total',
      matched: false,
      note:
        persistentTotal === undefined
          ? 'Storage size unavailable'
          : `${persistentTotal} bytes matches no known Apex install profile`,
    });
    return {name: 'Fidesmo Wearable', kind: 'wearable', evidence};
  }

  // No Fidesmo. When CPLC named the silicon, that identity is surfaced in
  // the header (via `cplc.icTypeName`), not as an implant name — the implant
  // row is for actual DT/VK products (Apex, flexSecure, ...), not raw part
  // numbers. So decline to name a product here.
  if (icTypeName) {
    return {evidence};
  }

  if (applets.includes('JavaCard Memory')) {
    if (isJ3R180StorageSize(persistentTotal)) {
      evidence.push({
        source: 'persistent-total',
        matched: true,
        note: `${persistentTotal} bytes matches J3R180 (shared by flexSecure and other J3R180 cards)`,
      });
      evidence.push({
        source: 'historical-bytes',
        matched: false,
        note: 'No DT product signature — legacy J3R180 cards predate it',
      });
      return {name: 'J3R180', kind: 'unknown', evidence};
    }

    evidence.push({
      source: 'persistent-total',
      matched: false,
      note:
        persistentTotal === undefined
          ? 'Storage size unavailable — cannot identify product'
          : `${persistentTotal} bytes matches no known product`,
    });
    return {evidence};
  }

  return {evidence};
}
