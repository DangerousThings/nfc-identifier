/**
 * NTAG5 Sensor Detection (Temptress + VK Thermo)
 *
 * Detects temperature sensor implants that use NTAG5 Link/Boost with I2C passthrough.
 * Ported from flipper-thermo/helpers/vk_thermo_nfc.c
 *
 * This is a Task-6 chip-ID module (slated for deletion once the library's
 * identify() fully owns chip identification). The NXP custom-command engine it
 * used to own — the frame builder, energy-harvesting control, the I2C
 * passthrough and the temperature read/decode — is DT custom hardware and has
 * moved into the STAYING `nxpCommands.ts` module (driven over the generic raw
 * NfcV primitive `nfcManager.sendRawNfcV`). This module now only holds the
 * VK Thermo product interpretation and orchestrates the moved engine.
 *
 * Detection strategy:
 * 1. Fast path: Check AFI/DSFID from GET_SYSTEM_INFO for VK Thermo variants
 * 2. Slow path: Enable energy harvesting, probe I2C bus for sensors (Temptress)
 *
 * VK Thermo product variants (identified via GET_SYSTEM_INFO):
 *   - AFI = 0x54 ("T" for thermo) identifies all Thermo products
 *   - DSFID = 0x09 → VK Thermo 112 (TMP112 sensor)
 *   - DSFID = 0x0A → VK Thermo 117 (TMP117 sensor)
 *   - DSFID = 0x0B → VK Thermo 119 (TMP119 sensor)
 *   - Signature readable from config blocks 0x00-0x07
 *
 * Temptress detection (identified via I2C sensor probing):
 *   - Dual TMP117 sensors at I2C addresses 0x49 and 0x4A
 *   - NOT a VivoKey product
 *
 * Reference: NXP NTAG 5 link/boost datasheets, flipper-thermo project
 */

import {Platform} from 'react-native';
import {
  NXP_CMD,
  SENSOR_ADDRESSES,
  enableEnergyHarvesting,
  identifySensorAtAddress,
  parseUidToBytes,
  readTemperature,
  sendNxpCustomCommand,
} from './nxpCommands';
import type {SensorType, TemperatureReading} from './nxpCommands';

export type {SensorType, TemperatureReading} from './nxpCommands';

// ============================================================================
// Constants
// ============================================================================

/** VK Thermo AFI value — "T" for thermo */
const VK_THERMO_AFI = 0x54;

/** VK Thermo DSFID-to-product mapping */
const VK_THERMO_DSFID: Record<number, {model: string; sensorType: SensorType}> =
  {
    0x09: {model: '112', sensorType: 'tmp112'},
    0x0a: {model: '117', sensorType: 'tmp117'},
    0x0b: {model: '119', sensorType: 'tmp119'},
  };

/** VK Thermo signature strings (readable from config blocks 0x00-0x07) */
const VK_THERMO_SIGNATURES: Record<string, string> = {
  'VK Thermo 112 vivokey.com/thermo': 'VK Thermo 112',
  'VK Thermo 117 vivokey.com/thermo': 'VK Thermo 117',
  'VK Thermo 119 vivokey.com/thermo': 'VK Thermo 119',
};

// ============================================================================
// Types
// ============================================================================

export type DeviceType = 'temptress' | 'thermo' | 'unknown';

export interface Ntag5SensorResult {
  /** Whether any sensor device was detected */
  detected: boolean;
  /** Device type: temptress (dual TMP117), thermo (single sensor), or unknown */
  deviceType: DeviceType;
  /** Sensor type for primary sensor */
  sensorType: SensorType;
  /** Whether device has dual sensors (Temptress) */
  hasDualSensors: boolean;
  /** Human-readable implant name */
  implantName?: string;
  /** VK Thermo model number (112, 117, 119) if applicable */
  thermoModel?: string;
  /** Signature string read from config blocks */
  signature?: string;
  /** Temperature reading from primary sensor (or sensor 1 on Temptress) */
  temperature?: TemperatureReading;
  /** Temperature reading from second sensor (Temptress only) */
  temperature2?: TemperatureReading;
}

// ============================================================================
// VK Thermo Detection (Fast Path — AFI/DSFID from GET_SYSTEM_INFO)
// ============================================================================

/**
 * Detect VK Thermo product from GET_SYSTEM_INFO AFI and DSFID values.
 * This is the fast path — no I2C probing needed.
 *
 * VK Thermo products have:
 *   - AFI = 0x54 ("T" for thermo)
 *   - DSFID identifies the sensor variant (0x09=112, 0x0A=117, 0x0B=119)
 */
