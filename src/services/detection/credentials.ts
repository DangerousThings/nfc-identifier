/**
 * Credential Sweep
 *
 * A single card can present several credential interfaces at once. A JCOP
 * part provisioned for access control may expose a MIFARE Classic emulation,
 * a DESFire applet, and its own GlobalPlatform ISD simultaneously — a reader
 * sees whichever one it asks for. The old model (one chip type → one
 * capability list) couldn't express that, so this module probes for all of
 * them and returns the full set.
 *
 * **Probe order is load-bearing.** The ISD SELECT changes the card's selected
 * application, and DESFire GetVersion is routed to whatever is selected, so
 * DESFire must be probed first and the ISD last:
 *
 *   1. Layer 3 GetVersion (0x60)     — Classic substrate      (caller-supplied)
 *   2. DESFire GetVersion (90 60)    — DESFire presence + EV level
 *   3. Plus historical-byte match    — passive, no I/O
 *   4. GP ISD SELECT + GET_CPLC      — part identity
 *
 * Every probe is best-effort: a failure means "not present", never an error.
 */

import {
  ChipType,
  CHIP_NAMES,
  type DetectedCredential,
  type Transponder,
} from '../../types/detection';
import {
  DESFIRE_GET_VERSION_CONTINUE,
  parseApduResponse,
  sendIsoDepCommand,
} from '../nfc/commands';
import {detectDesfire} from './desfire';
import {matchPlusHistoricalSignature} from './mifare';
import {selectIsdAndReadCplc, type IsdProbeResult} from './cplc';

/**
 * Which credential kind a GetVersion-reported chip type represents.
 *
 * A JavaCard can answer DESFire GetVersion with a *Plus* family byte (a Plus
 * emulation), so the kind must follow the chip type, not the probe that
 * found it. Everything DESFire-shaped (incl. NTAG DNA, which speaks the
 * DESFire command set) maps to `desfire`.
 */
function credentialKindForChipType(
  chipType: ChipType,
): DetectedCredential['kind'] {
  switch (chipType) {
    case ChipType.MIFARE_PLUS_S:
    case ChipType.MIFARE_PLUS_X:
    case ChipType.MIFARE_PLUS_SE:
    case ChipType.MIFARE_PLUS_EV1:
    case ChipType.MIFARE_PLUS_EV2:
    case ChipType.MIFARE_PLUS:
      return 'mifare-plus';
    default:
      return 'desfire';
  }
}

/** DESFire chip types that represent a genuine DESFire credential. */
const DESFIRE_CHIP_TYPES: ChipType[] = [
  ChipType.DESFIRE_EV1,
  ChipType.DESFIRE_EV2,
  ChipType.DESFIRE_EV3,
  ChipType.DESFIRE_EV3C,
  ChipType.DESFIRE_LIGHT,
  ChipType.DESFIRE_UNKNOWN,
];

/**
 * Maximum `90 AF` continuation frames to drain before giving up.
 *
 * DESFire GetVersion is a three-frame exchange and `detectDesfire` reads only
 * the first two, leaving the chain open. An open chain makes the subsequent
 * ISD SELECT fail, so we drain it. Three is the real frame count; the bound
 * exists so a misbehaving card can't spin us.
 */
const MAX_CHAIN_DRAIN_FRAMES = 4;

export interface CredentialSweepResult {
  credentials: DetectedCredential[];
  /** ISD probe outcome, including CPLC when readable. */
  isd: IsdProbeResult;
  /**
   * Chip type the sweep concluded, when it differs from what the calling
   * branch determined on its own. Currently only set for the EV3C promotion.
   */
  promotedChipType?: ChipType;
  /** Storage size from the DESFire probe, when one answered. */
  desfireStorageSize?: number;
  /** DESFire version info, for callers that had none. */
  desfireVersionInfo?: Transponder['versionInfo'];
}

/**
 * Drain any open DESFire command chain so a following SELECT can succeed.
 *
 * Sends `90 AF` until the card stops asking for continuation (SW2 != 0xAF)
 * or the frame bound is hit. Silent on every failure — if the card has no
 * open chain it simply errors, which is the outcome we want anyway.
 */
async function drainDesfireChain(): Promise<void> {
  for (let i = 0; i < MAX_CHAIN_DRAIN_FRAMES; i++) {
    try {
      const response = await sendIsoDepCommand(DESFIRE_GET_VERSION_CONTINUE);
      const parsed = parseApduResponse(response);
      if (parsed.sw2 !== 0xaf) {
        return;
      }
    } catch {
      // No open chain, or the card refused — either way we're done.
      return;
    }
  }
}

