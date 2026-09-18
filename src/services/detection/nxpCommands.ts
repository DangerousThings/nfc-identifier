/**
 * NXP NTAG5 custom-command engine (DT custom hardware — APP side).
 *
 * This is the STAYING home for the NXP proprietary ISO 15693 custom commands
 * (READ_CONFIG 0xC0, WRITE_CONFIG 0xC1, READ_I2C 0xD5, WRITE_I2C 0xD4,
 * READ_SRAM 0xD2) and the VK Thermo / Temptress temperature read + decode built
 * on top of them. It moved here (out of the soon-deleted `nfc/commands.ts`
 * frame builder and the Task-6 `ntag5sensor.ts` chip-ID module) as part of the
 * migration onto the library's `identify()`.
 *
 * **These commands are DT custom-hardware knowledge and deliberately do NOT
 * live in the `@dangerousthings/react-native-nfc-manager` library.** The library
 * only provides the GENERIC raw-transceive primitive
 * `nfcManager.sendRawNfcV(bytes)` (= `NfcManager.transceiveToPresentTag(bytes,
 * NfcTech.NfcV)` on Android); this module builds the NXP manufacturer-specific
 * frames and drives them over it. On iOS, which exposes no raw ISO 15693
 * transceive, the structured `iso15693HandlerIOS.customCommand` API is used
 * directly instead.
 *
 * Ported from flipper-thermo/helpers/vk_thermo_nfc.c.
 */

import {Platform} from 'react-native';
import NfcManager from '@dangerousthings/react-native-nfc-manager';
import {nfcManager} from '../nfc/NFCManager';

// ============================================================================
// NXP custom ISO 15693 command frame builder (relocated from nfc/commands.ts)
// ============================================================================

/** NXP manufacturer code for custom commands */
export const NXP_MANUF_CODE = 0x04;

/** NXP custom command codes */
export const NXP_CMD = {
  READ_CONFIG: 0xc0,
  WRITE_CONFIG: 0xc1,
  READ_SRAM: 0xd2,
  WRITE_I2C: 0xd4,
  READ_I2C: 0xd5,
} as const;

/** ISO 15693 flags */
const ISO15693_FLAG_HIGH_DATA_RATE = 0x02;
const ISO15693_FLAG_ADDRESSED = 0x20;

/**
 * Parse UID hex string to byte array
 * Handles formats: "AA:BB:CC", "AABBCC", "AA BB CC"
 */
