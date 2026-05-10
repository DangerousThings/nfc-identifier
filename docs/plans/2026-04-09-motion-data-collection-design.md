# Motion Sensor Data Collection for NFC Scan Gesture Detection

**Date:** 2026-04-09
**Purpose:** Collect labeled accelerometer + gyroscope data from the DT NFC Identifier app to train an ML model that detects when a user transitions from reading results to attempting to scan a new transponder. The trained model will power the `useNfc` hook in the `detect-nfc-use` project (`/home/work/detect-nfc-use`).

## Context

The DT NFC Identifier app already has explicit scan buttons ("START", "TRY AGAIN") that users press to initiate NFC scanning. This makes it an ideal data collection platform: every button press is a labeled moment where the user decided to scan, and the sensor data preceding that press captures the "reaching to scan" gesture.

## What We're Collecting

### Sensor Data
- **Device motion** (fused accelerometer + gyroscope) via `expo-sensors`
- Sampled at **30Hz** (configurable)
- 6 values per sample: 3-axis acceleration (m/s^2) + 3-axis rotation rate (rad/s)
- Stored in a **ring buffer of 5 seconds** (150 samples) in memory

### Labeled Events

Each saved sample is a 3-second window (90 data points) preceding the event, tagged with a label:

| Label | Trigger | Meaning |
|-------|---------|---------|
| `scan_initiated` | User taps "START" or "TRY AGAIN" on ScanScreen | User transitioned from idle/reading to wanting to scan |
| `scan_success` | Tag successfully read after scan | Confirms the scan attempt was real |
| `scan_timeout` | Scan started but no tag found before cancel/error | User may have been testing, or gesture was ambiguous |
| `app_idle` | Periodic capture every 60s while on ResultScreen | Baseline "reading" posture data |

### Sample Schema

```typescript
interface MotionSample {
  id: string;                    // UUID
  timestamp: string;             // ISO 8601
  label: 'scan_initiated' | 'scan_success' | 'scan_timeout' | 'app_idle';
  deviceModel: string;           // e.g., "Pixel 7", "iPhone 15"
  platform: 'ios' | 'android';
  sensorData: {
    samplingRateHz: number;      // actual achieved rate
    readings: Array<{
      t: number;                 // ms offset from window start
      ax: number; ay: number; az: number;  // acceleration
      gx: number; gy: number; gz: number;  // gyroscope
    }>;
  };
}
```

### Storage

- Samples saved as JSON to `AsyncStorage` under key `motion_samples`
- Each sample is ~2-4KB
- Cap at **500 samples** locally before requiring export or auto-pruning oldest
- No PII, no location, no NFC tag data included

## Implementation Plan

### Phase 1: Privacy Consent (Do First)

Add an opt-in consent screen for motion data collection.

#### 1.1 Consent Screen (`src/screens/DataConsentScreen.tsx`)

Show on first launch (check AsyncStorage for `data_consent_status`). Display:

- **What we collect:** Motion sensor data (accelerometer and gyroscope) when you use the app
- **Why:** To improve automatic NFC scanning detection in future app versions
- **What we don't collect:** No personal information, no NFC tag contents, no location
- **Your choice:** You can opt in or out at any time in Settings

Two buttons:
- "HELP IMPROVE THE APP" (opt in) - `modeNormal` colored
- "NO THANKS" (opt out) - subdued text button

Store result in AsyncStorage as `data_consent_status: 'opted_in' | 'opted_out' | 'not_asked'`.

#### 1.2 Settings Toggle

Add a toggle to the app settings (or HomeScreen menu if no settings screen exists yet) to change consent at any time. Label: "Share motion data to improve scanning". Show a "Delete my data" button that clears all local samples.

#### 1.3 Consent State Hook (`src/hooks/useDataConsent.ts`)

```typescript
interface UseDataConsentResult {
  consentStatus: 'opted_in' | 'opted_out' | 'not_asked' | 'loading';
  setConsent: (status: 'opted_in' | 'opted_out') => Promise<void>;
  clearLocalData: () => Promise<void>;
}
```

### Phase 2: Motion Buffer Service

#### 2.1 Ring Buffer (`src/services/motion/motionBuffer.ts`)

```typescript
class MotionRingBuffer {
  private buffer: MotionReading[];
  private capacity: number;   // 150 (5s at 30Hz)
  private writeIndex: number;

  push(reading: MotionReading): void;
  getLastN(n: number): MotionReading[];  // get last N readings (for 3s window: 90)
  clear(): void;
}
```

#### 2.2 Motion Monitor Service (`src/services/motion/motionMonitor.ts`)

```typescript
class MotionMonitor {
  private buffer: MotionRingBuffer;
  private subscription: Subscription | null;

  start(): void;        // subscribe to DeviceMotion at 30Hz
  stop(): void;         // unsubscribe
  snapshot(durationMs: number): MotionReading[];  // grab last N ms of data
  isRunning(): boolean;
}
```

- Only starts if consent is `opted_in`
- Subscribes to `DeviceMotion` from `expo-sensors`
- Runs continuously while app is foregrounded

#### 2.3 Motion Monitor Hook (`src/hooks/useMotionMonitor.ts`)

