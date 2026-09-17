# Transponder library, command sets, memory maps, and the magic handle

Date: 2026-09-17
Status: design agreed, ready to plan implementation

## Problem

Connecting to a tag today returns generics — tech types, UID, SAK. Callers then
re-derive what the chip is and how to talk to it. Worse, **four** copies of the
same "identify + transport" logic now exist and are drifting:

| Copy | Location | What it has |
|---|---|---|
| Identifier app | `dt-nfc-identifier/src/services/detection/*` (~8k LOC) | Full waterfall: NTAG, Classic, DESFire, Plus, JavaCard/CPLC, 15693, NTAG5, UG4 probe |
| NDEF Commander | `NDEF Commander/src/lib/{transport,identify}.ts` | T2/T4 identify, NDEF read/write transport |
| Magic Commander | `Magic Commander/src/lib/{transport,magic/*,clone,edit,reset}.ts` | Full magic stack: gen1a/2/3/4 command sets, fingerprint sweep, clone/edit/reset |
| (proposed) fork module | — | the one to rule them all |

## Goal

`NfcManager.identify()` returns a **`Transponder`**: the identified chip, its
**typed command set**, a **memory map with decoded config registers**, and —
when the tag answers a magic backdoor — a **`t.magic` handle** that is itself a
magic transponder object with its own command set. Build it once in the fork,
then retire the four copies by migrating every consumer onto it.

## Decisions (from brainstorming)

- **Home:** the fork (`@dangerousthings/react-native-nfc-manager`), new
  `src/transponders/` module. Detection moves out of the identifier app.
- **Language:** TypeScript, compiled to `lib/` by `tsc` on `npm pack`. `main`
  re-exports from `src/index.js`.
- **Scope now:** move *all* detection into the library. Full command sets +
  memory maps for the UG4-coverable Type 2 and Classic families in phase 1–2;
  ISO-DEP/NfcV families get identification + generic transceive first, full
  command sets later.
- **Command form:** typed methods on a per-chip class hierarchy (mirrors pm3py).
- **Memory maps:** named regions + bit-level config/access decoding
  (ported `BitField` from pm3py).
- **UG4 shape:** the emulated chip is primary (a UG4 wearing an NTAG215 *is* an
  NTAG215 to the waterfall); the backdoor hangs off `t.magic`.
- **Magic:** a generic `t.magic` discriminated union covering **all** magic
  types in the Proxmark3 notes, seeded by porting Magic Commander's tested
  modules, then extended. Detection is **opt-in** (`identify({probeMagic:true})`)
  because it sends unknown backdoor frames that a plain tag NAKs.
- **DT layer stays in the apps:** implant naming, `dtproducts` signatures,
  product matching, `capabilities`, fixture-capture toggle. The library
  identifies silicon + platform only.
- **Entry point:** `NfcManager.identify({onProgress, onExchange, probeMagic,
  magicPassword})`, plus a platform-neutral `identifyWith(transport)` for tests
  and non-RN consumers.
- **Consolidation:** build the library, then migrate all consumers
  (identifier app, NDEF Commander, Magic Commander, Blink Commander) and add the
  GP Mobile hand-off contract.

## Architecture

```
react-native-nfc-manager-dt/src/transponders/
├── identify.ts        # waterfall orchestrator (ported detector.ts, DT layer removed)
├── transport.ts       # canonical Transport (Magic Commander's shape) + platform impls
├── types.ts           # Transponder union, ChipType, MemoryRegion, Register/BitField
├── bitfield.ts        # ported from pm3py bitfield.py
├── probes/            # getversion, desfire, mifare(+plus), javacard, cplc, iso15693, ntag5
├── type2/             # type2 base, ultralight (UL/UL-C/EV1), ntag21x, ntagI2c
├── classic/           # Mini/1K/4K: auth, r/w, value blocks, trailer/access decode
└── magic/             # fingerprint sweep + per-gen command sets (ported + extended)
```

### Canonical `Transport` (Magic Commander's shape — the superset)