export function parseUidToBytes(uidString: string): number[] {
  const clean = uidString.replace(/[:\s-]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Reverse byte array for LSB-first UID encoding in ISO 15693 addressed commands
 */
export function uidBytesLsbFirst(uidBytes: number[]): number[] {
  return [...uidBytes].reverse();
}

/**
 * Build an NXP custom command in addressed mode
 * Format: [0x22][CMD][0x04][UID LSB-first 8 bytes][params...]
 *
 * Note: On Android, the raw NfcV transceive sends these bytes verbatim
 * (including flags). On iOS, customCommand() handles flags/UID separately.
 */
export function buildNxpCustomCommand(
  cmd: number,
  uidBytes: number[],
  params: number[],
): number[] {
  return [
    ISO15693_FLAG_HIGH_DATA_RATE | ISO15693_FLAG_ADDRESSED, // 0x22
    cmd,
    NXP_MANUF_CODE, // 0x04
    ...uidBytesLsbFirst(uidBytes),
    ...params,
  ];
}

/**
 * Send an NXP custom command via ISO 15693 and return the response data
 * (with the response-flags byte stripped), or throw on failure.
 *
 * Platform-aware: on Android it builds the raw addressed frame and sends it
 * over the app's GENERIC raw NfcV primitive (`nfcManager.sendRawNfcV`); on iOS
 * it uses the structured `iso15693HandlerIOS.customCommand` (CoreNFC has no raw
 * ISO 15693 transceive). No NXP knowledge lives in `sendRawNfcV` itself — the
 * frame construction and response-flag parsing are all here.
 */
export async function sendNxpCustomCommand(
  cmd: number,
  uidBytes: number[],
  params: number[],
): Promise<number[]> {
  if (Platform.OS === 'ios') {
    // iOS: structured customCommand API from iso15693HandlerIOS.
    try {
      const customRequestParameters = [
        ...uidBytesLsbFirst(uidBytes),
        ...params,
      ];
      const response = await NfcManager.iso15693HandlerIOS.customCommand({
        flags: ISO15693_FLAG_HIGH_DATA_RATE | ISO15693_FLAG_ADDRESSED,
        customCommandCode: cmd,
        customRequestParameters,
      });
      return Array.from(response);
    } catch (error) {
      console.debug('[nxpCommands] iOS customCommand failed:', error);
      throw error;
    }
  }

  // Android: build the raw frame and transceive it to the tag in the field via
  // the generic raw NfcV primitive.
  const fullCommand = buildNxpCustomCommand(cmd, uidBytes, params);
  const response = await nfcManager.sendRawNfcV(fullCommand);

  // Parse response: first byte is flags, rest is data.
  if (!response || response.length === 0) {
    throw new Error('Empty response from NXP command');
  }

  const flagByte = response[0];
  if (flagByte & 0x01) {
    // Error flag set
    const errorCode = response.length > 1 ? response[1] : 0;
    throw new Error(
      `NXP command 0x${cmd.toString(16)} error: flag=0x${flagByte.toString(
        16,
      )}, code=0x${errorCode.toString(16)}`,
    );
  }

  // Success — return data after the flags byte.
  return response.slice(1);
}

// ============================================================================
// Constants (relocated from ntag5sensor.ts)
// ============================================================================

/** NXP configuration register addresses */
const NXP_CONFIG_ADDR = {
  EH_CONFIG_REG: 0xa7,
  I2C_M_STATUS_REG: 0xad,
} as const;

/** Energy harvesting flags */
const NXP_EH = {
  ENABLE: 1 << 0, // 0x01
  TRIGGER: 1 << 3, // 0x08
  LOAD_OK: 1 << 7, // 0x80
} as const;

/** I2C master status flags */
const NXP_I2C_M = {
  BUSY_MASK: 0x01,
  TRANS_STATUS_MASK: 0x06,
  TRANS_STATUS_SUCCESS: 3 << 1, // 0x06
} as const;

/** Temperature sensor I2C addresses */
export const SENSOR_ADDRESSES = {
  PRIMARY: 0x48, // VK Thermo single sensor
  TEMPTRESS_1: 0x49, // Temptress first sensor
  TEMPTRESS_2: 0x4a, // Temptress second sensor
} as const;

/** TMP117/119 Device ID register */
const TMP117_REG_DEVICE_ID = 0x0f;
const TMP117_DEVICE_ID = 0x0117;
const TMP117_DEVICE_ID_MASK = 0x0fff;
const TMP119_DEVICE_ID = 0x0119;

/** Temperature register (register 0x00 on all TMP sensors) */
const TMP_REG_TEMPERATURE = 0x00;

/** VK Thermo AFI value — "T" for thermo */
export const VK_THERMO_AFI = 0x54;

/** VK Thermo DSFID → sensor type (0x09=112, 0x0A=117, 0x0B=119) */
const VK_THERMO_DSFID_SENSOR: Record<number, SensorType> = {
  0x09: 'tmp112',
  0x0a: 'tmp117',
  0x0b: 'tmp119',
};

// ============================================================================
// Types (relocated from ntag5sensor.ts)
// ============================================================================

export type SensorType = 'tmp112' | 'tmp117' | 'tmp119' | 'unknown';

/** A single temperature reading in both units */
export interface TemperatureReading {
  /** Temperature in degrees Celsius */
  celsius: number;
  /** Temperature in degrees Fahrenheit */
  fahrenheit: number;
}

/** Outcome of the NTAG5 sensor temperature read. */
export interface Ntag5TemperatureResult {
  /** Whether dual sensors were found (Temptress). */
  hasDualSensors: boolean;
  /** Implant name inferred from the I2C topology (Temptress only). */
  implantName?: string;
  /** Temperature from the primary sensor (or sensor 1 on Temptress). */
  temperature?: TemperatureReading;
  /** Temperature from the second sensor (Temptress only). */
  temperature2?: TemperatureReading;
}

/** Map a GET_SYSTEM_INFO DSFID to the TMP sensor variant it names. */
export function sensorTypeFromDsfid(dsfid?: number): SensorType {
  if (dsfid === undefined) {
    return 'unknown';
  }
  return VK_THERMO_DSFID_SENSOR[dsfid] ?? 'unknown';
}

// ============================================================================
// Energy Harvesting Control (relocated from ntag5sensor.ts)
// ============================================================================

/**
 * Enable energy harvesting on NTAG5 Link/Boost (two-step process)
 *
 * Step 1: TRIGGER only (charges capacitor)
 *   - WRITE_CONFIG(0xC1) to EH_CONFIG_REG (0xA7) with [TRIGGER, 0, 0, 0]
 *   - Poll READ_CONFIG(0xC0) at 0xA7 until LOAD_OK bit (bit7) is set
 *
 * Step 2: TRIGGER + ENABLE (activates voltage output)
 *   - WRITE_CONFIG(0xC1) to EH_CONFIG_REG (0xA7) with [TRIGGER|ENABLE, 0, 0, 0]
 *   - Wait 50ms for voltage stabilization
 *
 * Note: WRITE_CONFIG may timeout but still succeed (documented NXP behavior).
 * We verify success by reading back the config register.
 */
export async function enableEnergyHarvesting(
  uidBytes: number[],
  timeoutMs: number = 5000,
): Promise<boolean> {
  try {
    console.log('[NTAG5Sensor] EH Step 1: Triggering (charging capacitor)');

    // Step 1: Write TRIGGER only
    const triggerData = [NXP_EH.TRIGGER, 0x00, 0x00, 0x00];
    try {
      await sendNxpCustomCommand(NXP_CMD.WRITE_CONFIG, uidBytes, [
        NXP_CONFIG_ADDR.EH_CONFIG_REG,
        ...triggerData,
      ]);
    } catch {
      // WRITE_CONFIG may timeout but still succeed
      console.debug('[NTAG5Sensor] EH trigger write timeout (may be normal)');
    }

    // Poll for LOAD_OK
    const pollIntervalMs = 100;
    const maxPolls = Math.ceil(timeoutMs / pollIntervalMs);
    let loadOk = false;

    for (let i = 0; i < maxPolls; i++) {
      await delay(pollIntervalMs);
      const status = await checkEhReady(uidBytes);

      if (status === 'load_ok') {
        console.log(
          `[NTAG5Sensor] LOAD_OK set after ${(i + 1) * pollIntervalMs}ms`,
        );
        loadOk = true;
        break;
      } else if (status === 'tag_lost') {
        console.error('[NTAG5Sensor] Tag lost during EH polling');
        return false;
      }
      // status === 'waiting' — continue polling
    }

    if (!loadOk) {
      console.error('[NTAG5Sensor] EH LOAD_OK never set — cannot read sensor');
      return false;
    }

    // Step 2: Write TRIGGER + ENABLE
    console.log('[NTAG5Sensor] EH Step 2: Enabling output');
    const enableData = [NXP_EH.TRIGGER | NXP_EH.ENABLE, 0x00, 0x00, 0x00];
    try {
      await sendNxpCustomCommand(NXP_CMD.WRITE_CONFIG, uidBytes, [
        NXP_CONFIG_ADDR.EH_CONFIG_REG,
        ...enableData,
      ]);
    } catch {
      // May timeout but still succeed
      console.debug('[NTAG5Sensor] EH enable write timeout (may be normal)');
    }

    // Wait for voltage stabilization and sensor power-up
    // TMP112 needs ~26ms for first conversion, TMP117 up to 15.5ms
    // Use 200ms to be safe with capacitor charge time
    await delay(200);
    console.log('[NTAG5Sensor] Energy harvesting enabled');
    return true;
  } catch (error) {
    console.error('[NTAG5Sensor] Energy harvesting enable failed:', error);
    return false;
  }
}

/**
 * Check if energy harvesting LOAD_OK bit is set
 */
async function checkEhReady(
  uidBytes: number[],
): Promise<'load_ok' | 'waiting' | 'tag_lost'> {
  try {
    const response = await sendNxpCustomCommand(
      NXP_CMD.READ_CONFIG,
      uidBytes,
      [NXP_CONFIG_ADDR.EH_CONFIG_REG, 0x00], // [address, num_blocks-1]
    );

    if (response.length >= 1) {
      const loadOk = (response[0] & NXP_EH.LOAD_OK) !== 0;
      return loadOk ? 'load_ok' : 'waiting';
    }

    return 'waiting';
  } catch {
    return 'tag_lost';
  }
}

// ============================================================================
// I2C Passthrough via NTAG5 (relocated from ntag5sensor.ts)
// ============================================================================

/**
 * Write data to I2C slave via NTAG5 WRITE_I2C command (0xD4)
 *
 * Params: [i2c_addr & 0x7F, data_len-1, ...data]
 * After write: verify via I2C status register (0xAD)
 */
async function i2cWrite(
  uidBytes: number[],
  i2cAddr: number,
  data: number[],
): Promise<boolean> {
  if (data.length < 1 || data.length > 8) {
    return false;
  }

  const params = [
    i2cAddr & 0x7f, // Address with stop condition (bit7=0)
    data.length - 1, // Number of bytes - 1
    ...data,
  ];

  try {
    await sendNxpCustomCommand(NXP_CMD.WRITE_I2C, uidBytes, params);
  } catch {
    // WRITE_I2C may timeout but succeed
    console.debug('[NTAG5Sensor] I2C write timeout (may be normal)');
  }

  // Verify the write succeeded by checking I2C status
  await delay(5);
  return i2cCheckResult(uidBytes);
}

/**
 * Read data from I2C slave via NTAG5 READ_I2C (0xD5) + READ_SRAM (0xD2)
 *
 * Step 1: READ_I2C tells NTAG5 to read from I2C slave into SRAM
 * Step 2: READ_SRAM fetches the data from SRAM
 */
async function i2cRead(
  uidBytes: number[],
  i2cAddr: number,
  numBytes: number,
): Promise<number[] | null> {
  // Step 1: Send READ_I2C
  const readParams = [
    i2cAddr & 0x7f, // Address with stop condition (bit7=0)
    numBytes - 1, // Number of bytes - 1
  ];

  try {
    await sendNxpCustomCommand(NXP_CMD.READ_I2C, uidBytes, readParams);
  } catch {
    console.debug('[NTAG5Sensor] READ_I2C timeout (may be normal)');
  }

  // Brief delay for I2C transaction to complete
  await delay(10);

  // Step 2: Read data from SRAM
  const numBlocks = Math.ceil(numBytes / 4);
  const sramParams = [
    0x00, // SRAM start address
    numBlocks - 1, // Number of blocks - 1
  ];

  try {
    const sramData = await sendNxpCustomCommand(
      NXP_CMD.READ_SRAM,
      uidBytes,
      sramParams,
    );

    if (sramData.length >= numBytes) {
      return sramData.slice(0, numBytes);
    }

    console.warn(
      `[NTAG5Sensor] SRAM returned ${sramData.length} bytes, expected ${numBytes}`,
    );
    return sramData.length > 0 ? sramData : null;
  } catch (error) {
    console.error('[NTAG5Sensor] READ_SRAM failed:', error);
    return null;
  }
}

/**
 * Check I2C transaction result via status register
 */
async function i2cCheckResult(uidBytes: number[]): Promise<boolean> {
  try {
    const response = await sendNxpCustomCommand(
      NXP_CMD.READ_CONFIG,
      uidBytes,
      [NXP_CONFIG_ADDR.I2C_M_STATUS_REG, 0x00],
    );

    if (response.length < 1) {
      return false;
    }

    const status = response[0];
    const transStatus = status & NXP_I2C_M.TRANS_STATUS_MASK;
    const success = transStatus === NXP_I2C_M.TRANS_STATUS_SUCCESS;

    if (!success) {
      console.debug(
        `[NTAG5Sensor] I2C transaction failed (status: 0x${status.toString(
          16,
        )})`,
      );
    }

    return success;
  } catch {
    return false;
  }
}

// ============================================================================
// Sensor Identification (relocated from ntag5sensor.ts)
// ============================================================================

/**
 * Identify the temperature sensor at a specific I2C address by reading
 * the TMP117/119 Device ID register (0x0F).
 *
 * - TMP117: Device ID = 0x0117 (masked with 0x0FFF)
 * - TMP119: Device ID = 0x0119 (masked with 0x0FFF)
 * - TMP112: Only has registers 0x00-0x03, so writing 0x0F fails → identified by failure
 *
 * Returns null if no sensor responds at the address.
 */
export async function identifySensorAtAddress(
  uidBytes: number[],
  i2cAddr: number,
): Promise<SensorType | null> {
  // Set register pointer to Device ID (0x0F)
  const regPtr = [TMP117_REG_DEVICE_ID];
  const writeOk = await i2cWrite(uidBytes, i2cAddr, regPtr);

  if (!writeOk) {
    // TMP112 only has registers 0x00-0x03, so 0x0F write fails
    // At primary address 0x48, assume TMP112; at other addresses, no sensor
    if (i2cAddr === SENSOR_ADDRESSES.PRIMARY) {
      console.log(
        `[NTAG5Sensor] Device ID write failed at 0x${i2cAddr.toString(
          16,
        )} — likely TMP112`,
      );
      return 'tmp112';
    }
    console.debug(`[NTAG5Sensor] No sensor at 0x${i2cAddr.toString(16)}`);
    return null;
  }

  // Read 2 bytes (Device ID)
  const idData = await i2cRead(uidBytes, i2cAddr, 2);
  if (!idData || idData.length < 2) {
    if (i2cAddr === SENSOR_ADDRESSES.PRIMARY) {
      console.log(
        `[NTAG5Sensor] Device ID read failed at 0x${i2cAddr.toString(
          16,
        )} — likely TMP112`,
      );
      return 'tmp112';
    }
    return null;
  }

  const deviceId = (idData[0] << 8) | idData[1];
  const maskedId = deviceId & TMP117_DEVICE_ID_MASK;

  console.log(
    `[NTAG5Sensor] Device ID at 0x${i2cAddr.toString(16)}: 0x${deviceId
      .toString(16)
      .padStart(4, '0')}`,
  );

  if (maskedId === TMP119_DEVICE_ID) {
    console.log(
      `[NTAG5Sensor] Sensor identified: TMP119 at 0x${i2cAddr.toString(16)}`,
    );
    return 'tmp119';
  }

  if (maskedId === TMP117_DEVICE_ID) {
    console.log(
      `[NTAG5Sensor] Sensor identified: TMP117 at 0x${i2cAddr.toString(16)}`,
    );
    return 'tmp117';
  }

  console.log(
    `[NTAG5Sensor] Unrecognized Device ID 0x${deviceId.toString(
      16,
    )} at 0x${i2cAddr.toString(16)}`,
  );
  return i2cAddr === SENSOR_ADDRESSES.PRIMARY ? 'tmp112' : null;
}

// ============================================================================
// Temperature Reading + decode (relocated from ntag5sensor.ts)
// ============================================================================

/**
 * Convert raw 16-bit register value to Celsius for TMP117/TMP119.
 * Resolution: 0.0078125°C per LSB, 16-bit two's complement.
 */
function tmp117RawToCelsius(raw: number): number {
  // Two's complement for negative values
  if (raw > 0x7fff) {
    raw -= 0x10000;
  }
  return raw * 0.0078125;
}

/**
 * Convert raw 16-bit register value to Celsius for TMP112.
 * Resolution: 0.0625°C per LSB, 12-bit value left-aligned in 16 bits.
 */
function tmp112RawToCelsius(raw: number): number {
  // Shift right by 4 to get 12-bit value
  let value = raw >> 4;
  // Two's complement for 12-bit
  if (value > 0x7ff) {
    value -= 0x1000;
  }
  return value * 0.0625;
}

function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

/**
 * Read temperature from a sensor at the given I2C address.
 * Sets the register pointer to 0x00 (temperature register), then reads 2 bytes.
 *
 * TMP112 defaults to register 0x00 on power-up, so we try reading directly
 * first (skip pointer write) before falling back to explicit pointer set.
 *
 * Retries up to 3 times with increasing delays to handle slow sensor startup.
 */
export async function readTemperature(
  uidBytes: number[],
  i2cAddr: number,
  sensorType: SensorType,
): Promise<TemperatureReading | undefined> {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Increasing delay between retries (100ms, 200ms)
        await delay(100 * attempt);
        console.log(
          `[NTAG5Sensor] Temperature read retry ${attempt + 1}/${maxRetries}`,
        );
      }

      // TMP112 defaults to register 0x00 on power-up, so try direct read first
      // For TMP117/119, always set the pointer explicitly
      if (sensorType !== 'tmp112' || attempt > 0) {
        const writeOk = await i2cWrite(uidBytes, i2cAddr, [
          TMP_REG_TEMPERATURE,
        ]);
        if (!writeOk) {
          console.warn(
            `[NTAG5Sensor] Failed to set temp register at 0x${i2cAddr.toString(
              16,
            )} (attempt ${attempt + 1})`,
          );
          continue;
        }
      }

      // Read 2 bytes of temperature data
      const data = await i2cRead(uidBytes, i2cAddr, 2);
      if (!data || data.length < 2) {
        console.warn(
          `[NTAG5Sensor] Failed to read temp at 0x${i2cAddr.toString(
            16,
          )} (attempt ${attempt + 1})`,
        );
        continue;
      }

      const raw = (data[0] << 8) | data[1];

      // Sanity check: raw value 0x0000 or 0xFFFF likely means sensor hasn't converted yet
      if (raw === 0x0000 || raw === 0xffff) {
        console.warn(
          `[NTAG5Sensor] Suspicious raw value 0x${raw
            .toString(16)
            .padStart(4, '0')} at 0x${i2cAddr.toString(
            16,
          )} — sensor may not be ready`,
        );
        if (attempt < maxRetries - 1) {
          continue;
        }
      }

      const celsius =
        sensorType === 'tmp112'
          ? tmp112RawToCelsius(raw)
          : tmp117RawToCelsius(raw);
      const fahrenheit = celsiusToFahrenheit(celsius);

      console.log(
        `[NTAG5Sensor] Temperature at 0x${i2cAddr.toString(16)}: ` +
          `${celsius.toFixed(2)}°C / ${fahrenheit.toFixed(2)}°F (raw: 0x${raw
            .toString(16)
            .padStart(4, '0')})`,
      );

      return {
        celsius: Math.round(celsius * 100) / 100,
        fahrenheit: Math.round(fahrenheit * 100) / 100,
      };
    } catch (error) {
      console.warn(
        `[NTAG5Sensor] Temperature read failed at 0x${i2cAddr.toString(
          16,
        )} (attempt ${attempt + 1}):`,
        error,
      );
    }
  }

  console.error(
    `[NTAG5Sensor] Temperature read exhausted all ${maxRetries} retries`,
  );
  return undefined;
}

