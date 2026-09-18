# Migrate the app to nfc-manager dt.6 + the standalone @dangerousthings/transponders package

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or executing-plans) to implement this plan task-by-task.

**Goal:** Move this app from the phase-5 setup (nfc-manager **dt.5** with the
transponder library *embedded* at `@dangerousthings/react-native-nfc-manager/src/transponders/…`,
consumed via deep leaf imports) to the released **dt.6** split:
- `@dangerousthings/react-native-nfc-manager` **v3.17.2-dt.6** — the fork with
  `src/transponders/` REMOVED; `NfcManager.identify()` now `require()`s the
  transponders package (optional dep; throws a clear error if absent).
- **`@dangerousthings/transponders`** (v0.1.0, git.dngr.us:MikeFaith/transponders,
  CommonJS `dist/` + `src/`) — the extracted identify/typed-Transponder/magic
  library, imported from its package root.

**Net win:** the package is a side-effect-free CommonJS dist, so this migration
**removes** the phase-5 fragilities: the deep `…/src/transponders/…` leaf imports
AND the "import from the nfc-manager root crashes Jest (native module)" workaround
in `types/detection.ts`. Transponders symbols now come from a clean package root.

**Working dir:** the app worktree `.worktrees/migrate-to-identify` (branch
`feature/migrate-to-identify`), which currently builds+installs to the Pixel.

## PREREQUISITE (blocking — user says "about to be released")
Do not start until BOTH exist on git.dngr.us:
- `@dangerousthings/react-native-nfc-manager` tag **`v3.17.2-dt.6`** (fork main is at `a11706e`, version already `3.17.2-dt.6`; confirm the tag is pushed).
- `@dangerousthings/transponders` a published tag/tarball (repo has commits through `83a1df0`; confirm a release ref, e.g. `v0.1.0`, is pushed).
Confirm both with `git ls-remote --tags` before Task 1. If either is unreleased, STOP and report.

**Baseline (current app):** `tsc --noEmit` clean; `npx jest --watchman=false` green (jest run with `--watchman=false` in this worktree). node_modules is a hardlink from the main checkout + dt.5 unpacked (the `@dangerousthings/*` local-source quirk means a clean `npm install` fails — see CLAUDE.md).

---

### Task 1: Dependencies — add the transponders package, bump nfc-manager to dt.6

**Files:** `package.json`, `package-lock.json`.

1. Add a direct dependency `@dangerousthings/transponders` pinned to its released git tarball URL / tag (mirror how `@dangerousthings/react-native-nfc-manager` is pinned: `git+https://git.dngr.us/MikeFaith/transponders.git#<tag>`). It must be a DIRECT dep — the app imports it directly, and dt.6 only lists it as *optional*.
2. Bump `@dangerousthings/react-native-nfc-manager` git dep `#v3.17.2-dt.5` → `#v3.17.2-dt.6` (both the `dependencies` entry and the `package-lock.json` `resolved`/`version`, as done for the dt.5 bump).
3. Install into node_modules honoring the local-source quirk (do NOT rely on a clean `npm install`): hardlink-copy node_modules from the main checkout if needed, then `npm pack` each released package (or fetch the tarball) and unpack over `node_modules/@dangerousthings/react-native-nfc-manager` and `node_modules/@dangerousthings/transponders`. Confirm: `node_modules/@dangerousthings/transponders/dist/index.js` exists and the nfc-manager package no longer has `src/transponders/`.
4. Smoke test: a throwaway TS file imports `{ identifyWith, ChipType, isTagLoss }` from `@dangerousthings/transponders` and `NfcManager` (default) + `NfcTech` from `@dangerousthings/react-native-nfc-manager`; `npx tsc --noEmit` → 0. Delete it.

**Verify + commit:** `tsc --noEmit` may still show errors until Task 2/3 repoint imports (the old deep paths no longer resolve — expected). Commit `chore: consume nfc-manager dt.6 + @dangerousthings/transponders`.

---

### Task 2: Repoint the 14 deep leaf imports to the package root

**Files (per the current import audit):** `adapter.ts`, `dtEnrich.ts`, `nxpCommands.ts` and any others using a `…/src/transponders/…` path — enumerate with:
`grep -rl "@dangerousthings/react-native-nfc-manager/src/transponders" src`.