```ts
type Transport = {
  readonly kind: 'nfca' | 'nfcv' | 'isodep' | 'ndef'
  readonly uid: number[]
  readonly sak?: number
  readonly atqa?: number[]
  transceive(bytes: number[]): Promise<number[]>
  readonly ndef?: NdefTech        // read/write/capacity/type (NDEF Commander needs this)
  readonly mfc?: MfcTech          // Android MifareClassic tech
  readonly techs?: string[]       // android tech list, routes probes
  reconnect?(): Promise<void>     // clean-connection discipline for magic backdoors
}
class TagLostError extends Error {}   // + isTagLoss(e), ported verbatim
```

Prefer `nfca` for 14443-A: magic backdoors live at ISO 14443-3 (layer 3). A
SAK-08 tag's raw `CF` is dropped by the controller — detect via `sak`, not kind.

### `Transponder` (returned by `identify()`)

Discriminated union on `chip`. Common fields: `chip`, `family`, `uid`, `atqa`,
`sak`, `ats`, `historicalBytes`, `version` (parsed GET_VERSION / DESFire version
/ CPLC), `memory`, `platformLimits` (commands the chip has but this OS can't
run — e.g. Classic sectors on iOS), and optional `magic`.

Narrowing on `chip` exposes only that chip's methods:

- **Type 2:** `read`, `write`, `compatWrite`, `fastRead`, `getVersion`,
  `readSig`, `pwdAuth`; EV1 adds `readCnt`/`incrCnt`/`checkTearingEvent`;
  I²C adds `sectorSelect`; UL-C adds `authenticate3des`.
- **Classic:** `auth(sector,keyType,key)`, `readBlock`, `writeBlock`,
  `increment`/`decrement`/`restore`/`transfer` (Android; iOS → `platformLimits`).
- **ISO-DEP / NfcV, not yet modelled** (DESFire, Plus, JavaCard, DNA, 15693,
  NTAG5): parsed version/CPLC + generic `transceive`/`sendApdu`/`sendNfcV`. Full
  command sets are a later phase. `// ponytail:` marks each stub.

Each method builds the frame, transceives, validates length + ACK/NAK, returns
parsed data. A 4-bit NAK throws `NfcNakError` with a named code.

**Universal `readUserMemory(opts?)`.** One `abstract` method on every
transponder dumps user memory sector-aware, so callers never special-case the
chip: `Promise<MemorySector[]>` where `MemorySector = {sector, blocks:
{address, bytes}[]}`. Type 2 returns one sector (pages, via FAST_READ or a read
loop); NTAG I²C returns one sector per bank (loops `sectorSelect`); Classic
returns one per Classic sector, authing with `opts.keys` (or default
`FFFFFFFFFFFF`) and omitting sectors that fail; ISO 15693 / NTAG5 return one
sector of blocks (READ_MULTIPLE_BLOCK). The crypto/file-based families
(DESFire, Plus, JavaCard, DNA) and the `GenericTransponder` fallback return
`[]`. `opts` (`{keys?, keyType?}`) is honored only by Classic; other families
ignore it.

### Memory map + config registers

`memory.regions`: static per-chip `{name, start, end, unit, access, note}`
covering UID/BCC, lock, CC, user, dynamic lock, CFG0/1, PWD, PACK, sector
trailers. `bitfield.ts` (ported pm3py) gives typed registers — `Ntag21xConfig`,
`UlEv1Config`, `NtagI2cConfig`, `ClassicAccessBits`, `Ug4Config` — that decode
from and encode to bytes. `readConfig()` returns one; `writeConfig(reg)` writes.

### The `t.magic` handle

Present when the tag answers any backdoor. Discriminated union on `magic.gen`.
Every variant has `gen`, `label`, `verified`, and a raw `backdoor(bytes)` escape
hatch; each adds its own typed methods. Covers all magic types in the Proxmark3
notes:

- **Classic:** gen1a (UID), gen1b, gen2/CUID, gen3/APDU, USCUID, FUID, UFUID,
  ZUID, GDM, GDCUID, Super.
- **UL/NTAG:** UL gen1a, UL DirectWrite, UL EV1 DirectWrite, UL-C gen1a,
  NTAG213 DirectWrite, USCUID-UL.
- **Multi:** gen4 / UMC (the UG4).

Gen1a/2/3/4 are ported from Magic Commander (tested, sniffed). The rest are
modelled from the notes and flagged `verified:false` until sniffed on a card.

