/**
 * Official DT product detection via ATS historical bytes.
 *
 * Signatures come from open_smartcard_batching `main.py` hist_bytes map.
 */

import {matchDtHistoricalSignature} from '../dtproducts';

/** ASCII → hex, the form historical bytes arrive in. */
function ascii(s: string): string {
  return Array.from(s)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

describe('official implant signatures', () => {
  test('JDNGRfS180 → flexSecure implant', () => {
    const m = matchDtHistoricalSignature(ascii('JDNGRfS180'));
    expect(m).toEqual({
      name: 'flexSecure',
      kind: 'implant',
      signature: 'JDNGRfS180',
    });
  });

  test('JDNGRfS452 → flexSecure 452 implant', () => {
    const m = matchDtHistoricalSignature(ascii('JDNGRfS452'));
    expect(m?.name).toBe('flexSecure 452');
    expect(m?.kind).toBe('implant');
  });
});

describe('official card signatures', () => {
  test('J3R180DNGR → J3R180 card', () => {
    const m = matchDtHistoricalSignature(ascii('J3R180DNGR'));
    expect(m).toEqual({name: 'J3R180', kind: 'card', signature: 'J3R180DNGR'});
  });

  test('J3R452DNGR → J3R452 card', () => {
    const m = matchDtHistoricalSignature(ascii('J3R452DNGR'));
    expect(m?.name).toBe('J3R452');
    expect(m?.kind).toBe('card');
  });
});

describe('future / optional models (regex generality)', () => {
  test('a new J3R### card matches without a code change', () => {
    const m = matchDtHistoricalSignature(ascii('J3R999DNGR'));
    expect(m).toEqual({name: 'J3R999', kind: 'card', signature: 'J3R999DNGR'});
  });

  test('a new flexSecure model matches and is numbered', () => {
    const m = matchDtHistoricalSignature(ascii('JDNGRfS316'));
    expect(m?.name).toBe('flexSecure 316');
    expect(m?.kind).toBe('implant');
  });

  test('the marker without a model is plain flexSecure', () => {
    const m = matchDtHistoricalSignature(ascii('JDNGRfS'));
    expect(m?.name).toBe('flexSecure');
    expect(m?.kind).toBe('implant');
  });

  test('DNGRfS452 without the leading J still matches (J is optional)', () => {
    expect(matchDtHistoricalSignature(ascii('DNGRfS452'))?.name).toBe(
      'flexSecure 452',
    );
  });
});

describe('robustness', () => {
  test('matches when the identity has a status byte around it', () => {
    // ATS may carry a category-indicator/status byte around the historical
    // bytes; a non-printable separator splits it into its own printable run.
    const m = matchDtHistoricalSignature('80' + ascii('J3R452DNGR') + '00');
    expect(m?.name).toBe('J3R452');
  });

  test('tolerates colon separators', () => {
    const hex = ascii('JDNGRfS180')
      .match(/.{2}/g)!
      .join(':');
    expect(matchDtHistoricalSignature(hex)?.name).toBe('flexSecure');
  });

  test('undefined historical bytes → no match', () => {
    expect(matchDtHistoricalSignature(undefined)).toBeUndefined();
  });

  test('unrelated historical bytes → no match', () => {
    // A real MIFARE Plus historical-byte prefix, not a DT signature.
    expect(matchDtHistoricalSignature('C1052F2F9035C7')).toBeUndefined();
  });

  test('a bare J3R180 (no DT signature) is not flagged official', () => {
    // Silicon present, but no historical-byte signature written.
    expect(matchDtHistoricalSignature('')).toBeUndefined();
  });
});
