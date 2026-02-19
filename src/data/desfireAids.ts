/**
 * DESFire Application ID Database
 *
 * Curated from proxmark3 aid_desfire.json (212 entries) and deduplicated
 * into ~80 unique systems with range matching for multi-AID systems.
 *
 * Source: https://github.com/RfidResearchGroup/proxmark3/blob/master/client/resources/aid_desfire.json
 * License: GPL-3.0 (proxmark3 contributors)
 *
 * AID format: 3-byte DESFire application ID as 6-char uppercase hex string (MSB first)
 * e.g., Gallagher CAD = "F48120"
 */

export interface DesfireAidInfo {
  /** Display name for the application */
  name: string;
  /** Vendor / operator */
  vendor: string;
  /** Application category */
  type: 'pacs' | 'transport' | 'student' | 'payment' | 'vehicle' | 'ndef' | 'other';
  /** Country code(s) */
  country?: string;
}

// ============================================================================
// Exact-match AID lookup
// ============================================================================

const DESFIRE_AID_DB: Record<string, DesfireAidInfo> = {
  // -- NDEF --
  EEEE10: {name: 'NDEF', vendor: 'NFC Forum', type: 'ndef', country: 'US'},

  // -- PACS: HID SEOS --
  '53494F': {name: 'HID SEOS', vendor: 'HID', type: 'pacs', country: 'US'},
  D3494F: {name: 'HID SEOS', vendor: 'HID', type: 'pacs', country: 'US'},
  D9494F: {name: 'HID SEOS', vendor: 'HID', type: 'pacs', country: 'US'},
  F484E3: {name: 'HID SEOS EV3', vendor: 'HID', type: 'pacs', country: 'US'},
  F484E4: {name: 'HID SEOS EV3', vendor: 'HID', type: 'pacs', country: 'US'},
  F484D1: {name: 'HID SEOS', vendor: 'HID', type: 'pacs', country: 'US'},

  // -- PACS: Salto --
  F48EF1: {name: 'Salto Systems', vendor: 'Salto Systems', type: 'pacs', country: 'ES'},
  F48EFD: {name: 'Salto KS', vendor: 'Salto Systems', type: 'pacs', country: 'ES'},

  // -- PACS: Schlage / Allegion --
  F532F0: {name: 'Schlage aptiQ', vendor: 'Schlage / Allegion', type: 'pacs', country: 'US'},

  // -- PACS: ASSA ABLOY --
  F51780: {name: 'ASSA ABLOY SMARTair', vendor: 'ASSA ABLOY', type: 'pacs', country: 'SE'},

  // -- PACS: Inner Range --
  F47300: {name: 'Inner Range SIFER', vendor: 'Inner Range', type: 'pacs', country: 'AU'},

  // -- PACS: Securitron --
  F473A0: {name: 'Securitron', vendor: 'Securitron / ASSA ABLOY', type: 'pacs', country: 'US'},

  // -- PACS: Openpath --
  '6F706C': {name: 'Openpath', vendor: 'Openpath', type: 'pacs', country: 'US'},

  // -- PACS: LEGIC --
  '000357': {name: 'LEGIC', vendor: 'LEGIC', type: 'pacs', country: 'DE'},

  // -- PACS: Prima --
  '4791DA': {name: 'Prima FlexAir', vendor: 'Prima Systems', type: 'pacs', country: 'SI'},

  // -- PACS: RBH --
  '706000': {name: 'RBH BlueLINE', vendor: 'RBH Access Technologies', type: 'pacs', country: 'CA'},

  // -- PACS: STid --
  F51BC0: {name: 'STid Easyline', vendor: 'STid Group', type: 'pacs', country: 'FR'},

  // -- PACS: MOBOTIX --
  F534F1: {name: 'MOBOTIX Access', vendor: 'MOBOTIX AG', type: 'pacs', country: 'DE'},

  // -- PACS: dormakaba mobile --
  F53280: {name: 'dormakaba mobile access', vendor: 'dormakaba', type: 'pacs', country: 'CH'},

  // -- PACS: Telenot (alarm system) --
  F518F0: {name: 'Telenot Tag', vendor: 'Telenot Electronic', type: 'pacs', country: 'DE'},

  // -- PACS: UniFi Access --
  '764970': {name: 'UniFi Access', vendor: 'Ubiquiti', type: 'pacs'},
  '84D3FC': {name: 'UniFi Access', vendor: 'Ubiquiti', type: 'pacs'},
  '416343': {name: 'UniFi Access', vendor: 'Ubiquiti', type: 'pacs'},
  '454955': {name: 'UniFi Access (Express)', vendor: 'Ubiquiti', type: 'pacs'},
  '534955': {name: 'UniFi Access (Secure)', vendor: 'Ubiquiti', type: 'pacs'},

  // -- Transit: ORCA (Seattle) --
  F21030: {name: 'ORCA', vendor: 'Puget Sound Transit / Vix', type: 'transport', country: 'US'},
  F213F0: {name: 'ORCA', vendor: 'Puget Sound Transit / Vix', type: 'transport', country: 'US'},

  // -- Transit: Clipper (San Francisco) --
  F21190: {name: 'Clipper Card', vendor: 'MTC / Cubic', type: 'transport', country: 'US'},
  F21191: {name: 'Clipper Card (Mobile)', vendor: 'MTC / Cubic', type: 'transport', country: 'US'},

  // -- Transit: Oyster (London) --
  '4F5931': {name: 'Oyster Card', vendor: 'TfL / Cubic', type: 'transport', country: 'GB'},

  // -- Transit: Opal (Sydney) --
  '534531': {name: 'Opal Card', vendor: 'TfNSW / Pearl', type: 'transport', country: 'AU'},

  // -- Transit: PRESTO (Toronto) --
  '002000': {name: 'PRESTO Card', vendor: 'Metrolinx / Accenture', type: 'transport', country: 'CA'},
  FF30FF: {name: 'PRESTO Card', vendor: 'Metrolinx / Accenture', type: 'transport', country: 'CA'},

  // -- Transit: myki (Melbourne) --
  F210F0: {name: 'myki', vendor: 'PTV / Conduent', type: 'transport', country: 'AU'},
  F21100: {name: 'myki', vendor: 'PTV / Conduent', type: 'transport', country: 'AU'},

  // -- Transit: OMNY (New York) / BMW Digital Key --
  '0000F0': {name: 'OMNY / BMW Digital Key', vendor: 'MTA / BMW', type: 'transport', country: 'US'},

  // -- Transit: HSL (Helsinki) --
  EF2011: {name: 'HSL Card (Old)', vendor: 'Helsinki Region Transport', type: 'transport', country: 'FI'},
  EF2014: {name: 'HSL Card', vendor: 'Helsinki Region Transport', type: 'transport', country: 'FI'},

  // -- Transit: nol (Dubai) --
  '784000': {name: 'nol Card', vendor: 'RTA Dubai', type: 'transport', country: 'AE'},

  // -- Transit: Ventra (Chicago) --
  F21381: {name: 'Ventra Card', vendor: 'CTA / Cubic', type: 'transport', country: 'US'},

  // -- Transit: hop fastpass (Portland) --
  F210E0: {name: 'hop fastpass', vendor: 'TriMet / INIT', type: 'transport', country: 'US'},

  // -- Transit: AT HOP (Auckland) --
  '554000': {name: 'AT HOP Card', vendor: 'Auckland Transport / Thales', type: 'transport', country: 'NZ'},

  // -- Transit: HOLO (Honolulu) --
  F21360: {name: 'HOLO Card', vendor: 'City of Honolulu / INIT', type: 'transport', country: 'US'},

  // -- Transit: Bee Card (Dunedin) --
  F21390: {name: 'Bee Card', vendor: 'Otago Regional / INIT', type: 'transport', country: 'NZ'},

  // -- Transit: NORTIC (Norway) --
  '578000': {name: 'NORTIC', vendor: 'Norwegian Roads Admin', type: 'transport', country: 'NO'},
  '578001': {name: 'NORTIC', vendor: 'Norwegian Roads Admin', type: 'transport', country: 'NO'},

  // -- Transit: Adelaide metroCARD --
  F206B0: {name: 'metroCARD', vendor: 'Adelaide Metro / ACS', type: 'transport', country: 'AU'},

  // -- Transit: NJ FARE-PAY --
  F20330: {name: 'FARE-PAY Card', vendor: 'NJ Transit / Conduent', type: 'transport', country: 'US'},

  // -- Transit: Sofia City Card --
  '9034CA': {name: 'Sofia City Card', vendor: 'Urban Mobility Center', type: 'transport', country: 'BG'},

  // -- Transit: Doha Travel Pass --
  '634000': {name: 'Doha Travel Pass', vendor: 'Qatar Rail', type: 'transport', country: 'QA'},

  // -- Transit: Dublin Leap Card --
  '2211AF': {name: 'Leap Card', vendor: 'NTA Ireland', type: 'transport', country: 'IE'},

  // -- Transit: Athens ATH.ENA --
  '415431': {name: 'ATH.ENA Card', vendor: 'OASA Athens', type: 'transport', country: 'GR'},

  // -- Transit: Madrid / beep --
  '010000': {name: 'Tarjeta Transporte / beep', vendor: 'CRTM / AF Payments', type: 'transport', country: 'ES/PH'},

  // -- Transit: Istanbulkart --
  '012242': {name: 'Istanbulkart', vendor: 'Belbim', type: 'transport', country: 'TR'},
  '042242': {name: 'Istanbulkart', vendor: 'Belbim', type: 'transport', country: 'TR'},
  '052242': {name: 'Istanbulkart', vendor: 'Belbim', type: 'transport', country: 'TR'},
  '062242': {name: 'Istanbulkart', vendor: 'Belbim', type: 'transport', country: 'TR'},

  // -- Transit: Wroclaw URBANCARD --
  '0183F1': {name: 'URBANCARD', vendor: 'Wroclaw Transit', type: 'transport', country: 'PL'},
  '0283F1': {name: 'URBANCARD', vendor: 'Wroclaw Transit', type: 'transport', country: 'PL'},
  '0383F1': {name: 'URBANCARD', vendor: 'Wroclaw Transit', type: 'transport', country: 'PL'},

  // -- Transit: Christchurch Metrocard / Edmonton Arc --
  F21050: {name: 'Metrocard / Arc', vendor: 'Metro CHC / INIT', type: 'transport', country: 'NZ/CA'},

  // -- Transit: TRIPKO (Manila) --
  '081117': {name: 'TRIPKO Card', vendor: 'JourneyTech', type: 'transport', country: 'PH'},

  // -- Transit: Connect Transit (Sacramento) --
  F21240: {name: 'Connect Transit Card', vendor: 'SACOG / INIT', type: 'transport', country: 'US'},

  // -- Transit: Go CT (Connecticut) --
  F212A0: {name: 'Go CT Card', vendor: 'CTtransit / Genfare', type: 'transport', country: 'US'},

  // -- Transit: Spokane Connect Card --
  F21400: {name: 'Connect Card', vendor: 'STA / INIT', type: 'transport', country: 'US'},

  // -- Transit: Green Bay / Winnipeg --
  F21201: {name: 'Tap-N-Go / peggo', vendor: 'Genfare', type: 'transport', country: 'US/CA'},
  F21202: {name: 'Tap-N-Go', vendor: 'Genfare', type: 'transport', country: 'US'},

  // -- Transit: Wave (Rhode Island) --
  F213A0: {name: 'Wave Smart Card', vendor: 'RIPTA / INIT', type: 'transport', country: 'US'},

  // -- Transit: BAT Card (Bilbao) --
  F001D0: {name: 'BAT Card', vendor: 'Euskotren', type: 'transport', country: 'ES'},

  // -- Transit: AHORROBUS (Mexico) --
  C1B1A1: {name: 'AHORROBUS Card', vendor: 'MOBILITY ADO', type: 'transport', country: 'MX'},

  // -- Transit: Mi Movilidad (Guadalajara) --
  '484000': {name: 'Mi Movilidad Card', vendor: 'SITEUR', type: 'transport', country: 'MX'},

  // -- Transit: Urbana (Ljubljana) --
  '000002': {name: 'Urbana Card', vendor: 'LPP Ljubljana', type: 'transport', country: 'SI'},
  '000005': {name: 'T-mobilitat / Urbana', vendor: 'TMB / LPP', type: 'transport', country: 'ES/SI'},

  // -- Transit: Reserved multi-use --
  '000001': {name: 'Transit (multi-city)', vendor: 'Various', type: 'transport'},

  // -- Student: Transact Campus --
  BBBBB3: {name: 'Transact Campus ID', vendor: 'Transact Campus', type: 'student', country: 'US'},
  BBBBBB: {name: 'Transact Campus ID', vendor: 'Transact Campus', type: 'student', country: 'US'},
  BBBBDA: {name: 'Transact Campus ID', vendor: 'Transact Campus', type: 'student', country: 'US'},
  BCBCBC: {name: 'Transact Campus ID', vendor: 'Transact Campus', type: 'student', country: 'US'},
  CA1827: {name: 'Transact Campus ID', vendor: 'Transact Campus', type: 'student', country: 'US'},

  // -- Student: European Student Card --
  '3086F5': {name: 'European Student Card', vendor: 'CNOUS/CROUS', type: 'student', country: 'FR'},
  '4085F5': {name: 'European Student Card', vendor: 'CNOUS/CROUS', type: 'student', country: 'FR'},
  '7086F5': {name: 'European Student Card', vendor: 'CNOUS/CROUS', type: 'student', country: 'FR'},
  '9180F3': {name: 'European Student Card', vendor: 'CNOUS/CROUS', type: 'student', country: 'FR'},
  A086F5: {name: 'European Student Card', vendor: 'CNOUS/CROUS', type: 'student', country: 'FR'},

  // -- Student: Slovenian University --
  '554E49': {name: 'Slovenian University ID', vendor: 'Slovenian Universities', type: 'student', country: 'SI'},

  // -- Student: ASSA ABLOY Campus --
  '010010': {name: 'Campus Card', vendor: 'ASSA ABLOY', type: 'student', country: 'GB'},
  EEE010: {name: 'Campus Card', vendor: 'ASSA ABLOY', type: 'student', country: 'GB'},

  // -- Student: Algonquin College --
  '030020': {name: 'Campus Card', vendor: 'Algonquin College', type: 'student', country: 'CA'},
  '050030': {name: 'Campus Card', vendor: 'Algonquin College', type: 'student', country: 'CA'},
  '070090': {name: 'Campus Card', vendor: 'Algonquin College', type: 'student', country: 'CA'},

  // -- Student: Visitor badges --
  F33480: {name: 'Visitor Badge', vendor: 'Besucherausweis', type: 'student', country: 'DE'},
  F482D0: {name: 'Visitor Badge', vendor: 'Besucherausweis', type: 'student', country: 'DE'},

  // -- Payment: Disney MagicBand --
  '27E178': {name: 'Disney MagicBand', vendor: 'Disney', type: 'payment', country: 'US'},
  '44434C': {name: 'Disney MagicBand', vendor: 'Disney', type: 'payment', country: 'US'},
  '78E127': {name: 'Disney MagicBand', vendor: 'Disney', type: 'payment', country: 'US'},

  // -- Payment: ping.ping --
  '956B19': {name: 'ping.ping Tag', vendor: 'Alfa-Zet', type: 'payment', country: 'BE'},
  DB9800: {name: 'ping.ping Tag', vendor: 'Alfa-Zet', type: 'payment', country: 'BE'},
  DB9801: {name: 'ping.ping Tag', vendor: 'Alfa-Zet', type: 'payment', country: 'BE'},
  DB9802: {name: 'ping.ping Tag', vendor: 'Alfa-Zet', type: 'payment', country: 'BE'},

  // -- Payment: Microtronic / AIR Amsterdam --
  F38091: {name: 'Microtronic Tag', vendor: 'Microtronic AG', type: 'payment', country: 'CH'},
  F380F0: {name: 'AIR Amsterdam Card', vendor: 'AIR Amsterdam / Microtronic', type: 'payment', country: 'NL'},

  // -- Vehicle: Lucid Motors --
  '4B4550': {name: 'Lucid Motors Valet', vendor: 'Lucid Motors', type: 'vehicle', country: 'US'},

  // -- Vehicle: car2go --
  C26001: {name: 'car2go Card (Defunct)', vendor: 'Free2move', type: 'vehicle', country: 'DE'},
};