/**
 * Probe for a DESFire credential via ISO-wrapped GetVersion.
 *
 * Returns the credential plus the detection details, or `null` when the card
 * has no DESFire interface. Note this runs `detectDesfire` even on cards the
 * caller already typed as MIFARE Classic — that's the whole point: a Classic
 * SAK card that answers DESFire GetVersion is an EV3C-shaped card.
 */
async function probeDesfireCredential(): Promise<{
  credential: DetectedCredential;
  chipType: ChipType;
  storageSize?: number;
  versionInfo?: Transponder['versionInfo'];
} | null> {
  let result;
  try {
    result = await detectDesfire();
  } catch {
    return null;
  }

  if (!result.success || !result.chipType) {
    return null;
  }

  if (!DESFIRE_CHIP_TYPES.includes(result.chipType)) {
    // GetVersion answered, but with a non-DESFire family (NTAG DNA, Plus
    // EV2, DUOX...). Those are handled by their own branches; recording them
    // as a "DESFire credential" here would be wrong.
    return null;
  }

  const substrate =
    result.implementation === 'javacard_emulation' ||
    result.implementation === 'smartmx_emulation'
      ? 'smartcard'
      : result.implementation === 'native'
        ? 'native'
        : 'unknown';

  const byte1 =
    result.implementationByte !== undefined
      ? `0x${result.implementationByte.toString(16).padStart(2, '0')}`
      : 'n/a';

  return {
    credential: {
      kind: 'desfire',
      label: CHIP_NAMES[result.chipType],
      substrate,
      confidence: result.chipType === ChipType.DESFIRE_UNKNOWN ? 'medium' : 'high',
      evidence: `DESFire GetVersion (byte1=${byte1})`,
    },
    chipType: result.chipType,
    storageSize: result.storageSize,
    versionInfo: result.versionInfo,
  };
}

/**
 * Build the MIFARE Classic credential for a card the caller already typed as
 * Classic. `substrate` comes from the caller's Layer 3 GetVersion probe,
 * which has already run by the time the sweep starts.
 */
function classicCredential(
  chipType: ChipType,
  implementation: Transponder['implementation'],
  sak: number | undefined,
): DetectedCredential {
  const substrate =
    implementation === 'javacard_emulation' ||
    implementation === 'smartmx_emulation'
      ? 'smartcard'
      : implementation === 'native'
        ? 'native'
        : 'unknown';

  return {
    kind: 'mifare-classic',
    label: CHIP_NAMES[chipType],
    substrate,
    confidence: 'high',
    evidence:
      sak !== undefined
        ? `SAK 0x${sak.toString(16).padStart(2, '0')}`
        : 'MifareClassic tech type',
  };
}

/**
 * Decide whether a Classic + DESFire pairing warrants the EV3C promotion.
 *
 * Per NXP naming, the "C" in EV3C is for Classic: it's an EV3 that also
 * carries a MIFARE Classic credential. We only promote for EV3 specifically —
 * an EV1 or EV2 alongside Classic emulation is a different (and rarer)
 * animal, and we'd be inventing a name for it.
 */
function shouldPromoteToEv3C(
  hasClassic: boolean,
  desfireChipType: ChipType | undefined,
): boolean {
  return hasClassic && desfireChipType === ChipType.DESFIRE_EV3;
}

/**
 * Run the full credential sweep on an ISO-DEP capable card.
 *
 * @param options.knownClassicChipType  Classic type the caller already
 *   determined (from SAK or the MifareClassic tech), if any.
 * @param options.classicImplementation Substrate from the caller's Layer 3
 *   GetVersion probe.
 * @param options.knownDesfire          DESFire result the caller already has,
 *   so branch 4a doesn't re-probe.
 * @param options.historicalBytes       For the passive Plus signature match.
 * @param options.sak                   For credential evidence strings.
 */