**UG4 specifics:** identify with `CF <pwd> CC` (version — the notes warn `C6`
can mutate config on some cards, so `C6` is read-only-on-demand via
`readConfig()`). Setters: `setAtqaSak`, `setAts`, `setUidLength`, `setProtocol`
(69), `setUlMode` (6A), `setGtuMode` (32), `setMaxBlocks` (6B),
`setBlock0DirectWrite` (CF), `writeConfig` (F0), `changePassword` (FE);
`readBlock` (CE) / `writeBlock` (CD). No F1 (permanent fuse) — out of scope.
`applyPreset(chip,{uidLength})` writes F0 + max blocks + version blocks (250–251)
so GET_VERSION reports the emulated chip. I²C presets and 10-byte UIDs ship
`verified:false`. After any reconfigure the `Transponder` is `stale`; re-run
`identify()`.

`magicPassword` option lets a caller probe a UG4 whose backdoor password was
changed (else it's missed — Magic Commander already does this).

**UG4 relocates PWD/PACK, and mirrors it — the emulated chip's password methods
delegate to the gen4 handle.** Per Magic Commander's phone-verified gen4 code, a
UMC does NOT just relocate PWD/PACK to fixed pages — it also **mirrors** them:
the password must be written to **both 0xE5 and 0xF0** (the reader-side PWD_AUTH
reads it from 0xF0), and the PACK to **0xF1 as well as** the revision's PACK page
(**0xE6**, or **0x13** on 06A0/6666 — determined at runtime by `CF CC`). A simple
"repoint `pwdPage`/`packPage`" (the earlier plan) can't express the mirror. So
the model is: when the sweep detects a Gen4, the emulated chip's `setPassword`/
`setPack` are **overridden to delegate to the gen4 handle's mirrored writes**
(`gen4.setPassword` → 0xE5+0xF0, `gen4.setPack` → rev-page+0xF1), **only if the
emulated chip supports password protection** (NTAG21x/UL EV1/NTAG I²C — the ones
that define `pwdPage`/`packPage`). If the emulated coat has no PWD/PACK feature
(plain UL, UL-C's 3DES, a Classic's Crypto1), the override is a no-op. So a
UG4-as-NTAG215 gets correct mirrored password writes; a UG4-as-plain-UL stays
password-less. Scope: PWD/PACK only; CFG0/CFG1 left native, flagged unverified.

### Magic detection is capability-gated and behavioral

The sweep (ported from Magic Commander's `fingerprint()` + `caps`) is **opt-in**
(`identify({probeMagic, platform, rawAvailable, magicPassword})`), **capability-
gated**, and **reconnects (close→connect) before each probe** (a NAK wedges the
next). Realities baked in:
- **iOS supports no magic** — CoreNFC can't send the raw frames any backdoor
  needs, so the gate returns an empty set and the sweep is a no-op on iOS.
- **gen1a needs the BYOK-OS RawReader** (its unlock is a 7-bit `0x40` frame with
  no stock-Android path); gen2/gen3/gen4/magic-ul/magic-icode run on stock
  Android. gen2 additionally needs the platform `mfc` tech (Crypto1 in the
  controller).
- **Behavioral probes, not SAK-trust:** magic-ul is detected by an
  unauthenticated `0x30` READ (a card that answers IS NTAG/UL whatever its SAK —
  catches a UG4-emulating-NTAG-with-Classic-SAK); gen2/CUID and magic-icode by a
  **no-op write of the tag's own bytes** (only a magic clone ACKs it — safe,
  non-destructive). A Classic-SAK (0x08/0x18) that answers no backdoor is
  reported as plain Classic (a stock-Android controller drops raw CF on it).
- **gen4 phone constraints:** the CF status word is at the **front** of a CF
  response (not trailing); a raw CF frame is honoured only as the **first frame
  after SELECT** (a CF after `0xA2` T2T writes is ignored → tag loss), so
  reconfigure issues all CF up front then only T2T writes; UID writes are
  **coat-dependent** (Ultralight coat = `0xA2` page writes, Classic coat = `CF
  CD` block 0); and a Classic-emulating UG4 is set to **SAK 0x28 + JCOP dual ATS**
  by default so its backdoor stays reachable over NfcA on a phone (native Classic
  SAK strands it).

### The waterfall

Ports the identifier app's AN10833 order unchanged: tag info → ISO-DEP branch
(DESFire/Plus/JavaCard/DNA) → Type 2 branch (GET_VERSION, else UL AUTHENTICATE)
→ Classic (SAK 08/09/18, Plus SL1, EV3C) → NfcV (15693/SLIX/NTAG5). Magic sweep
runs last, opt-in, on a fresh connection per probe.

## Consumer considerations

- **NDEF Commander** — its `Transport`/`identify` is a subset of the canonical
  shape. Migrate onto `identify()`; keep its NDEF `read/write/capacity/type`
  surface on `Transport.ndef`. Retire its `identify.ts`.
- **Magic Commander** — the reference implementation. Its `magic/*` +
  `clone`/`edit`/`reset` are lifted as the seed of `t.magic`; it then consumes
  the library instead of carrying its own copy.
- **GP Mobile** — the library identifies JavaCards (CPLC + AID probe) and
  **stops at the ISD boundary**. It never opens a secure channel —
  `@globalplatform/core` owns SELECT/SCP02/SCP03/PUT KEY. Contract:
  `identify()` **leaves the ISO-DEP connection open and clean** so GP Mobile can
  `select(ISD_AID)` + `openScp0x` on the same session (no reconnect, respects
  the "one request at a time" constraint), and the parsed **CPLC is surfaced**
  on the `Transponder` so GP Mobile reads it instead of re-fetching (it keys
  SCP02-vs-SCP03 and batch quirks off CPLC/version).
- **Blink Commander** — not an identifier consumer; it writes LED pattern banks
  to **NTAG5 (ISO 15693)** and **NTAG I²C** EEPROM. It needs the **write side**
  of those command sets (`writeBlock`/`WRITE_SINGLE_BLOCK`, `sectorSelect`,
  `getVersion`) as first-class typed methods, and the NTAG5 model must cover the
  Boost/Link-driving-a-GreenPAK case.

## Testing

- **Replay:** `identifyWith(transport)` drives the waterfall from recorded
  exchanges. The app's 16 fixtures + Magic Commander's move into the fork suite.
- **Unit (no hw):** every `BitField` round-trips; every memory map's regions are
  non-overlapping and within chip size (the one required ponytail check per
  parser).
- **On hardware:** each magic variant and UG4 preset gets a Proxmark3 sniff +
  logcat before `verified:true`. Unverified variants ship labelled.

## Phasing (each ends green: typecheck + tests, independently shippable)

1. **Scaffold** — module, `tsc` build, `types.ts`, `bitfield.ts`, canonical
   `transport.ts`, `identify()`/`identifyWith()` returning tag-info only.
2. **Type 2 + Classic** — full command sets (incl. writes), memory maps, config
   registers; port GET_VERSION + Classic probes.
3. **ISO-DEP + NfcV probes** — port DESFire, Plus, JavaCard/CPLC, DNA, 15693,
   NTAG5 (identify + generic transceive). Implement GP hand-off contract
   (leave-clean + CPLC surfaced).
4. **Magic** — port Magic Commander's gen1a/2/3/4 + clone/edit/reset; add the
   remaining variants (USCUID/-UL, GDM, GDCUID, FUID/UFUID/ZUID, DirectWrite,
   Super); opt-in sweep.
5. **Migrate identifier app** — swap to `identify()`, delete moved code, adapter
   maps library `Transponder` → app UI.
6. **Hardware verification pass** — sniff every magic variant + UG4 preset, flip
   `verified`.
7. **Migrate other consumers** — NDEF Commander (retire its identify/transport),
   Magic Commander (consume magic handle), Blink Commander (typed NTAG5/I²C
   writes). GP Mobile already covered by phase 3 contract.

## Non-goals

- GlobalPlatform secure channel / key management (stays in `@globalplatform/core`).
- UG4 permanent fuse (F1).
- Crypto1 key cracking (phone can't; clone needs a gen1a/gen4 destination).
- DT product matching and implant naming (stay in the apps).
