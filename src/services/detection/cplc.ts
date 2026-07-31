/**
 * CPLC (Card Production Life Cycle) parsing and GlobalPlatform ISD probing
 *
 * Split out of `javacard.ts` so every detection branch — not just the
 * JavaCard branch — can select the GlobalPlatform Issuer Security Domain
 * and read CPLC. A successful ISD select on a card that presents itself as
 * DESFire, MIFARE Plus, or MIFARE Classic is proof that the credential is
 * hosted on a smart card substrate rather than native silicon.
 *
 * References:
 * - GlobalPlatform Card Specification v2.3, §11.3 (GET DATA)
 * - https://www.openscdp.org/scripts/tutorial/emv/CPLC.html
 */

import {
  GET_CPLC,
  KNOWN_AIDS,
  selectAid,
  sendIsoDepCommand,
  parseApduResponse,
  bytesToHex,
} from '../nfc/commands';

/**
 * CPLC (Card Production Life Cycle) data structure.
 *
 * The full CPLC record is 42 bytes; we decode the leading 20 bytes, which
 * carry everything useful for chip identification.
 */
export interface CPLCData {
  icFabricator: number;
  icType: number;
  osId: number;
  osBuildDate: number;
  icFabricationDate: number;
  icSerialNumber: number;
  icBatchIdentifier: number;
  icModulePackager: number;
  installerIdentifier: number;
  /** Hex of the full CPLC record as returned by the card (tag stripped). */
  raw: string;
}

/**
 * Known IC Fabricator codes (CPLC bytes 0-1).
 */
export const IC_FABRICATORS: Record<number, string> = {
  0x4790: 'NXP Semiconductors',
  0x4180: 'Atmel',
  0x4090: 'Infineon',
  0x3060: 'Renesas',
  0x4250: 'Samsung',
  0x3360: 'STMicroelectronics',
};

/**
 * Known NXP JCOP IC Type codes (CPLC bytes 2-3).
 *
 * This identifies the *silicon*, not the product built on it. Notably
 * `0xD321` (J3R180) is used by both the Apex and flexSecure implants, so it
 * cannot discriminate between them on its own — see `getJavacardImplantName`
 * in the detector, which uses persistent memory size for that.
 */
export const JCOP_IC_TYPES: Record<number, string> = {
  0xd321: 'J3R180',
  0xd600: 'J3R452',
};

/**
 * JCOP platform generation per IC type. The OS-ID field alone can't tell
 * these apart (both report 0x47xx), but the IC type does: J3R180 is a JCOP 4
 * part, J3R452 is JCOP 4.5. This also mirrors the batching tool, which uses
 * different personalization routes for the two generations.
 */
export const JCOP_PLATFORMS: Record<number, string> = {
  0xd321: 'JCOP 4',
  0xd600: 'JCOP 4.5',
};

/**
 * Known JCOP versions based on OS ID patterns (CPLC bytes 4-5).
 */
const JCOP_OS_PATTERNS: Array<{pattern: number; mask: number; name: string}> = [
  {pattern: 0x4791, mask: 0xffff, name: 'JCOP4 J3R180'},
  {pattern: 0x4700, mask: 0xff00, name: 'JCOP4'},
  {pattern: 0x4680, mask: 0xff80, name: 'JCOP3'},
  {pattern: 0x4600, mask: 0xff00, name: 'JCOP2.x'},
];

/**
 * AIDs under which a GlobalPlatform Issuer Security Domain may be reachable.
 *
 * Cards vary: most NXP JCOP parts answer on the canonical Card Manager AID,
 * but some issuers provision the ISD under the GlobalPlatform-registered
 * `A000000151...` instead. We try both before concluding there's no ISD.
 */
const ISD_AIDS: Array<{name: string; aid: number[]}> = [
  {name: 'GP Card Manager', aid: KNOWN_AIDS.cardManager},
  {name: 'GP Security Domain', aid: KNOWN_AIDS.gpSecurityDomain},
];

/**
 * Result of probing for a GlobalPlatform ISD and reading CPLC.
 *
 * `isdSelected: false` covers every failure mode — no ISD, card refused the
 * SELECT, transceive error — because callers treat them identically.
 */
export interface IsdProbeResult {
  /** True when one of the ISD AIDs answered a SELECT with 0x9000. */
  isdSelected: boolean;
  /** Hex of the AID that answered, when `isdSelected`. */
  isdAid?: string;
  /** Parsed CPLC, when the ISD was selected and GET DATA succeeded. */
  cplc?: CPLCData;
  /** Part name from `JCOP_IC_TYPES`, e.g. "J3R180". */
  icTypeName?: string;
  /** Fabricator name from `IC_FABRICATORS`. */
  fabricatorName?: string;
  /** JCOP OS name from the OS ID pattern table. */
  osName?: string;
}

/**
 * Parse a CPLC response into structured data.
 *
 * Accepts the response either with or without the leading `9F 7F <len>` tag.
 * Returns `null` when the record is too short to be a valid CPLC.
 */
