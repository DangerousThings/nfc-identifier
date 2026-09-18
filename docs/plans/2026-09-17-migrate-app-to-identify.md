# Phase 5 — Migrate the identifier app onto `NfcManager.identify()`

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or executing-plans) to implement this plan task-by-task.

**Goal:** Replace this app's ~8k-line in-app chip-detection waterfall with the
fork's `NfcManager.identify()` (phases 1–4), keeping the DT-specific layer
(implant naming, `dtproducts` signatures, product matching, `capabilities`,
`credentials`, fixture-capture) on top of the library's `Transponder`.

**Boundary (decided):** chip identification MOVES OUT (delete
`src/services/detection/{detector,ntag,mifare,desfire,javacard,iso15693,ntag5sensor,getversion,cplc,gen4}.ts`);
the DT layer STAYS. An adapter maps the library `Transponder` → the app's
`Transponder`/UI so `useScan`, `ResultScreen`, `matcher`, `warnings` change
minimally.

**Fork consumption (decided):** merge `transponder-library` → fork `main`,
bump to `3.17.2-dt.5`, tag `v3.17.2-dt.5`, push to git.dngr.us; the app's
`package.json` git-tag dep moves `#v3.17.2-dt.3` → `#v3.17.2-dt.5`.

**Tech stack:** RN/Expo SDK 57, TS 6, jest. Fork ships TS source (Metro
transpiles); the git dep installs the fork's `src/**` incl. `src/transponders`.

**Working dir:** the worktree `.worktrees/migrate-to-identify` (branch
`feature/migrate-to-identify`). Baseline: `tsc --noEmit` clean on `main`.
**Install quirk (CLAUDE.md):** the other `@dangerousthings/*` deps resolve from
local sources, so a full `npm install` fails — install per that note (unpack the
dt.5 fork over `node_modules/@dangerousthings/react-native-nfc-manager` rather
than a clean install), and run `npm install` in the worktree first to populate
`node_modules` (it currently has none).

---

### Task 1: Fork release — cut `v3.17.2-dt.5`

**Repo:** `~/react-native-nfc-manager-dt` (NOT the app worktree). This is the one outward-facing, hard-to-reverse step — do it deliberately.