export async function runCredentialSweep(options: {
  knownClassicChipType?: ChipType;
  classicImplementation?: Transponder['implementation'];
  knownDesfire?: {
    chipType: ChipType;
    implementation?: Transponder['implementation'];
    implementationByte?: number;
  };
  historicalBytes?: string;
  sak?: number;
  /** Skip the DESFire probe (caller already ran it and it failed). */
  skipDesfireProbe?: boolean;
}): Promise<CredentialSweepResult> {
  const credentials: DetectedCredential[] = [];
  let desfireChipType: ChipType | undefined;
  let desfireStorageSize: number | undefined;
  let desfireVersionInfo: Transponder['versionInfo'];

  // --- 1. MIFARE Classic (already determined by the caller) ---------------
  const hasClassic = options.knownClassicChipType !== undefined;
  if (options.knownClassicChipType) {
    credentials.push(
      classicCredential(
        options.knownClassicChipType,
        options.classicImplementation,
        options.sak,
      ),
    );
  }

  // --- 2. DESFire ---------------------------------------------------------
  if (options.knownDesfire) {
    // Caller already probed — reuse rather than replaying the exchange.
    desfireChipType = options.knownDesfire.chipType;
    const impl = options.knownDesfire.implementation;
    const byte1 =
      options.knownDesfire.implementationByte !== undefined
        ? `0x${options.knownDesfire.implementationByte.toString(16).padStart(2, '0')}`
        : 'n/a';
    credentials.push({
      kind: credentialKindForChipType(desfireChipType),
      label: CHIP_NAMES[desfireChipType],
      substrate:
        impl === 'javacard_emulation' || impl === 'smartmx_emulation'
          ? 'smartcard'
          : impl === 'native'
            ? 'native'
            : 'unknown',
      confidence: desfireChipType === ChipType.DESFIRE_UNKNOWN ? 'medium' : 'high',
      evidence: `GetVersion (byte1=${byte1})`,
    });
  } else if (!options.skipDesfireProbe) {
    const probe = await probeDesfireCredential();
    if (probe) {
      credentials.push(probe.credential);
      desfireChipType = probe.chipType;
      desfireStorageSize = probe.storageSize;
      desfireVersionInfo = probe.versionInfo;
    }
  }

  // --- 3. MIFARE Plus (passive — historical bytes only) -------------------
  const plusMatch = matchPlusHistoricalSignature(options.historicalBytes);
  if (plusMatch) {
    credentials.push({
      kind: 'mifare-plus',
      label: CHIP_NAMES[plusMatch.chipType],
      detail: `SL${plusMatch.securityLevel}`,
      substrate: 'native',
      confidence: 'high',
      evidence: 'AN10833 historical-byte signature',
    });
  }

  // --- 4. GlobalPlatform ISD + CPLC (last — changes selection state) ------
  // Drain the DESFire command chain, but only if a DESFire probe actually
  // ran — `detectDesfire` reads frames 1 and 2 of a three-frame exchange and
  // leaves the chain open, which would make the SELECT below fail. On a card
  // with no DESFire interface there's no chain, and sending a stray 90 AF
  // before the SELECT would be pointless traffic at best.
  if (desfireChipType !== undefined) {
    await drainDesfireChain();
  }
  const isd = await selectIsdAndReadCplc();

  if (isd.isdSelected) {
    credentials.push({
      kind: 'javacard',
      label: isd.icTypeName
        ? `JavaCard (${isd.icTypeName})`
        : 'JavaCard / GlobalPlatform',
      detail: isd.osName,
      substrate: 'smartcard',
      confidence: 'high',
      evidence: isd.cplc
        ? `ISD SELECT + CPLC (IC 0x${isd.cplc.icType.toString(16)})`
        : 'ISD SELECT 9000',
    });
  }

  // Substrate fixup. The ISD result only lands at step 4, but it's decisive:
  // a card whose ISD answers is hosting its credentials on a smart card.
  // Credentials GetVersion already typed are left alone — byte 1 is the more
  // specific evidence. This only fills in the ones we couldn't type.
  //
  // A native DESFire EV3C has no ISD, so nothing is upgraded and its
  // credentials stay as GetVersion reported them.
  if (isd.isdSelected) {
    for (const credential of credentials) {
      if (credential.kind !== 'javacard' && credential.substrate === 'unknown') {
        credential.substrate = 'smartcard';
      }
    }
  }

  // Promotion is independent of the ISD: Classic + DESFire EV3 is an EV3C
  // whether it's genuine NXP silicon or a smart card hosting both credentials.
  // The ISD result distinguishes those two cases via `implementation`, not by
  // changing what the card is.
  const promotedChipType = shouldPromoteToEv3C(hasClassic, desfireChipType)
    ? ChipType.DESFIRE_EV3C
    : undefined;

  if (promotedChipType) {
    console.log(
      '[credentials] Classic + DESFire EV3 → promoting to DESFire EV3C',
    );
  }

  console.log(
    '[credentials] Sweep found:',
    credentials.map(c => `${c.kind}:${c.label}`),
  );

  return {
    credentials,
    isd,
    promotedChipType,
    desfireStorageSize,
    desfireVersionInfo,
  };
}

