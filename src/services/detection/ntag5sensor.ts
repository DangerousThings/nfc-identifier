/**
 * NTAG5 Sensor Detection (Temptress + VK Thermo)
 *
 * Detects temperature sensor implants that use NTAG5 Link/Boost with I2C passthrough.
 * Ported from flipper-thermo/helpers/vk_thermo_nfc.c
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
  sendNxpCustomCommand,
  parseUidToBytes,
} from '../nfc/commands';

// ============================================================================
// Constants
// ============================================================================

/** NXP configuration register addresses */
const NXP_CONFIG_ADDR = {
  EH_CONFIG_REG: 0xa7,
  I2C_M_STATUS_REG: 0xad,
} as const;

/** Energy harvesting flags */
const NXP_EH = {
  ENABLE: 1 << 0,   // 0x01
  TRIGGER: 1 << 3,  // 0x08
  LOAD_OK: 1 << 7,  // 0x80
} as const;

/** I2C master status flags */
const NXP_I2C_M = {
  BUSY_MASK: 0x01,
  TRANS_STATUS_MASK: 0x06,
  TRANS_STATUS_SUCCESS: 3 << 1, // 0x06
} as const;

/** Temperature sensor I2C addresses */
const SENSOR_ADDRESSES = {
  PRIMARY: 0x48,    // VK Thermo single sensor
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
const VK_THERMO_AFI = 0x54;

/** VK Thermo DSFID-to-product mapping */
const VK_THERMO_DSFID: Record<number, {model: string; sensorType: SensorType}> = {
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

export type SensorType = 'tmp112' | 'tmp117' | 'tmp119' | 'unknown';
export type DeviceType = 'temptress' | 'thermo' | 'unknown';

/** A single temperature reading in both units */
export interface TemperatureReading {
  /** Temperature in degrees Celsius */
  celsius: number;
  /** Temperature in degrees Fahrenheit */
  fahrenheit: number;
}

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
    `[NTAG5Sensor] AFI=0x${afi.toString(16)} matches VK Thermo, DSFID=0x${dsfid?.toString(16) ?? 'undefined'}`,
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
// Energy Harvesting Control
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
async function enableEnergyHarvesting(
  uidBytes: number[],
  timeoutMs: number = 5000,
): Promise<boolean> {
  try {
    console.log('[NTAG5Sensor] EH Step 1: Triggering (charging capacitor)');

    // Step 1: Write TRIGGER only
    const triggerData = [NXP_EH.TRIGGER, 0x00, 0x00, 0x00];
    try {
      await sendNxpCustomCommand(
        NXP_CMD.WRITE_CONFIG,
        uidBytes,
        [NXP_CONFIG_ADDR.EH_CONFIG_REG, ...triggerData],
      );
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
      await sendNxpCustomCommand(
        NXP_CMD.WRITE_CONFIG,
        uidBytes,
        [NXP_CONFIG_ADDR.EH_CONFIG_REG, ...enableData],
      );
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
// I2C Passthrough via NTAG5
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
    numBytes - 1,   // Number of bytes - 1
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
    0x00,            // SRAM start address
    numBlocks - 1,   // Number of blocks - 1
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
        `[NTAG5Sensor] I2C transaction failed (status: 0x${status.toString(16)})`,
      );
    }

    return success;
  } catch {
    return false;
  }
}

// ============================================================================
// Sensor Identification
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
async function identifySensorAtAddress(
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
        `[NTAG5Sensor] Device ID write failed at 0x${i2cAddr.toString(16)} — likely TMP112`,
      );
      return 'tmp112';
    }
    console.debug(
      `[NTAG5Sensor] No sensor at 0x${i2cAddr.toString(16)}`,
    );
    return null;
  }

  // Read 2 bytes (Device ID)
  const idData = await i2cRead(uidBytes, i2cAddr, 2);
  if (!idData || idData.length < 2) {
    if (i2cAddr === SENSOR_ADDRESSES.PRIMARY) {
      console.log(
        `[NTAG5Sensor] Device ID read failed at 0x${i2cAddr.toString(16)} — likely TMP112`,
      );
      return 'tmp112';
    }
    return null;
  }

  const deviceId = (idData[0] << 8) | idData[1];
  const maskedId = deviceId & TMP117_DEVICE_ID_MASK;

  console.log(
    `[NTAG5Sensor] Device ID at 0x${i2cAddr.toString(16)}: 0x${deviceId.toString(16).padStart(4, '0')}`,
  );

  if (maskedId === TMP119_DEVICE_ID) {
    console.log(`[NTAG5Sensor] Sensor identified: TMP119 at 0x${i2cAddr.toString(16)}`);
    return 'tmp119';
  }

  if (maskedId === TMP117_DEVICE_ID) {
    console.log(`[NTAG5Sensor] Sensor identified: TMP117 at 0x${i2cAddr.toString(16)}`);
    return 'tmp117';
  }

  console.log(
    `[NTAG5Sensor] Unrecognized Device ID 0x${deviceId.toString(16)} at 0x${i2cAddr.toString(16)}`,
  );
  return i2cAddr === SENSOR_ADDRESSES.PRIMARY ? 'tmp112' : null;
}