**Steps:**
1. In `~/react-native-nfc-manager-dt` (on `main`): `git merge --no-ff transponder-library` (41 commits; expect a clean merge — the branch descends from `main`'s tip `9ce83ba`).
2. Bump `package.json` `version` `3.17.2-dt.4` → `3.17.2-dt.5`. Commit.
3. `npm run typecheck` + `npx jest src/transponders` in the fork → confirm green (458 transponder tests; the 3 pre-existing `transceiveToPresentTag` failures are the known baseline).
4. Tag `v3.17.2-dt.5`; push `main` + the tag to `origin` (git.dngr.us).
5. Verify: `git ls-remote --tags origin | grep dt.5`.

**Verification:** the tag exists on the remote; the fork's `main` carries the transponder module. Note in the report that main now carries the `verified:false` magic types (labeled) ahead of hardware verification (phase 6) — that was the accepted trade-off.

Commit (fork): the merge + `chore: release 3.17.2-dt.5 (transponder identify + magic)`.

---

### Task 2: App dependency bump + install + smoke import

**Files:** `package.json` (app).

**Steps:**
1. Change the dep `@dangerousthings/react-native-nfc-manager` from `#v3.17.2-dt.3` → `#v3.17.2-dt.5`. Also update `package-lock.json` accordingly.
2. Install per the CLAUDE.md quirk (the `@dangerousthings/*` local-source issue): populate `node_modules`, then ensure `node_modules/@dangerousthings/react-native-nfc-manager` is the dt.5 content (unpack the fork tgz / git content over it). Confirm `src/transponders/index.ts` (and `identify`) is present under it.
3. Smoke test: a throwaway TS file imports `{ identifyWith, ChipType, ChipFamily }` and `NfcManager` (default), and `NfcManager.identify` types as a function. `npx tsc --noEmit` on it → exit 0. Delete the throwaway.

**Verification:** `identify`/`identifyWith`/the transponder types resolve from the package; `tsc --noEmit` clean. Commit `chore: consume nfc-manager dt.5`.

---

### Task 3: Coupling audit + the adapter

**Investigate first (report findings):** the DT-layer files that STAY (`capabilities.ts`, `credentials.ts`, `dtproducts.ts`, `fixtureRecorder.ts`, `matching/matcher.ts`, `matching/warnings.ts`) and `types/detection.ts`, `data/chipInfo.ts`, `data/products.ts` currently import from the detection modules being DELETED. Enumerate every symbol they pull from `{detector,ntag,mifare,desfire,javacard,iso15693,ntag5sensor,getversion,cplc,gen4}.ts` (types like `ChipType`, `GetVersionDecoded`, `DesfireVersionInfo`, `CPLCData`, `Iso15693SystemInfo`, and helper fns). For each: does the library export an equivalent (it exports `ChipType`/`ChipFamily`/`getChipFamily`, `GetVersionDecoded`, `CPLCData`, config registers, etc.)? Produce a re-source map (app-internal symbol → library export, or "keep in app").

**Files:** create `src/services/detection/adapter.ts` (or `src/services/identify/adapter.ts`).

- `adapter.ts` exports `identifyTransponder(onProgress?, onExchange?): Promise<AppTransponder>` that calls `NfcManager.identify({onProgress, onExchange, probeMagic: <per settings>, platform, rawAvailable})` and maps the library `Transponder` → the app's `Transponder` shape (`src/types/detection.ts`). Map: `chip`→app `type`/`subtype`, `family`, `uid`/`sak`/`atqa`/`ats`/`historicalBytes`→app `rawData`, `memory`, and `magic` (UG4 → the app's `cardModeInfo.modeType='ultimate_gen4'` per CLAUDE.md), and attach the DT layer's derived fields (see Task 5). Prefer having `types/detection.ts` **re-export `ChipType`/`ChipFamily`/`getChipFamily` from the library** (they were ported FROM this app, identical values) so there's one enum — verify the values match exactly and switch the app to the library's.
- Decide & document: does the app keep its own `Transponder` interface (adapter maps into it) or adopt the library's `Transponder` (BaseTransponder)? Prefer keeping the app's interface for minimal UI churn, adapter bridges. Flag if the library `Transponder` is a strict superset that the app could adopt directly.

**Test:** `adapter.test.ts` — a fake library `Transponder` (each family + a UG4 magic case) maps to the expected app `Transponder` fields. Use the app's existing `__fixtures__` where they fit.

Commit `feat: identify() adapter (library Transponder → app Transponder)`.

---

### Task 4: Rewire `useScan` onto the adapter

**Files:** `src/hooks/useScan.ts`, `src/hooks/useFixtureCapture.ts`.

- Replace `detectChip(tagData, step => …)` (line ~155) with `identifyTransponder(onProgress, onExchange)`. The library owns the tag connection now — reconcile how `useScan` currently acquires `tagData` (raw tag) vs `identify()` running on the connected tag: `NfcManager.identify()` runs on the already-connected tag, so `useScan` calls it inside the existing request-technology/scan session. Preserve the scan state machine (idle/scanning/success/error), progress callback, and error handling.
- Fixture capture: wire the library's `onExchange(cmd, resp)` to `fixtureRecorder` (replacing the old detectChip-wrapped capture). Confirm `useFixtureCapture`'s toggle still gates it.

**Test:** update `useScan` tests (mock `NfcManager.identify`); assert the state machine + progress + a mapped result.

Commit `feat: useScan uses identify() via the adapter`.

---

### Task 5: Rewire the DT layer + ResultScreen + matcher

**Files:** `src/screens/ResultScreen.tsx`, `src/services/matching/{matcher,warnings}.ts`, `src/services/detection/{capabilities,credentials,dtproducts,fixtureRecorder}.ts`, `src/data/{chipInfo,products}.ts`, `src/types/detection.ts`.

