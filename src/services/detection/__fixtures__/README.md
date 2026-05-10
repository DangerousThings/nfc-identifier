# Detection Fixtures

JSON snapshots of real card scans, used by the detector test suite to
exercise the full detection pipeline without physical hardware.

Each fixture captures:

- `rawData` — UID + tech types as exposed by react-native-nfc-manager
- `apduCalls` — every transceive command/response pair the detector
  issued, in the order issued (re-order is irrelevant for matching but
  preserved for human readability)
- `apduResponses` — the same data keyed by `<layer>:<command-hex>` for
  fast lookup by a mock transceive layer
- `expectedDetection` — the Transponder fields the detector is expected
  to produce (chipType, implementation, capabilities, etc.)

## Anonymization

These fixtures are derived from cards belonging to real users. UIDs and
any user-identifying memory contents have been redacted. The detector
does not depend on UID *content* — only on UID *length* (4-byte vs 7-byte)
to gate magic-card cloning rules — so anonymization preserves test
fidelity. Per-fixture redactions are documented in each file's
`anonymizationNotes` field where applicable.

Common transformations:
- 7-byte NXP UIDs: byte 0 (manufacturer 0x04) preserved, remaining 6
  bytes zeroed
- ISO 15693 8-byte UIDs: trailing manufacturer bytes (`04:E0`) preserved,
  remaining bytes zeroed; embedded UID echoes in getSystemInfo responses
  updated to match
- VivoKey URL identifiers in NDEF: user-specific suffix replaced with
  ASCII zeros
- Fidesmo IC serial (last 4 bytes of the 12-byte response): zeroed;
  product/fabrication fields preserved so the detector still identifies
  the card correctly
- JavaCard Memory `persistentTotal`: preserved (it's a chip-level
  capacity, not a user secret, and is the discriminator between Apex
  and flexSecure)

## Adding new fixtures

1. Build a dev APK with fixture capture enabled (M9 toggle in Settings)
2. Scan the card and tap "COPY FIXTURE JSON" on the result screen
3. Anonymize per the rules above (or use the anonymizer script when one
   exists)
4. Save here as `<chip-kebab-case>.json`