// ============================================================================
// Temperature read driver (for dtEnrich.enrichNfcV)
// ============================================================================

/**
 * Read the live temperature(s) from an NTAG5 VK Thermo / Temptress via the NXP
 * I2C passthrough, driven over the generic raw NfcV primitive.
 *
 * Sequencing: this must run AFTER the library's identify()/naming reads within
 * the same scan session — `nfcManager.sendRawNfcV` connects to the tag already
 * in the field on demand (like `sendRawNfcA`), and its underlying
 * `transceiveToPresentTag` does a connect → close → connect handshake, so it
 * always transceives from a clean activation regardless of what the library's
 * `getSystemInfo` / `readSingleBlock` left on the scan connection. There is no
 * extra connection-state juggling to do here beyond calling it last.
 *
 * Fast path (VK Thermo, AFI 0x54): the sensor variant comes from the DSFID, so
 * we read the single sensor at 0x48. Slow path (no Thermo AFI): probe the I2C
 * bus — dual sensors at 0x49/0x4A ⇒ Temptress (`temperature` + `temperature2`),
 * else the single sensor at 0x48. Best-effort: returns `{}` (never throws) if
 * energy harvesting cannot be brought up.
 *
 * @param uid   Tag UID as a hex string (from the app transponder's rawData.uid).
 * @param afi   Application Family Identifier from GET_SYSTEM_INFO.
 * @param dsfid Data Storage Format Identifier from GET_SYSTEM_INFO.
 */