- Re-source every symbol from the delete-list per Task 3's map: point imports at `@dangerousthings/react-native-nfc-manager` (ChipType/ChipFamily/getChipFamily, GetVersionDecoded, CPLCData, config registers, DesfireVersionInfo if the library exposes it — else keep a thin app copy).
- `capabilities.ts`/`credentials.ts`: these derive DT capabilities/credentials from the parsed chip data. Feed them the library `Transponder` (via the adapter) instead of the old detector's result. `emulatedCredentials` (used by ResultScreen) and `deriveCapabilities` keep their logic; only their INPUT type changes.
- `matcher.ts` / `warnings.ts`: consume the app `Transponder` (unchanged shape via the adapter) — should need only import fixups. Keep the UG4 short-circuit (`matchChipToProducts` → UG4-only implants) working off `magic.gen==='gen4'` / `cardModeInfo.modeType`.
- `ResultScreen.tsx`: `getChipFamily` now from the library; `fixtureRecorder`/`emulatedCredentials` still app-local. The CHIP IDENTIFIED card's UG4 chip + confidence rendering unchanged.

**Test:** `matcher.ug4.test.ts` + `matcher` tests still pass against the adapter output; `ResultScreen.test.tsx` updated for the new import graph.

Commit `feat: DT layer + matcher + ResultScreen consume the library Transponder`.

---

### Task 6: Delete the moved chip-ID code

**Files:** delete `src/services/detection/{detector,ntag,mifare,desfire,javacard,iso15693,ntag5sensor,getversion,cplc,gen4}.ts` and their `__tests__` for detection internals (keep `dtproducts`, `credentials`, `capabilities`, `fixtureRecorder` and their tests). Prune `src/services/detection/index.ts` to export only what remains. Remove `nfc/commands.ts` builders that the library now owns IF nothing app-side still uses them (audit first — some may be used by the DT layer; keep those).

- Fix every dangling import surfaced by `tsc --noEmit`.
- Keep `src/services/detection/__fixtures__/` if the adapter/DT-layer tests reuse them; else move relevant ones next to their new consumers.

**Verification:** `npx tsc --noEmit` clean; `npx jest` green (excluding any pre-existing unrelated failures — record them first). No import references the deleted files.

Commit `refactor: delete in-app chip detection (moved to the library)`.

---

### Task 7: Verify on device (per the standing rule)

Per project memory ("verify UI on emulator before claiming done"): build + install + drive the app on the emulator and confirm a scan still identifies a chip and renders the CHIP IDENTIFIED card (and, if a UG4/magic fixture is available, the UG4 path). Use the `run` skill / the app's build flow. Capture a screenshot.

- If a device build isn't possible in this environment, run the full jest suite + typecheck as the fallback gate and FLAG that on-device verification is outstanding (do not claim done without it).

Commit nothing unless fixes are needed; report the verification evidence.

---

## Phase 5 done when
- Fork `v3.17.2-dt.5` is tagged + pushed; the app depends on it and installs.
- `useScan` + the DT layer + matcher + ResultScreen run off `NfcManager.identify()` via the adapter; the in-app chip-ID modules are deleted.
- `tsc --noEmit` clean; `jest` green (minus recorded pre-existing failures); on-device scan verified (or on-device flagged outstanding with tests+typecheck green).
- The UG4 short-circuit + CHIP IDENTIFIED UG4 chip still work.

## Deferred / flagged
- Fork `main` carries `verified:false` magic types ahead of phase-6 hardware verification (accepted).
- Phase 7 (migrate NDEF/Magic/Blink Commander onto the library, retire their duplicate stacks) is separate.
- If `identify()`'s connection model doesn't match `useScan`'s existing session handling, Task 4 may need a small fork-side tweak — flag rather than hack around it.

## Note for the executor
The riskiest coupling is the DT layer importing detection internals (Task 3
audit). Do that audit BEFORE deleting anything (Task 6). Keep the app's
`Transponder` interface stable so the UI/matcher barely move; the adapter absorbs
the shape difference. Record any pre-existing app test failures at the start so
"green" is well-defined, exactly as the fork work tracked its 3 baseline failures.
