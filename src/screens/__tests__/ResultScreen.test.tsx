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

jest.mock('@dangerousthings/react-native-nfc-manager', () => ({
  __esModule: true,
  default: {},
  NfcTech: {},
  NfcAdapter: {
    FLAG_READER_NFC_A: 0x1,
    FLAG_READER_SKIP_NDEF_CHECK: 0x80,
    FLAG_READER_NO_PLATFORM_SOUNDS: 0x100,
  },
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
    useDTTheme: () => ({
      colors: {background: '#000000', onBackground: '#FFFFFF', surface: '#000000'},
      custom: {
        modeNormal: '#00FFFF',
        modeEmphasis: '#FFFF00',
        modeWarning: '#FF0000',
        modeSuccess: '#00FF00',
        modeOther: '#FF00FF',
        border: '#00FFFF',
        borderEmphasis: '#FFFF00',
      },
    }),
  };
});

// Navigation internals the screen touches. `usePreventRemove` needs a real
// navigator, so it's replaced with a recorder the swipe-back tests drive.
let mockPreventRemoveEnabled = false;
let mockPreventRemoveHandler:
  | ((e: {data: {action: {type: string}}}) => void)
  | null = null;
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: (
    enabled: boolean,
    callback: (e: {data: {action: {type: string}}}) => void,
  ) => {
    mockPreventRemoveEnabled = enabled;
    mockPreventRemoveHandler = callback;
  },
}));
jest.mock('@react-navigation/elements', () => ({HeaderBackButton: () => null}));

let mockSwipeBackAction = 'restart-scan';
jest.mock('../../hooks/useSwipeBack', () => ({
  useSwipeBack: () => ({
    action: mockSwipeBackAction,
    setAction: jest.fn(),
  }),
}));

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

function navigationMock() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
    dispatch: jest.fn(),
  };
}

function renderWith(t: Transponder, navigation = navigationMock()) {
  let tree!: ReactTestRenderer;
  renderer.act(() => {
    tree = renderer.create(
      <ResultScreen
        route={{params: {tagData: t.rawData, transponder: t}} as any}
        navigation={navigation as any}
      />,
    );
  });
  return {tree, navigation};
}

function render(t: Transponder): string[] {
  return textOf(renderWith(t).tree);
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


describe('swipe back setting', () => {
  // Platform.OS is 'ios' under the react-native jest preset. On iOS the swipe
  // is a native dismissal (POP) and the header arrow is our own button
  // (GO_BACK); on Android it's the other way round — see the Android block.
  const swipe = {data: {action: {type: 'POP'}}};
  const headerBack = {data: {action: {type: 'GO_BACK'}}};

  afterEach(() => {
    mockSwipeBackAction = 'restart-scan';
    mockPreventRemoveHandler = null;
    mockPreventRemoveEnabled = false;
  });

  test('the default restarts the scan, replacing rather than stacking', () => {
    const {navigation} = renderWith(apex2Ring());

    expect(mockPreventRemoveEnabled).toBe(true);
    renderer.act(() => mockPreventRemoveHandler!(swipe));

    expect(navigation.replace).toHaveBeenCalledWith('Scan');
    expect(navigation.popToTop).not.toHaveBeenCalled();
  });

  test('"home" pops the whole result stack', () => {
    mockSwipeBackAction = 'home';
    const {navigation} = renderWith(apex2Ring());

    renderer.act(() => mockPreventRemoveHandler!(swipe));

    expect(navigation.popToTop).toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test('"previous result" leaves the plain stack pop alone', () => {
    mockSwipeBackAction = 'previous-result';
    renderWith(apex2Ring());

    expect(mockPreventRemoveEnabled).toBe(false);
  });

  // The header arrow and the Android system back dispatch GO_BACK, not the
  // POP a native dismissal sends. Only the gesture follows the setting.
  test('a header back is passed straight through', () => {
    const {navigation} = renderWith(apex2Ring());

    renderer.act(() => mockPreventRemoveHandler!(headerBack));

    expect(navigation.dispatch).toHaveBeenCalledWith(headerBack.data.action);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.popToTop).not.toHaveBeenCalled();
  });
});

describe('swipe back on Android', () => {
  // The system back gesture is the platform back event, which React Navigation
  // dispatches as GO_BACK — the reverse of iOS. Getting this backwards is what
  // made the setting silently do nothing on Android.
  const {Platform} = require('react-native');
  const original = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true});
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', {value: original, configurable: true});
    mockSwipeBackAction = 'restart-scan';
  });

  test('the system back gesture follows the setting', () => {
    const {navigation} = renderWith(apex2Ring());

    expect(mockPreventRemoveEnabled).toBe(true);
    renderer.act(() => mockPreventRemoveHandler!({data: {action: {type: 'GO_BACK'}}}));

    expect(navigation.replace).toHaveBeenCalledWith('Scan');
  });

  test('the native header arrow still pops the stack', () => {
    const {navigation} = renderWith(apex2Ring());

    renderer.act(() => mockPreventRemoveHandler!({data: {action: {type: 'POP'}}}));

    expect(navigation.dispatch).toHaveBeenCalledWith({type: 'POP'});
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test('the header keeps its native back button', () => {
    const {navigation} = renderWith(apex2Ring());

    expect(navigation.setOptions).toHaveBeenCalledWith({headerLeft: undefined});
  });
});
