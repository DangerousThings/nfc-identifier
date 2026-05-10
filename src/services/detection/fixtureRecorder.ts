/**
 * Fixture Recorder
 *
 * Captures every transceive command/response pair during detection so the
 * resulting Transponder + raw APDU log can be exported as a JSON test
 * fixture. Used in dev builds only — production paths call `record()` and
 * the recorder is a no-op when capture is not active.
 *
 * Fixture shape (matches docs/plans/2026-05-03-an10833-detection-rework-design.md §8):
 *
 * {
 *   "name": "<user-supplied-or-auto-generated>",
 *   "rawData": { ... },
 *   "apduResponses": { "<hex command>": "<hex response>" | null, ... },
 *   "expectedDetection": { type, implementation?, confidence }
 * }
 */

import type {RawTagData} from '../../types/nfc';
import type {Transponder} from '../../types/detection';

export type TransceiveLayer =
  | 'nfcA' // Layer 3 NfcA / Type 2
  | 'isoDep' // Layer 4 ISO-DEP
  | 'isoDepIOS'
  | 'mifareIOS'
  | 'iso15693';

interface RecordedCall {
  layer: TransceiveLayer;
  /** Hex string of the command bytes, lowercase, no separators. */
  command: string;
  /** Hex string of the response bytes, or null if the call NAKed/threw. */
  response: string | null;
}

let active = false;
let calls: RecordedCall[] = [];

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Begin capturing transceive calls. Resets any prior capture state.
 *
 * Called from the detector at the start of each `detectChip()` invocation
 * in dev builds. No-op in production.
 */
export function startCapture(): void {
  active = true;
  calls = [];
}

/**
 * Record a transceive call. Safe to call when capture is inactive — the
 * call is silently dropped.
 */
export function record(
  layer: TransceiveLayer,
  command: number[],
  response: number[] | null,
): void {
  if (!active) {
    return;
  }
  calls.push({
    layer,
    command: bytesToHex(command),
    response: response === null ? null : bytesToHex(response),
  });
}

/**
 * Build a fixture JSON object from the captured calls plus an
 * already-detected Transponder (for the `expectedDetection` field).
 *
 * Caller is responsible for setting `name` to something meaningful
 * (e.g. the chip name or a user-supplied label).
 */
export function buildFixture(
  name: string,
  rawData: RawTagData,
  transponder: Transponder | undefined,
): object {
  // Collapse multiple identical commands into a single entry — the last
  // observed response wins. Matches the design doc's "apduResponses keyed
  // by command" shape.
  const apduResponses: Record<string, string | null> = {};
  for (const call of calls) {
    apduResponses[`${call.layer}:${call.command}`] =
      call.response;
  }

  return {
    name,
    capturedAt: new Date().toISOString(),
    platform: rawData.techTypes.includes('IsoDep') ? 'android' : 'unknown',
    rawData: {
      uid: rawData.uid,
      sak: rawData.sak,
      atqa: rawData.atqa,
      ats: rawData.ats,
      historicalBytes: rawData.historicalBytes,
      techTypes: rawData.techTypes,
      mifareClassic: rawData.mifareClassic,
      ndefRecords: rawData.ndefRecords,
    },
    apduCalls: calls,
    apduResponses,
    expectedDetection: transponder
      ? {
          type: transponder.type,
          implementation: transponder.implementation,
          implementationByte:
            transponder.implementationByte !== undefined
              ? `0x${transponder.implementationByte.toString(16).padStart(2, '0')}`
              : undefined,
          confidence: transponder.confidence,
          capabilities: transponder.capabilities,
          chipName: transponder.chipName,
        }
      : undefined,
  };
}

/** Stop capturing. Resets state. */
export function stopCapture(): void {
  active = false;
}

/** Has any call been recorded since the last `startCapture`? */
export function hasCapturedData(): boolean {
  return calls.length > 0;
}