/**
 * Build the credential list for a card identified through the JavaCard
 * branch, without re-running any probes.
 *
 * That branch reaches its conclusion via `detectJavaCard` rather than the
 * sweep, but the card can still be carrying a MIFARE Classic credential —
 * a SAK 0x28 card with an ISD and no DESFire interface is Classic emulation
 * on a smart card, and dropping the Classic credential would hide the very
 * thing the user needs to see.
 */
export function credentialsForJavaCard(options: {
  sak?: number;
  classicChipType?: ChipType;
  icTypeName?: string;
  osName?: string;
  isdSelected: boolean;
}): DetectedCredential[] {
  const credentials: DetectedCredential[] = [];

  if (options.classicChipType) {
    credentials.push({
      kind: 'mifare-classic',
      label: CHIP_NAMES[options.classicChipType],
      substrate: 'smartcard',
      confidence: 'high',
      evidence:
        options.sak !== undefined
          ? `SAK 0x${options.sak.toString(16).padStart(2, '0')} with GlobalPlatform ISD`
          : 'Classic SAK with GlobalPlatform ISD',
    });
  }

  if (options.isdSelected) {
    credentials.push({
      kind: 'javacard',
      label: options.icTypeName
        ? `JavaCard (${options.icTypeName})`
        : 'JavaCard / GlobalPlatform',
      detail: options.osName,
      substrate: 'smartcard',
      confidence: 'high',
      evidence: 'ISD SELECT 9000',
    });
  }

  return credentials;
}

/**
 * The credential kind that corresponds to a chip type's headline identity.
 *
 * Used to work out which credentials are *extra* — a DESFire EV3C's DESFire
 * credential is simply what the card is, while its Classic credential is an
 * emulation worth calling out.
 */
function primaryCredentialKind(
  chipType: ChipType | undefined,
): DetectedCredential['kind'] | undefined {
  switch (chipType) {
    case ChipType.MIFARE_CLASSIC_1K:
    case ChipType.MIFARE_CLASSIC_4K:
    case ChipType.MIFARE_CLASSIC_MINI:
      return 'mifare-classic';
    case ChipType.MIFARE_PLUS_S:
    case ChipType.MIFARE_PLUS_X:
    case ChipType.MIFARE_PLUS_SE:
    case ChipType.MIFARE_PLUS_EV1:
    case ChipType.MIFARE_PLUS_EV2:
    case ChipType.MIFARE_PLUS:
      return 'mifare-plus';
    case ChipType.DESFIRE_EV1:
    case ChipType.DESFIRE_EV2:
    case ChipType.DESFIRE_EV3:
    case ChipType.DESFIRE_EV3C:
    case ChipType.DESFIRE_LIGHT:
    case ChipType.DESFIRE_UNKNOWN:
      return 'desfire';
    case ChipType.JCOP4:
    case ChipType.JAVACARD_UNKNOWN:
      return 'javacard';
    default:
      return undefined;
  }
}

/**
 * Credentials the card exposes *in addition to* its headline identity — what
 * the "Emulation Supported" UI block lists.
 *
 * Filtering is by credential kind rather than substrate, because emulation
 * and substrate are independent. A DESFire EV3C is genuine NXP silicon, not a
 * smart card pretending to be a DESFire, yet it really does emulate MIFARE
 * Classic — the "C" is exactly that. Keying off `substrate !== 'native'`
 * would wrongly hide the Classic credential on a native EV3C.
 */
export function emulatedCredentials(
  credentials: DetectedCredential[] | undefined,
  chipType?: ChipType,
): DetectedCredential[] {
  if (!credentials) {
    return [];
  }
  const primary = primaryCredentialKind(chipType);
  return credentials.filter(c => {
    // The GlobalPlatform platform itself is what the card *is*, never an
    // emulation.
    if (c.kind === 'javacard') {
      return false;
    }
    return c.kind !== primary;
  });
}
