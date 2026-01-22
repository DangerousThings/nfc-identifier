# Development Roadmap

This roadmap is optimized for AI-assisted development with context window efficiency in mind. Each phase is designed to be **completable in a single session** without requiring extensive context from previous phases.

## Principles

1. **Self-contained phases** - Each phase has clear inputs/outputs
2. **Minimal cross-phase dependencies** - Read file structure, not conversation history
3. **Testable milestones** - Each phase ends with something verifiable
4. **Progressive complexity** - Simple foundations before complex detection

---

## Phase 1: Project Bootstrap

**Session prompt**: "Initialize the React Native project with TypeScript, React Native Paper, and the Dangerous Things theme system."

### Inputs
- None (greenfield)

### Tasks
1. Initialize Expo project with TypeScript template
2. Install core dependencies:
   - `@anthropic-dangerous-things/react-native-theme` (local link or npm)
   - `react-native-paper`
   - `react-native-safe-area-context`
   - `@react-navigation/native` + `@react-navigation/native-stack`
   - `react-native-nfc-manager`
   - `expo-font` (for Tektur)
3. Link the DT theme package (`../react-native-dt-theme`)
4. Use DTThemeProvider from the theme package
   - `colors.ts` - DT color palette
   - `typography.ts` - Tektur font setup
   - `paperTheme.ts` - React Native Paper theme config
4. Create basic navigation structure:
   - `HomeScreen` - Mode selection (just "Transponder to Implant" for now)
   - `ScanScreen` - Placeholder
   - `ResultScreen` - Placeholder
5. Wrap app with providers (Paper, Navigation, SafeArea)

### Outputs
- Runnable app on both platforms
- DT-themed UI with working navigation
- No NFC functionality yet

### Verification
```bash
npm run android  # App launches with cyan/yellow theme
npm run ios      # App launches with cyan/yellow theme
```

---

## Phase 2: NFC Infrastructure

**Session prompt**: "Implement the NFC service layer with platform permissions and the useScan hook."

### Inputs
- Phase 1 complete (check for `src/theme/paperTheme.ts`)

### Tasks
1. Configure Android NFC permissions:
   - `AndroidManifest.xml` - NFC permission + intent filters
   - Min SDK verification (21+)
2. Configure iOS NFC entitlements:
   - Add NFC capability in Xcode
   - `Info.plist` - Usage description + AID identifiers
3. Create NFC service layer (`src/services/nfc/`):
   - `NFCManager.ts` - Wrapper with init/cleanup lifecycle
   - `platforms.ts` - Platform detection utilities
4. Create scan hook (`src/hooks/useScan.ts`):
   - States: `idle`, `scanning`, `success`, `error`
   - Handle tag discovered callback
   - Proper cleanup on unmount
5. Update `ScanScreen` to use hook and display raw tag data

### Outputs
- NFC permissions working on both platforms
- Can detect any NFC tag and show UID
- Proper scan lifecycle management

### Verification
- Scan any NFC tag → UID displayed
- Cancel scan → returns to idle state
- Error states shown for NFC disabled/permission denied

---

## Phase 3: Basic Chip Detection

**Session prompt**: "Implement NTAG and MIFARE Classic detection with the chip identification framework."

### Inputs
- Phase 2 complete (check for `src/hooks/useScan.ts`)

### Tasks
1. Define detection types (`src/types/detection.ts`):
   ```typescript
   interface DetectionResult {
     chipType: ChipType;
     chipSubtype?: string;
     isCloneable: boolean;
     confidence: 'high' | 'medium' | 'low';
     rawData: RawTagData;
   }
   ```
2. Create detection framework (`src/services/detection/`):
   - `detector.ts` - Main orchestrator
   - `types.ts` - Chip type enums
3. Implement NTAG detection (`src/services/detection/ntag.ts`):
   - Send GET_VERSION (0x60)
   - Parse response for 213/215/216/I2C variants
   - Mark as cloneable
4. Implement MIFARE Classic detection (`src/services/detection/mifare.ts`):
   - Check SAK: 0x08 (1K), 0x18 (4K), 0x09 (Mini)
   - Mark as cloneable
   - Note Android-only for sector operations
5. Update `ScanScreen` to show detection results

### Outputs
- NTAG213/215/216 correctly identified
- MIFARE Classic 1K/4K correctly identified
- Detection results displayed with chip info

### Verification
- Scan NTAG215 → Shows "NTAG215, Cloneable: Yes"
- Scan MIFARE Classic 1K → Shows "MIFARE Classic 1K, Cloneable: Yes"
- Scan other tags → Shows "Unknown" with raw data

---

## Phase 4: Advanced Chip Detection

**Session prompt**: "Add detection for DESFire, MIFARE Plus, SLIX, and JavaCard chips."

### Inputs
- Phase 3 complete (check for `src/services/detection/ntag.ts`)

### Tasks
1. Implement ISO 14443-4 detection (`src/services/detection/iso14443.ts`):
   - Parse ATS/historical bytes
   - Route to specific detectors based on signatures