export function parseCPLC(data: number[]): CPLCData | null {
  let cplcData = data;

  // Strip the GET DATA tag if the card included it.
  if (data[0] === 0x9f && data[1] === 0x7f) {
    cplcData = data.slice(3);
  }

  if (cplcData.length < 42) {
    return null;
  }

  return {
    icFabricator: (cplcData[0] << 8) | cplcData[1],
    icType: (cplcData[2] << 8) | cplcData[3],
    osId: (cplcData[4] << 8) | cplcData[5],
    osBuildDate: (cplcData[6] << 8) | cplcData[7],
    icFabricationDate: (cplcData[8] << 8) | cplcData[9],
    icSerialNumber:
      ((cplcData[10] << 24) |
        (cplcData[11] << 16) |
        (cplcData[12] << 8) |
        cplcData[13]) >>>
      0,
    icBatchIdentifier: (cplcData[14] << 8) | cplcData[15],
    icModulePackager: (cplcData[16] << 8) | cplcData[17],
    installerIdentifier: (cplcData[18] << 8) | cplcData[19],
    raw: bytesToHex(cplcData.slice(0, 42)),
  };
}

/** Map a CPLC IC Type to a known NXP part name, if we recognise it. */
export function identifyIcType(icType: number): string | undefined {
  return JCOP_IC_TYPES[icType];
}

/** Map a CPLC IC Type to its JCOP platform generation, if known. */
export function identifyJcopPlatform(icType: number): string | undefined {
  return JCOP_PLATFORMS[icType];
}

/** Map a CPLC IC Fabricator code to a vendor name. */
export function identifyFabricator(icFabricator: number): string {
  return (
    IC_FABRICATORS[icFabricator] ||
    `Unknown (0x${icFabricator.toString(16).padStart(4, '0')})`
  );
}

/** Identify the JCOP OS generation from the CPLC OS ID. */
export function identifyJcopVersion(osId: number): string | undefined {
  for (const entry of JCOP_OS_PATTERNS) {
    if ((osId & entry.mask) === entry.pattern) {
      return entry.name;
    }
  }
  return undefined;
}

/**
 * Select the GlobalPlatform ISD and read CPLC.
 *
 * **Ordering matters:** this changes the card's selected application, so any
 * probe that relies on the default/implicit selection — notably DESFire
 * GetVersion, which the card routes to the selected applet — must run
 * *before* this. See `runCredentialSweep` in `credentials.ts`.
 *
 * Never throws: every failure resolves to `{isdSelected: false}`.
 */
export async function selectIsdAndReadCplc(): Promise<IsdProbeResult> {
  for (const {name, aid} of ISD_AIDS) {
    let selected = false;
    try {
      const response = await sendIsoDepCommand(selectAid(aid));
      selected = parseApduResponse(response).isSuccess;
    } catch {
      // Card refused or transceive failed — try the next AID.
      continue;
    }

    if (!selected) {
      continue;
    }

    console.log(`[cplc] ISD selected via ${name}: ${bytesToHex(aid)}`);
    const result: IsdProbeResult = {
      isdSelected: true,
      isdAid: bytesToHex(aid),
    };

    // ISD is selected; CPLC is best-effort on top of that. A card can have
    // an ISD but refuse GET DATA, and that's still a useful signal.
    try {
      const cplcResponse = await sendIsoDepCommand(GET_CPLC);
      const parsed = parseApduResponse(cplcResponse);
      if (parsed.isSuccess) {
        const cplc = parseCPLC(parsed.data);
        if (cplc) {
          result.cplc = cplc;
          result.icTypeName = identifyIcType(cplc.icType);
          result.fabricatorName = identifyFabricator(cplc.icFabricator);
          // Prefer the IC-type platform (distinguishes JCOP 4 vs 4.5); fall
          // back to the coarser OS-ID pattern for unknown parts.
          result.osName =
            identifyJcopPlatform(cplc.icType) ?? identifyJcopVersion(cplc.osId);
          console.log('[cplc] CPLC read:', {
            icType: `0x${cplc.icType.toString(16)}`,
            icTypeName: result.icTypeName ?? 'unknown',
            fabricator: result.fabricatorName,
            osName: result.osName ?? 'unknown',
          });
        }
      }
    } catch {
      // CPLC unavailable — keep the ISD-selected signal.
    }

    return result;
  }

  return {isdSelected: false};
}

/**
 * Format CPLC data for display.
 */
export function formatCPLC(cplc: CPLCData): string {
  const parts = [`Fabricator: ${identifyFabricator(cplc.icFabricator)}`];
  const icTypeName = identifyIcType(cplc.icType);
  parts.push(
    icTypeName
      ? `IC: ${icTypeName}`
      : `IC: 0x${cplc.icType.toString(16).padStart(4, '0')}`,
  );
  parts.push(`OS: 0x${cplc.osId.toString(16)}`);
  return parts.join(', ');
}
