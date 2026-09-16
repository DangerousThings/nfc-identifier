/**
 * Gen4 "Ultimate" magic-transponder detection.
 *
 * The Gen4 (GTU / "Ultimate") family are configurable magic tags that emulate
 * MIFARE Classic or Type 2 (NTAG / Ultralight) over ISO 14443-3A. They answer a
 * vendor command genuine chips do not: `CF <4-byte password> <cmd>`. Sending the
 * get-configuration command (`0xC6`) with the factory-default password
 * (`00000000`) — i.e. `CF 00 00 00 00 C6` — returns the config block on a Gen4
 * and gets a NAK / no answer on anything else. So any non-error response to it
 * identifies a Gen4 Ultimate.
 *
 * The reader appends CRC_A, so on the air this is `CF 00 00 00 00 C6 <crc>`.
 *
 * Applies to both the MIFARE Classic and Type 2 branches (a Gen4 can wear
 * either coat). Send it last in a branch: a non-Gen4 tag NAKs the unknown
 * command, which can halt it, so run every other read first.
 *
 * ponytail: default-password probe only. A Gen4 whose password was changed
 * answers nothing here and is missed; add password variants if that matters.
 */

import {Platform} from 'react-native';
import NfcManager, {NfcTech} from '@dangerousthings/react-native-nfc-manager';
import {sendType2Command} from '../nfc/commands';

/** Gen4 get-configuration, factory-default password. */
export const GEN4_GET_CONFIG = [0xcf, 0x00, 0x00, 0x00, 0x00, 0xc6];

/**
 * True if the tag currently in the field answers the Gen4 get-config command.
 * Never throws — a NAK / lost tag / unsupported platform resolves to false.
 *
 * The backdoor command only answers on a *clean* NfcA connection. By the time a
 * branch probes, its GET_VERSION / page reads have left the scan connection
 * dirty, and simply re-connecting on top of the live connection yields a null
 * tech (native transceive NPE). So on Android we close that connection and
 * reconnect fresh — the same clean-connection state SEND RAW sends from — then
 * release it. iOS has no such handle; it reuses the existing modal session.
 */
export async function probeGen4Ultimate(): Promise<boolean> {
  try {
    let response: number[];
    if (Platform.OS === 'ios') {
      response = await sendType2Command(GEN4_GET_CONFIG);
    } else {
      try {
        await NfcManager.close();
      } catch {
        // No open tech to close — fine, we are about to open one.
      }
      await NfcManager.connect([NfcTech.NfcA]);
      try {
        response = Array.from(await NfcManager.transceive(GEN4_GET_CONFIG));
      } finally {
        try {
          await NfcManager.close();
        } catch {
          // Best-effort release; the scan tail cancels the session anyway.
        }
      }
    }
    const ok = response.length > 0;
    console.log('[gen4] CF …C6 ->', ok ? response : 'no bytes');
    return ok;
  } catch (e) {
    console.log('[gen4] CF …C6 threw:', String(e));
    return false;
  }
}
