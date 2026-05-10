/**
 * Detector fixture suite
 *
 * Loads every JSON file under `../__fixtures__`, mocks the NFC manager so
 * each transceive returns the recorded response from the fixture, and runs
 * `detectChip` against the rawData. Each fixture's `expectedDetection` block
 * is the ground truth.
 *
 * Adding a new fixture: drop a JSON file into `__fixtures__/` — the test
 * picks it up automatically via `fs.readdirSync`.
 */

import * as fs from 'fs';
import * as path from 'path';

// Per-test fixture state. Set inside each test before calling detectChip.
// Names prefixed with `mock` so Jest allows reference from the hoisted
// jest.mock factory below.
interface MockFixtureCall {
  layer: string;
  command: string;
  response: string | null;
}
let mockActiveFixture: {
  apduCalls: MockFixtureCall[];
  /** UID exposed via NfcManager.getTag(); ISO 15693 detector reads it. */
  uid?: string;
} | null = null;

function mockBytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function mockHexToBytes(hex: string): number[] {
  const cleaned = hex.replace(/[:\s]/g, '').toLowerCase();
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    out.push(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Look up the next response for a given (layer, command) pair, consuming
 * fixture entries in order so repeated commands return their distinct
 * responses.
 */
function mockConsumeResponse(
  layer: string,
  command: number[],
): number[] | null | undefined {
  if (!mockActiveFixture) {
    throw new Error('No active fixture — set mockActiveFixture before calling');
  }
  const targetCommand = mockBytesToHex(command);
  const idx = mockActiveFixture.apduCalls.findIndex(
    c => c.layer === layer && c.command === targetCommand,
  );
  if (idx === -1) {
    return undefined;
  }
  const call = mockActiveFixture.apduCalls[idx];
  mockActiveFixture.apduCalls.splice(idx, 1);
  return call.response === null ? null : mockHexToBytes(call.response);
}

// ---------- mocks ----------

jest.mock('react-native', () => ({
  Platform: {OS: 'android', select: (obj: any) => obj.android ?? obj.default},
}));

jest.mock('react-native-nfc-manager', () => {
  const respond = (layer: string) => async (cmd: number[]): Promise<Uint8Array> => {
    const response = mockConsumeResponse(layer, cmd);
    if (response === undefined) {
      throw new Error(`Fixture has no response for ${layer}:${mockBytesToHex(cmd)}`);
    }
    if (response === null) {
      throw new Error('NAK');
    }
    return Uint8Array.from(response);
  };

  return {
    __esModule: true,
    default: {
      nfcAHandler: {transceive: jest.fn(respond('nfcA'))},
      isoDepHandler: {transceive: jest.fn(respond('isoDep'))},
      nfcVHandler: {transceive: jest.fn(respond('iso15693'))},
      sendMifareCommandIOS: jest.fn(respond('mifareIOS')),
      getTag: jest.fn(async () => ({
        id: mockActiveFixture?.uid ?? '',
      })),
    },
    NfcTech: {},
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// ---------- import after mocks ----------

import {detectChip} from '../detector';
import type {RawTagData} from '../../../types/nfc';

// ---------- fixture loading ----------

interface Fixture {
  name: string;
  rawData: {
    uid: string;
    sak?: number;
    atqa?: string;
    ats?: string;
    historicalBytes?: string;
    techTypes: string[];
  };
  apduCalls: MockFixtureCall[];
  apduResponses: Record<string, string | null>;
  expectedDetection: {
    type: string;
    implementation?: string;
    implementationByte?: string;
    confidence: 'high' | 'medium' | 'low';
    capabilities?: string[];
    chipName?: string;
    implantName?: string;
  };
}

const FIXTURES_DIR = path.join(__dirname, '..', '__fixtures__');

function loadFixtures(): Fixture[] {
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  return files.map(file => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8');
    return JSON.parse(raw) as Fixture;
  });
}

// ---------- the suite ----------

describe('detectChip — fixture suite', () => {
  const fixtures = loadFixtures();

  if (fixtures.length === 0) {
    test('no fixtures found', () => {
      throw new Error(`No fixtures in ${FIXTURES_DIR}`);
    });
    return;
  }

  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      // Clone apduCalls so each test gets a fresh consumption queue.
      mockActiveFixture = {
        apduCalls: fixture.apduCalls.map(c => ({...c})),
        uid: fixture.rawData.uid,
      };

      const rawData: RawTagData = {
        uid: fixture.rawData.uid,
        sak: fixture.rawData.sak,
        atqa: fixture.rawData.atqa,
        ats: fixture.rawData.ats,
        historicalBytes: fixture.rawData.historicalBytes,
        techTypes: fixture.rawData.techTypes as RawTagData['techTypes'],
      };

      const result = await detectChip(rawData);

      expect(result.success).toBe(true);
      expect(result.transponder).toBeDefined();
      expect(result.transponder?.type).toBe(fixture.expectedDetection.type);

      if (fixture.expectedDetection.implementation !== undefined) {
        expect(result.transponder?.implementation).toBe(
          fixture.expectedDetection.implementation,
        );
      }

      if (fixture.expectedDetection.capabilities) {
        // Order-insensitive subset check — the detector may add capabilities
        // beyond what was originally captured (e.g. when M7+ derives extra
        // tags for newly-supported substrates).
        for (const cap of fixture.expectedDetection.capabilities) {
          expect(result.transponder?.capabilities).toContain(cap);
        }
      }

      if (fixture.expectedDetection.implantName !== undefined) {
        expect(result.transponder?.implantName).toBe(
          fixture.expectedDetection.implantName,
        );
      }

      mockActiveFixture = null;
    });
  }
});