export function detectThermoFromSystemInfo(
  afi?: number,
  dsfid?: number,
): Ntag5SensorResult | null {
  if (afi !== VK_THERMO_AFI) {
    return null;
  }

  console.log(
    `[NTAG5Sensor] AFI=0x${afi.toString(16)} matches VK Thermo, DSFID=0x${
      dsfid?.toString(16) ?? 'undefined'
    }`,
  );

  const thermoInfo = dsfid !== undefined ? VK_THERMO_DSFID[dsfid] : undefined;

  if (thermoInfo) {
    return {
      detected: true,
      deviceType: 'thermo',
      sensorType: thermoInfo.sensorType,
      hasDualSensors: false,
      implantName: `VK Thermo ${thermoInfo.model}`,
      thermoModel: thermoInfo.model,
    };
  }

  // Known AFI but unknown DSFID — still a Thermo but unknown variant
  return {
    detected: true,
    deviceType: 'thermo',
    sensorType: 'unknown',
    hasDualSensors: false,
    implantName: 'VK Thermo',
  };
}

/**
 * Read VK Thermo signature from config blocks 0x00-0x07.
 * The signature is a 32-byte ASCII string like "VK Thermo 117 vivokey.com/thermo"
 *
 * Config block read command (non-addressed):
 *   02 C0 04 [block] [num_blocks-1]
 *
 * For addressed mode:
 *   22 C0 04 [UID LSB-first] [block] [num_blocks-1]
 */
export async function readThermoSignature(
  uid: string,
): Promise<string | undefined> {
  try {
    const uidBytes = parseUidToBytes(uid);
    const allBytes: number[] = [];

    // Read config blocks 0x00-0x07 (4 bytes each = 32 bytes total)
    for (let block = 0; block <= 7; block++) {
      try {
        const response = await sendNxpCustomCommand(
          NXP_CMD.READ_CONFIG,
          uidBytes,
          [block, 0x00], // [address, num_blocks-1]
        );

        if (response.length >= 4) {
          allBytes.push(...response.slice(0, 4));
        }
      } catch (e) {
        console.debug(`[NTAG5Sensor] Config block ${block} read failed:`, e);
        break;
      }
    }

    if (allBytes.length === 0) {
      return undefined;
    }

    // Convert to ASCII string, filtering printable characters
    const signature = allBytes
      .filter(b => b >= 0x20 && b <= 0x7e)
      .map(b => String.fromCharCode(b))
      .join('')
      .trim();

    console.log('[NTAG5Sensor] Read signature:', signature);

    // Check against known signatures
    if (VK_THERMO_SIGNATURES[signature]) {
      return signature;
    }

    // Partial match — check if it starts with "VK Thermo"
    if (signature.startsWith('VK Thermo')) {
      return signature;
    }

    return signature.length > 0 ? signature : undefined;
  } catch (error) {
    console.warn('[NTAG5Sensor] Signature read failed:', error);
    return undefined;
  }
}

// ============================================================================
// Main Detection Orchestrators
// ============================================================================

/**
 * Detect NTAG5 sensor implant using I2C probing.
 * This is the slow path — requires energy harvesting and I2C bus access.
 *
 * Detection order:
 * 1. Enable energy harvesting
 * 2. Probe I2C addresses 0x48, 0x49, 0x4A
 * 3. If sensors at 0x49 AND 0x4A → Temptress (dual TMP117)
 * 4. If sensor at 0x48 → VK Thermo (single sensor, type from Device ID)
 * 5. If no sensors → unknown (not a sensor implant)
 */