- Replace every `from '@dangerousthings/react-native-nfc-manager/src/transponders/<sub>'` with `from '@dangerousthings/transponders'`. The package's `dist/index` re-exports the whole surface: `types`, `transport`, `bitfield`, `identify`, `base`, `probes/getversion`, `type2/*`, `classic/classic`, `isodep/*`, `nfcv/*`, `magic/{bytes,caps,handle,sweep,gen4-config,tag-types}`, and the namespaces `gen1a/gen2/gen3/gen4/magicUl/magicIcode/uscuid/gdm/gen1b/directwrite/superMagic`.
- Collapse the now-duplicate imports within each file into one `import { … } from '@dangerousthings/transponders'`.
- Watch for the namespace imports: if the app used a concrete-class `instanceof` (e.g. `DesfireTransponder`, `Iso15693Transponder`, `Type2Tag`), those are named exports of the package root — import them from there.

**Verify:** `tsc --noEmit` clean for these files (remaining errors only from Task 3's root-import split). Commit `refactor: import transponders from @dangerousthings/transponders`.

---

### Task 3: Split the 5 nfc-manager root imports + fix types/detection re-export

**Files:** `hooks/useScan.ts`, `services/detection/adapter.ts`, `services/detection/nxpCommands.ts`, `services/nfc/commands.ts`, `services/nfc/NFCManager.ts`, `types/detection.ts`.

- For each `from '@dangerousthings/react-native-nfc-manager'`, split the symbols:
  - **Stay on the fork:** `NfcManager` (default), `NfcTech`, `RawReader`, and any NFC-runtime handlers/enums the fork still exports.
  - **Move to `@dangerousthings/transponders`:** transponders symbols — confirmed `isTagLoss` (useScan); audit `adapter.ts`'s named imports for `IdentifyOptions`/`Transponder`/`ChipType`/`TagLostError`/etc. and move those too.
- **`types/detection.ts`:** it currently re-exports `ChipType`/`ChipFamily`/`getChipFamily` from the fork's leaf `…/src/transponders/types` (the Jest-native-crash workaround). Repoint to `export { ChipType, ChipFamily, getChipFamily } from '@dangerousthings/transponders'`. The package is side-effect-free, so the workaround comment can go — verify Jest no longer needs the leaf path.
- `NfcManager.identify()` is still called by the adapter — keep calling it (dt.6 delegates to the package internally). Confirm the app has the transponders package installed so identify() doesn't hit its "requires the optional package" throw.

**Verify:** `tsc --noEmit` clean; `npx jest --watchman=false` green (no test still imports a deep fork path; the `types/detection` re-export resolves without the native-module crash). Commit `refactor: split nfc-manager vs transponders root imports; types re-export from package`.

---

### Task 4: Build, install, verify on device

- Build+install the release APK to the Pixel (the established flow: `expo prebuild` if `android/` missing, then `./android/gradlew -p android :app:installRelease -PreactNativeArchitectures=arm64-v8a`; JDK 17). Watch for terminal state.
- Relaunch, screenshot the home screen (boots), then **scan a chip** and confirm the RESULT card identifies it (proves `NfcManager.identify()` → `@dangerousthings/transponders` works end-to-end at runtime, not just typecheck). A JavaCard/Apex is the strongest single check (exercises CPLC + enrichment).
- If the release bundle can't resolve the CommonJS package under Metro/Hermes, that surfaces here — flag it (unlikely; dist is CJS).

**Verify:** on-device scan renders a correct result. Commit nothing unless fixes needed; report evidence.

---

## Done when
- App depends on nfc-manager **dt.6** + `@dangerousthings/transponders`, installs, and `tsc`/`jest --watchman=false` are green.
- All transponders imports come from `@dangerousthings/transponders` (no `…/src/transponders/…` leaf paths remain; grep proves it); `NfcManager`/`NfcTech`/`RawReader` still from the fork.
- `types/detection.ts` re-exports from the package (leaf-import + Jest workaround gone).
- On-device scan identifies a chip via `NfcManager.identify()` → the package.

## Notes / risks
- **Blocking:** both refs must be released first (Task 1 prerequisite). Pin to the actual published tags, not `*`/branch.
- The DT-layer re-homing from phase 5 (adapter/dtEnrich/nxpCommands/javacardIdentity) is UNCHANGED in behavior — only its transponders imports move to the package. Don't refactor the enrichment logic here.
- Keep the phase-5 button/header fixes and the migration commits intact — this is additive on top of `feature/migrate-to-identify`.
- On-device NFC-scan verification across a chip spread (still outstanding from phase 5) can be folded into Task 4.