// ============================================================================
// Range matchers for multi-AID systems
// Checked in order; first match wins.
// ============================================================================

interface AidRangeMatcher {
  /** Test whether an AID (uppercase hex) belongs to this system */
  match: (aid: string) => boolean;
  info: DesfireAidInfo;
}

const AID_RANGE_MATCHERS: AidRangeMatcher[] = [
  // Gallagher: 2081F4 through 2F81F4
  {
    match: (aid) => {
      if (!aid.endsWith('81F4') || aid.length !== 6) return false;
      const prefix = parseInt(aid.substring(0, 2), 16);
      return prefix >= 0x20 && prefix <= 0x2f;
    },
    info: {name: 'Gallagher', vendor: 'Gallagher Group', type: 'pacs', country: 'NZ'},
  },
  // dormakaba evolo: F52100 through F52166
  {
    match: (aid) => {
      if (!aid.startsWith('F521')) return false;
      const suffix = parseInt(aid.substring(4, 6), 16);
      return suffix >= 0x00 && suffix <= 0x66;
    },
    info: {name: 'dormakaba evolo', vendor: 'dormakaba', type: 'pacs', country: 'CH'},
  },
  // ICT Access Control
  {
    match: (aid) => aid === 'F52310' || aid === '1023F5' || aid === 'F52318' || aid === 'F5231E' || aid === 'F5231F',
    info: {name: 'ICT Access', vendor: 'ICT', type: 'pacs', country: 'NZ'},
  },
  // InterCard Campus: *845F pattern
  {
    match: (aid) => aid.endsWith('845F') && aid.length === 6,
    info: {name: 'InterCard Campus', vendor: 'InterCard GmbH', type: 'student', country: 'DE'},
  },
  // TU Delft: 535501-53550B, F5217D, F88280
  {
    match: (aid) => {
      if (aid === 'F5217D' || aid === 'F88280') return true;
      if (!aid.startsWith('5355')) return false;
      const suffix = parseInt(aid.substring(4, 6), 16);
      return suffix >= 0x01 && suffix <= 0x0b;
    },
    info: {name: 'TU Delft', vendor: 'TU Delft', type: 'student', country: 'NL'},
  },
  // Delhi Metro: ends with 4D44
  {
    match: (aid) => aid.endsWith('4D44') && aid.length === 6,
    info: {name: 'Delhi Metro', vendor: 'Delhi Metro Rail Corp', type: 'transport', country: 'IN'},
  },
  // Bangkok BEM/BTS: ends with 5342
  {
    match: (aid) => aid.endsWith('5342') && aid.length === 6,
    info: {name: 'Bangkok Transit', vendor: 'BEM / BTS', type: 'transport', country: 'TH'},
  },
  // Masabi Justride: specific AIDs with XX00XX pattern
  {
    match: (aid) => ['6C006C', '7A007A', 'CC00CC', 'D000D0', 'DD00DD'].includes(aid),
    info: {name: 'Masabi Justride Transit', vendor: 'Masabi', type: 'transport'},
  },
  // ITSO (UK transit): A00216, F40110-F40114
  {
    match: (aid) => {
      if (aid === 'A00216') return true;
      if (!aid.startsWith('F401')) return false;
      const suffix = parseInt(aid.substring(4, 6), 16);
      return suffix >= 0x10 && suffix <= 0x14;
    },
    info: {name: 'ITSO Transit', vendor: 'ITSO Ltd', type: 'transport', country: 'GB'},
  },
  // Umo Mobility
  {
    match: (aid) => ['087522', '677F8E', '992CB5', 'A4237D', 'C65B80'].includes(aid),
    info: {name: 'Umo Mobility', vendor: 'Umo / Cubic', type: 'transport', country: 'US/CA'},
  },
  // beep Card (Manila): 010000-040000
  {
    match: (aid) => {
      if (!aid.endsWith('0000') || aid.length !== 6) return false;
      const prefix = parseInt(aid.substring(0, 2), 16);
      return prefix >= 0x02 && prefix <= 0x04;
    },
    info: {name: 'beep Card', vendor: 'AF Payments', type: 'transport', country: 'PH'},
  },
  // Cyprus motion BUS CARD
  {
    match: (aid) => ['402301', '502301', '602301'].includes(aid),
    info: {name: 'motion BUS CARD', vendor: 'Cyprus Transport', type: 'transport', country: 'CY'},
  },
];