2. Implement DESFire detection (`src/services/detection/desfire.ts`):
   - Identify via ATS signature
   - Send GET_VERSION for EV1/EV2/EV3 determination
   - Mark as non-cloneable
3. Implement MIFARE Plus detection:
   - Security level detection if possible
   - Mark as non-cloneable
4. Implement ISO 15693 detection (`src/services/detection/iso15693.ts`):
   - Get system info command
   - Identify SLIX/SLIX2 variants
   - Mark as cloneable
5. Implement JavaCard detection (`src/services/detection/javacard.ts`):
   - Parse historical bytes for JCOP signature
   - GET DATA for CPLC
   - AID probing for installed applets
   - Mark as non-cloneable
6. Handle platform differences gracefully:
   - iOS: Use ISO 7816 wrapped commands
   - Android: Use native tech classes

### Outputs
- All target chip types detected
- DESFire version (EV1/2/3) identified
- JavaCard identification via CPLC
- Platform-appropriate detection paths

### Verification
- Scan DESFire EV2 → Shows "MIFARE DESFire EV2, Cloneable: No"
- Scan SLIX → Shows "SLIX, Cloneable: Yes"
- Scan J3R180 → Shows "JCOP4 (J3R180), Cloneable: No"

---

## Phase 5: Product Matching

**Session prompt**: "Create the product catalog and matching algorithm, then build the results UI."

### Inputs
- Phase 4 complete (check for `src/services/detection/javacard.ts`)

### Tasks
1. Define product types (`src/types/products.ts`):
   ```typescript
   interface Product {
     id: string;
     name: string;
     compatibleChips: ChipType[];
     description: string;
     features: string[];
     formFactor: 'x-series' | 'flex' | 'other';
   }
   ```
2. Create product catalog (`src/data/products.ts`):
   - xNT (NTAG216)
   - xEM (T5577 - for EM/HID cloning)
   - NExT (NTAG216 + T5577)
   - xSIID (NTAG I2C + LED)
   - xDF2 (DESFire EV2)
   - flexDF2 (DESFire EV2 flex)
   - xMagic (MIFARE Classic + Gen2 Magic)
   - Apex (J3R180)
   - Apex Flex (J3R180 flex)
   - SLIX implants if available
3. Implement matching algorithm (`src/services/matching/matcher.ts`):
   - Match by chip type
   - Rank by feature parity
   - Handle cloneable vs native matches
4. Create result components (`src/components/results/`):
   - `TransponderInfo.tsx` - Detected chip details
   - `ProductMatch.tsx` - Matching product card
   - `NoMatchFound.tsx` - Conversion service link
5. Update `ResultScreen` with full flow

### Outputs
- Complete transponder-to-implant matching
- Product cards with descriptions
- "No match" redirects to dngr.us/conversion

### Verification
- Scan NTAG215 → Shows xNT, NExT as matches
- Scan MIFARE Classic → Shows xMagic as match
- Scan unknown chip → Shows conversion link

---

## Phase 6: Polish & UX

**Session prompt**: "Add animations, error handling, and final UI polish for production readiness."

### Inputs
- Phase 5 complete (check for `src/services/matching/matcher.ts`)

### Tasks
1. Add scan animations:
   - Pulsing scan indicator
   - Success/failure transitions
   - Card detection feedback
2. Implement comprehensive error handling:
   - NFC disabled state
   - Permission denied flow
   - Tag lost during scan
   - Unsupported tag graceful fallback
3. Add educational content:
   - Chip type explanations
   - Cloneability explanations
   - "Why can't this be cloned?" info
4. UI refinements:
   - Beveled corner components (DT style)
   - Proper loading states
   - Empty states
5. Platform testing:
   - Test all chip types on Android
   - Test all chip types on iOS (within CoreNFC limits)
   - Edge case handling

### Outputs
- Production-ready UX
- Helpful error messages
- Educational chip information
- Consistent DT branding throughout

### Verification
- Full flow feels polished
- Errors are helpful, not cryptic
- Works offline
- Matches DT website aesthetic

---

## Future Phases (Post-MVP)

### Phase 7: "ID an Implant" Mode
*Details TBD with employer*

### Phase 8: Scan History
- Local storage of past scans
- Favorites/bookmarks

### Phase 9: Store Integration
- Direct product links (when store is live)
- Pricing display

---

## Session Recovery Guide

If starting a new session mid-project:

1. **Check current state**:
   ```bash
   ls src/services/detection/  # Which detectors exist?
   ls src/data/                 # Product data present?
   ```

2. **Identify phase**:
   - No `src/` → Start Phase 1
   - No `useScan.ts` → Start Phase 2
   - No `ntag.ts` → Start Phase 3
   - No `javacard.ts` → Start Phase 4
   - No `products.ts` → Start Phase 5
   - All present → Phase 6 or done

3. **Read CLAUDE.md** for technical context

4. **Use phase-specific prompt** from this document
