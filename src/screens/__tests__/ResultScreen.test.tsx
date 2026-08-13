/**
 * ResultScreen — chip card headline and form-factor tag.
 *
 * The rule these pin down: an identified product is the headline ("Apex 2
 * Ring", not "J3R452"), and only a genuine implant is tagged as one. A ring
 * is worn, not implanted, and an Apex named by storage size alone could be
 * either — so it gets no tag at all.
 *
 * Rendered rather than asserted on the detector output, because the bug this
 * guards against lives in the view: the detector can name the product
 * perfectly and the card can still print the part number.
 */

import React from 'react';
import renderer, {type ReactTestRenderer} from 'react-test-renderer';

// The screen's entry animations run on the native driver, which doesn't exist
// under react-test-renderer. Freezing timers means they're scheduled and never
// started — the tree still renders its final content, which is all we assert.
jest.useFakeTimers();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {},
  NfcTech: {},
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@dangerousthings/react-native', () => {
  const {View, Text} = require('react-native');
  const passthrough =
    (testID: string) =>
    ({children, title}: any) =>
      (
        <View testID={testID}>
          {title ? <Text>{title}</Text> : null}
          {children}
        </View>
      );
  return {
    DTCard: passthrough('DTCard'),
    DTButton: passthrough('DTButton'),
    DTChip: passthrough('DTChip'),
    DTLabel: ({primaryText}: any) => {
      const {Text: T} = require('react-native');
      return <T>{primaryText}</T>;
    },
    DTColors: {
      modeNormal: '#00FFFF',
      modeEmphasis: '#FFFF00',
      modeWarning: '#FF0000',
      modeSuccess: '#00FF00',
      modeOther: '#FF00FF',
      dark: '#000000',
      light: '#FFFFFF',
    },
  };
});

jest.mock('expo-clipboard', () => ({setStringAsync: jest.fn()}));
jest.mock('../../hooks/useDataConsent', () => ({
  useDataConsent: () => ({consent: false, setConsent: jest.fn()}),
}));
jest.mock('../../hooks/useFixtureCapture', () => ({
  useFixtureCapture: () => ({enabled: false}),
  isFixtureCaptureEnabled: () => false,
}));
jest.mock('../../services/motion', () => ({
  sampleCollector: {start: jest.fn(), stop: jest.fn(), collect: jest.fn()},
}));
jest.mock('../../services/detection/fixtureRecorder', () => ({
  getLastFixture: () => null,
  buildFixtureJson: () => '{}',
}));

import {ResultScreen} from '../ResultScreen';
import {ChipType, type Transponder, type ProductKind} from '../../types/detection';

function transponder(overrides: Partial<Transponder> = {}): Transponder {
  return {
    type: ChipType.JCOP4,
    family: 'JavaCard',
    chipName: 'JavaCard',
    isCloneable: false,
    rawData: {uid: '04AABBCC', techTypes: ['android.nfc.tech.IsoDep']},
    confidence: 'high',
    detectedOn: 'android',
    ...overrides,
  } as Transponder;
}

/** Every string the screen renders, in document order. */
function collectStrings(node: any): string[] {
  if (node == null) {
    return [];
  }
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectStrings);
  }
  return collectStrings(node.children);
}

function textOf(tree: ReactTestRenderer): string[] {
  return collectStrings(tree.toJSON());
}

function render(t: Transponder): string[] {
  let tree!: ReactTestRenderer;
  renderer.act(() => {
    tree = renderer.create(
      <ResultScreen
        route={{params: {tagData: t.rawData, transponder: t}} as any}
        navigation={{navigate: jest.fn(), goBack: jest.fn()} as any}
      />,
    );
  });
  return textOf(tree);
}

const apex2Ring = (kind: ProductKind = 'wearable') =>
  transponder({
    implantName: 'Apex 2 Ring',
    productKind: kind,
    cplc: {icType: 0xd600, icTypeName: 'J3R452'} as Transponder['cplc'],
    installedApplets: ['Fidesmo', 'Visa'],
  });

describe('chip card headline', () => {
  test('an Apex 2 Ring is named, not reduced to its silicon', () => {
    const text = render(apex2Ring());

    expect(text).toContain('Apex 2 Ring');
    // The part number belongs under SECURE ELEMENT, not in the headline.
    expect(text.indexOf('Apex 2 Ring')).toBeLessThan(text.indexOf('J3R452'));
  });

  test('a ring is never called an implant', () => {
    expect(render(apex2Ring())).not.toContain('IMPLANT DETECTED');
  });

  test('an Apex of unknown form factor claims nothing', () => {
    const text = render(
      transponder({
        implantName: 'Apex 2',
        productKind: 'unknown',
        cplc: {icType: 0xd600, icTypeName: 'J3R452'} as Transponder['cplc'],
      }),
    );

    expect(text).toContain('Apex 2');
    expect(text).not.toContain('IMPLANT DETECTED');
  });

  test('a Fidesmo wearable is never tagged as an implant', () => {
    // The contradiction this guards against: "IMPLANT DETECTED" printed
    // directly above the word "Wearable".
    const text = render(
      transponder({
        implantName: 'Fidesmo Wearable',
        productKind: 'wearable',
        cplc: {icType: 0xd600, icTypeName: 'J3R452'} as Transponder['cplc'],
      }),
    );

    expect(text).toContain('Fidesmo Wearable');
    expect(text).not.toContain('IMPLANT DETECTED');
  });

  test('a genuine implant keeps its tag', () => {
    const text = render(
      transponder({
        type: ChipType.NTAG216,
        chipName: 'NTAG216',
        implantName: 'xNT',
        productKind: 'implant',
      }),
    );

    expect(text).toContain('IMPLANT DETECTED');
    expect(text).toContain('xNT');
  });

  test('a payment card keeps the chip headline and names its network', () => {
    const text = render(
      transponder({
        implantName: 'Visa Payment Card',
        productKind: 'payment-card',
        cplc: {icType: 0xd600, icTypeName: 'J3R452'} as Transponder['cplc'],
      }),
    );

    expect(text).toContain('J3R452');
    expect(text).toContain('PAYMENT DEVICE DETECTED');
    expect(text).toContain('Visa');
    expect(text).not.toContain('IMPLANT DETECTED');
  });

  test('a wearable is not offered implant matches', () => {
    // The catalog is implants end to end; presenting it to someone holding a
    // ring frames the two as interchangeable.
    const text = render(apex2Ring());

    expect(text).not.toContain('Similar Implants');
    expect(text).not.toContain('Compatible Implants');
  });

  test('an unidentified chip is still offered implants — the point of the app', () => {
    const text = render(transponder({type: ChipType.MIFARE_CLASSIC_1K, chipName: 'MIFARE Classic 1K', isCloneable: true}));
    expect(text).toContain('Compatible Implants');
  });

  test('an unidentified chip still falls back to the chip name', () => {
    const text = render(transponder({type: ChipType.NTAG216, chipName: 'NTAG216'}));
    expect(text).toContain('NTAG216');
  });
});