export async function detectNtag5Sensors(
  uid: string,
): Promise<Ntag5SensorResult> {
  const uidBytes = parseUidToBytes(uid);

  console.log('[NTAG5Sensor] Starting I2C sensor detection...');

  // Enable energy harvesting to power the sensors
  const ehOk = await enableEnergyHarvesting(uidBytes);
  if (!ehOk) {
    console.log('[NTAG5Sensor] EH failed — no sensors or not a sensor implant');
    return {
      detected: false,
      deviceType: 'unknown',
      sensorType: 'unknown',
      hasDualSensors: false,
    };
  }

  // Probe all three addresses
  const sensors: {address: number; type: SensorType | null}[] = [];
  const addresses = [
    SENSOR_ADDRESSES.PRIMARY,
    SENSOR_ADDRESSES.TEMPTRESS_1,
    SENSOR_ADDRESSES.TEMPTRESS_2,
  ];

  for (const addr of addresses) {
    const type = await identifySensorAtAddress(uidBytes, addr);
    sensors.push({address: addr, type});
  }

  const sensorAt0x48 = sensors[0].type;
  const sensorAt0x49 = sensors[1].type;
  const sensorAt0x4A = sensors[2].type;

  // Temptress: dual sensors at 0x49 AND 0x4A
  if (sensorAt0x49 !== null && sensorAt0x4A !== null) {
    console.log('[NTAG5Sensor] Temptress detected: dual sensors at 0x49/0x4A');

    // Read temperature from both sensors
    const temp1 = await readTemperature(
      uidBytes,
      SENSOR_ADDRESSES.TEMPTRESS_1,
      sensorAt0x49,
    );
    const temp2 = await readTemperature(
      uidBytes,
      SENSOR_ADDRESSES.TEMPTRESS_2,
      sensorAt0x4A,
    );

    return {
      detected: true,
      deviceType: 'temptress',
      sensorType: sensorAt0x49, // Both should be TMP117
      hasDualSensors: true,
      implantName: 'Temptress',
      temperature: temp1,
      temperature2: temp2,
    };
  }

  // VK Thermo: single sensor at 0x48
  if (sensorAt0x48 !== null) {
    const sensorName =
      sensorAt0x48 === 'tmp112'
        ? '112'
        : sensorAt0x48 === 'tmp117'
          ? '117'
          : sensorAt0x48 === 'tmp119'
            ? '119'
            : '';
    const implantName = sensorName ? `VK Thermo ${sensorName}` : 'VK Thermo';

    console.log(`[NTAG5Sensor] VK Thermo detected: ${sensorAt0x48} at 0x48`);

    // Read temperature from the sensor
    const temp = await readTemperature(
      uidBytes,
      SENSOR_ADDRESSES.PRIMARY,
      sensorAt0x48,
    );

    return {
      detected: true,
      deviceType: 'thermo',
      sensorType: sensorAt0x48,
      hasDualSensors: false,
      implantName,
      thermoModel: sensorName || undefined,
      temperature: temp,
    };
  }

  // No sensors found
  console.log('[NTAG5Sensor] No compatible sensors found');
  return {
    detected: false,
    deviceType: 'unknown',
    sensorType: 'unknown',
    hasDualSensors: false,
  };
}

/**
 * Full NTAG5 sensor detection — tries fast path first, then slow path
 *
 * 1. Fast path: Check AFI/DSFID (already available from GET_SYSTEM_INFO)
 * 2. Slow path: I2C sensor probing (requires energy harvesting)
 *
 * @param uid - Tag UID as hex string
 * @param afi - Application Family Identifier from GET_SYSTEM_INFO
 * @param dsfid - Data Storage Format Identifier from GET_SYSTEM_INFO
 * @param skipI2cProbing - If true, only use fast path (for performance)
 */
export async function detectNtag5SensorImplant(
  uid: string,
  afi?: number,
  dsfid?: number,
  skipI2cProbing: boolean = false,
): Promise<Ntag5SensorResult> {
  // Fast path: VK Thermo detection from AFI/DSFID
  const thermoResult = detectThermoFromSystemInfo(afi, dsfid);
  if (thermoResult) {
    const uidBytes = parseUidToBytes(uid);

    // Optionally read signature for extra verification
    try {
      const signature = await readThermoSignature(uid);
      if (signature) {
        thermoResult.signature = signature;
        console.log('[NTAG5Sensor] Verified signature:', signature);
      }
    } catch {
      // Signature read is optional
    }

    // Read temperature from the sensor
    try {
      const ehOk = await enableEnergyHarvesting(uidBytes);
      if (ehOk) {
        thermoResult.temperature = await readTemperature(
          uidBytes,
          SENSOR_ADDRESSES.PRIMARY,
          thermoResult.sensorType,
        );
      }
    } catch {
      console.warn('[NTAG5Sensor] Temperature read failed on fast path');
    }

    return thermoResult;
  }

  // Slow path: I2C sensor probing (Temptress or untagged Thermo)
  if (skipI2cProbing) {
    return {
      detected: false,
      deviceType: 'unknown',
      sensorType: 'unknown',
      hasDualSensors: false,
    };
  }

  // Platform check: I2C probing requires raw NXP commands
  // iOS support depends on react-native-nfc-manager's customCommand availability
  if (Platform.OS === 'ios') {
    console.log('[NTAG5Sensor] I2C probing on iOS — attempting via customCommand');
  }

  return detectNtag5Sensors(uid);
}