// ============================================================================
// Public API
// ============================================================================

/** AIDs to filter from display (always present, not informative) */
const HIDDEN_AIDS = new Set(['000000', 'FFFFFF']);

/**
 * Look up a DESFire AID by its 6-character uppercase hex string.
 * Checks exact match first, then range matchers.
 */
export function lookupDesfireAid(aidHex: string): DesfireAidInfo | undefined {
  const upper = aidHex.toUpperCase();

  // Exact match first
  const exact = DESFIRE_AID_DB[upper];
  if (exact) return exact;

  // Range matchers
  for (const matcher of AID_RANGE_MATCHERS) {
    if (matcher.match(upper)) return matcher.info;
  }

  return undefined;
}

/**
 * Whether an AID should be hidden from display.
 */
export function isHiddenAid(aidHex: string): boolean {
  return HIDDEN_AIDS.has(aidHex.toUpperCase());
}

/**
 * Format a display label for a DESFire AID.
 * Known AIDs show their name; unknown show "App 0xABCDEF".
 */
export function formatDesfireAidLabel(aidHex: string): string | null {
  const upper = aidHex.toUpperCase();
  if (isHiddenAid(upper)) return null;

  const info = lookupDesfireAid(upper);
  if (info) return info.name;
  return `App 0x${upper}`;
}