// ============================================================================
// Temperature Reading
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
  return c * 9 / 5 + 32;
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
async function readTemperature(
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
        console.log(`[NTAG5Sensor] Temperature read retry ${attempt + 1}/${maxRetries}`);
      }

      // TMP112 defaults to register 0x00 on power-up, so try direct read first
      // For TMP117/119, always set the pointer explicitly
      if (sensorType !== 'tmp112' || attempt > 0) {
        const writeOk = await i2cWrite(uidBytes, i2cAddr, [TMP_REG_TEMPERATURE]);
        if (!writeOk) {
          console.warn(
            `[NTAG5Sensor] Failed to set temp register at 0x${i2cAddr.toString(16)} (attempt ${attempt + 1})`,
          );
          continue;
        }
      }

      // Read 2 bytes of temperature data
      const data = await i2cRead(uidBytes, i2cAddr, 2);
      if (!data || data.length < 2) {
        console.warn(
          `[NTAG5Sensor] Failed to read temp at 0x${i2cAddr.toString(16)} (attempt ${attempt + 1})`,
        );
        continue;
      }

      const raw = (data[0] << 8) | data[1];

      // Sanity check: raw value 0x0000 or 0xFFFF likely means sensor hasn't converted yet
      if (raw === 0x0000 || raw === 0xffff) {
        console.warn(
          `[NTAG5Sensor] Suspicious raw value 0x${raw.toString(16).padStart(4, '0')} at 0x${i2cAddr.toString(16)} — sensor may not be ready`,
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
        `${celsius.toFixed(2)}°C / ${fahrenheit.toFixed(2)}°F (raw: 0x${raw.toString(16).padStart(4, '0')})`,
      );

      return {
        celsius: Math.round(celsius * 100) / 100,
        fahrenheit: Math.round(fahrenheit * 100) / 100,
      };
    } catch (error) {
      console.warn(
        `[NTAG5Sensor] Temperature read failed at 0x${i2cAddr.toString(16)} (attempt ${attempt + 1}):`,
        error,
      );
    }
  }

  console.error(`[NTAG5Sensor] Temperature read exhausted all ${maxRetries} retries`);
  return undefined;
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
    const temp1 = await readTemperature(uidBytes, SENSOR_ADDRESSES.TEMPTRESS_1, sensorAt0x49);
    const temp2 = await readTemperature(uidBytes, SENSOR_ADDRESSES.TEMPTRESS_2, sensorAt0x4A);

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
    const implantName = sensorName
      ? `VK Thermo ${sensorName}`
      : 'VK Thermo';

    console.log(`[NTAG5Sensor] VK Thermo detected: ${sensorAt0x48} at 0x48`);

    // Read temperature from the sensor
    const temp = await readTemperature(uidBytes, SENSOR_ADDRESSES.PRIMARY, sensorAt0x48);

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

// ============================================================================
// Utility
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