export async function readNtag5Temperatures(
  uid: string,
  afi?: number,
  dsfid?: number,
): Promise<Ntag5TemperatureResult> {
  const uidBytes = parseUidToBytes(uid);

  const ehOk = await enableEnergyHarvesting(uidBytes);
  if (!ehOk) {
    return {hasDualSensors: false};
  }

  // Fast path: a VK Thermo names its sensor variant via DSFID → single sensor.
  if (afi === VK_THERMO_AFI) {
    const sensorType = sensorTypeFromDsfid(dsfid);
    const temperature = await readTemperature(
      uidBytes,
      SENSOR_ADDRESSES.PRIMARY,
      sensorType,
    );
    return {hasDualSensors: false, temperature};
  }

  // Slow path: probe the I2C bus to distinguish Temptress (dual) from a single
  // sensor (untagged Thermo).
  const sensor1 = await identifySensorAtAddress(
    uidBytes,
    SENSOR_ADDRESSES.TEMPTRESS_1,
  );
  const sensor2 = await identifySensorAtAddress(
    uidBytes,
    SENSOR_ADDRESSES.TEMPTRESS_2,
  );

  if (sensor1 !== null && sensor2 !== null) {
    const temperature = await readTemperature(
      uidBytes,
      SENSOR_ADDRESSES.TEMPTRESS_1,
      sensor1,
    );
    const temperature2 = await readTemperature(
      uidBytes,
      SENSOR_ADDRESSES.TEMPTRESS_2,
      sensor2,
    );
    return {
      hasDualSensors: true,
      implantName: 'Temptress',
      temperature,
      temperature2,
    };
  }

  const primary = await identifySensorAtAddress(
    uidBytes,
    SENSOR_ADDRESSES.PRIMARY,
  );
  if (primary !== null) {
    const temperature = await readTemperature(
      uidBytes,
      SENSOR_ADDRESSES.PRIMARY,
      primary,
    );
    return {hasDualSensors: false, temperature};
  }

  return {hasDualSensors: false};
}

// ============================================================================
// Utility
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
