/**
 * A scanned Ultimate Gen4 matches only UG4 implants — not the NTAG/Ultralight
 * products its emulated coat would otherwise pull in.
 */

import {matchChipToProducts} from '../matcher';
import {ChipType} from '../../../types/detection';
import type {Transponder} from '../../../types/detection';

function ug4Chip(overrides: Partial<Transponder> = {}): Transponder {
  return {
    type: ChipType.ULTRALIGHT,
    cardModeInfo: {
      hasMultipleModes: true,
      modeType: 'ultimate_gen4',
      confidence: 'high',
      description: 'Ultimate gen4 magic transponder',
    },
    rawData: {uid: '04:11:22:33:44:55:66', techTypes: []},
    capabilities: [],
    ...overrides,
  } as unknown as Transponder;
}

describe('matchChipToProducts — Ultimate Gen4', () => {
  it('returns only the UG4 implants', () => {
    const result = matchChipToProducts(ug4Chip());
    const ids = result.exactMatches.map(m => m.product.id).sort();
    expect(ids).toEqual(['dug4t', 'flexug4']);
    expect(result.cloneTargets).toEqual([]);
    expect(result.familyMatches).toEqual([]);
    // every match is genuinely a UG4 product
    for (const {product} of result.exactMatches) {
      expect(
        product.features.some(f => f.toLowerCase().includes('ultimate gen4')),
      ).toBe(true);
    }
  });

  it('does not treat a normal Ultralight as UG4', () => {
    const plain = ug4Chip({cardModeInfo: undefined});
    const ids = matchChipToProducts(plain).exactMatches.map(m => m.product.id);
    expect(ids).not.toContain('dug4t');
  });
});