Wraps MotionMonitor as a singleton, starts/stops based on consent status and app state (foreground only).

### Phase 3: Sample Collection Integration

#### 3.1 Sample Collector (`src/services/motion/sampleCollector.ts`)

```typescript
class SampleCollector {
  constructor(
    private monitor: MotionMonitor,
    private storage: AsyncStorage
  );

  async captureSample(label: MotionSample['label']): Promise<void>;
  async getSampleCount(): Promise<number>;
  async exportSamples(): Promise<MotionSample[]>;
  async clearSamples(): Promise<void>;
}
```

#### 3.2 Integration Points in Existing Code

**`src/hooks/useScan.ts`** - Add sample capture calls:

```typescript
// In startScan():
// BEFORE starting the NFC scan, capture the "scan_initiated" sample
if (consentStatus === 'opted_in') {
  await sampleCollector.captureSample('scan_initiated');
}

// After successful scan:
if (consentStatus === 'opted_in') {
  await sampleCollector.captureSample('scan_success');
}

// After timeout/error (non-cancel):
if (consentStatus === 'opted_in') {
  await sampleCollector.captureSample('scan_timeout');
}
```

**`src/screens/ResultScreen.tsx`** - Add periodic idle capture:

```typescript
// Set up 60-second interval for idle baseline capture
useEffect(() => {
  if (consentStatus !== 'opted_in') return;

  const interval = setInterval(() => {
    sampleCollector.captureSample('app_idle');
  }, 60000);

  return () => clearInterval(interval);
}, [consentStatus]);
```

### Phase 4: Data Export

#### 4.1 Automatic Upload to DT Cloud

Samples are uploaded automatically to a Nextcloud public share via WebDAV:

- **Endpoint:** `https://office.dngr.us/public.php/webdav/`
- **Auth:** Basic auth with share token `TJ6dgd7kjQmgBPA` as username, empty password
- **Method:** `PUT` per file

**File naming convention:** `{deviceModel}__{osVersion}__{timestamp}.json`
- Examples: `pixel7__android14__2026-04-09T12-00-00Z.json`, `iphone15__ios18.2__2026-04-09T12-00-00Z.json`
- Double underscore delimiter (device model and OS version can contain single underscores/dots)

**Upload behavior:**
- Upload each sample immediately after capture
- On upload failure, keep in local AsyncStorage queue for retry
- Retry queued samples on next successful upload or app foreground
- Cap local queue at 500 samples; prune oldest on overflow

#### 4.2 Upload Service (`src/services/motion/uploadService.ts`)

```typescript
class MotionUploadService {
  async upload(sample: MotionSample): Promise<boolean>;
  async retryQueue(): Promise<void>;
  async getQueueSize(): Promise<number>;
}
```

#### 4.3 Manual Export (Fallback)

Keep a "Export Motion Data" button in settings that:
1. Serializes all local (queued) samples to a single JSON file
2. Uses `Share` API to let user send via email/cloud/etc.
3. Shows sample count and estimated file size before export

## Dependencies to Add

```json
{
  "expo-sensors": "~15.0.0",
  "@react-native-async-storage/async-storage": "^2.1.0",
  "uuid": "^11.0.0"
}
```

Note: Check exact compatible versions against the project's Expo SDK 54.

## File Structure (New Files Only)

```
src/
  hooks/
    useDataConsent.ts          # consent state management
    useMotionMonitor.ts        # motion sensor subscription hook
  screens/
    DataConsentScreen.tsx      # first-launch opt-in screen
  services/
    motion/
      motionBuffer.ts          # ring buffer implementation
      motionMonitor.ts         # sensor subscription service
      sampleCollector.ts       # label + persist samples
      uploadService.ts         # WebDAV upload to DT Cloud
  types/
    motion.ts                  # MotionSample, MotionReading types
```

## Testing

- **motionBuffer.ts**: Unit test ring buffer behavior (overflow, snapshot extraction)
- **sampleCollector.ts**: Unit test labeling, storage cap enforcement, export format
- **Consent flow**: Manual test on device — verify consent screen shows once, toggle works, data clears
- **Sensor data**: Must test on physical device (simulators don't have real accelerometer/gyroscope)

## Privacy Considerations

- Samples uploaded automatically to DT Cloud (Nextcloud) when opted in
- Upload uses a public share link — no user credentials involved
- No NFC tag data, UIDs, or scan results included in motion samples
- Device model included (needed for ML) but no device ID or user identifier
- "Delete my data" clears all local samples immediately
- Consent can be revoked at any time; revocation stops collection and offers deletion

## Success Criteria

1. Consent screen appears on first launch, choice is persisted
2. Motion data is buffered continuously when opted in and app is foregrounded
3. Tapping "START" or "TRY AGAIN" captures a labeled `scan_initiated` sample
4. Successful scans capture `scan_success` samples
5. Idle baseline captured periodically on ResultScreen
6. Samples upload automatically to DT Cloud after capture
7. Failed uploads queue locally and retry on next opportunity
8. Samples can be exported as JSON via share sheet (fallback)
9. "Delete my data" clears all local samples
8. No measurable impact on scan UX or app performance
9. Battery impact is negligible for typical session length (< 5 minutes)
