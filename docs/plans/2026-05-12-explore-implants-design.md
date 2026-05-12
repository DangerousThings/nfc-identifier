# Explore Implants — Design

**Date:** 2026-05-12
**Author:** ops@dangerousthings.com (with Claude)
**Status:** Design / pre-implementation
**Ship target:** OTA via EAS Update (no native rebuild)

## Goals

1. Add a second mode to the app — "Explore Implants" — that lets users browse the full DT chip-implant catalog without scanning a card.
2. Mirror the storefront's `chip-implant` collection filter taxonomy (`CyberFilterHeader` + nested-menu filters) so prospective customers see a familiar feature lens.
3. Link each implant to its product page on dangerousthings.com via the external browser.
4. Ship entirely through OTA — no native module changes, no store submission.

## Non-goals

- Magnet implants, aesthetic implants, bundles. Chip implants only for v1.
- In-app browser / WebView. External `Linking.openURL` only.
- Search box, product imagery, AsyncStorage persistence of filter state.
- Deep-link from `ResultScreen` ("show all NTAG216 implants" after a scan). Out of scope; route signature leaves room for it later.
- Detox E2E for the navigation flow. Unit + RNTL component tests only.
- Analytics for screen views.

## OTA constraints

Three things keep this OTA-shippable:

1. **No new native modules.** `DTMobileFilterOverlay`, `DTDrawer`, `DTAccordion`, `DTBadgeOverlay`, `DTCheckbox`, `DTCard`, `DTChip` all exist in `@dangerousthings/react-native@0.4.1`. `react-native-vector-icons@^10.2.0` is already linked.
2. **External links via `Linking.openURL`** (built into React Native).
3. **Catalog bundled as TS**, no remote fetch.

The only dep change is bumping `@dangerousthings/react-native` from `^0.3.0` → `^0.4.1`. That package's only runtime dep is `@dangerousthings/tokens` (CSS tokens, no native code); peer deps (paper, safe-area-context, svg) are already satisfied.

Native-rebuild trip wires to watch for before publishing — none should be present:

- New native module dependency
- Changes to `app.config.ts` plugins, permissions, or runtime versions
- Changes to `android/` or `ios/` directories

## Navigation & entry point

`HomeScreen` gets a second button directly below "START SCAN":

```tsx
<DTButton
  variant="emphasis"
  mode="outlined"
  onPress={() => navigation.navigate('Explore')}
  style={{ marginTop: 16 }}>
  EXPLORE IMPLANTS
</DTButton>
```

Cyan-filled "START SCAN" stays primary; yellow-outlined "EXPLORE IMPLANTS" reads as secondary.

`ExploreScreen` is added to the root stack alongside Home / Scan / Result / DataConsent. The route takes no params in v1; the type signature reserves `{ initialFilters?: FilterState }` for future deep-linking from `ResultScreen`.

## Filter taxonomy

Ported verbatim from the storefront's chip-implant collection ([`($locale).collections.$handle.tsx:1060-1133`](../../../dt-shopify/apps/storefront/app/routes/($locale).collections.$handle.tsx#L1060-L1133)):

| # | Title             | Handle             | Icon (react-native-vector-icons)          |
| - | ----------------- | ------------------ | ----------------------------------------- |
| 1 | Smartphone        | `smartphone`       | MaterialIcons `phonelink-ring`            |
| 2 | Access Control    | `access_control`   | MaterialIcons `vpn-key`                   |
| 3 | Digital Security  | `digital_security` | FontAwesome `user-shield`                 |
| 4 | Cryptography      | `cryptography`     | MaterialCommunityIcons `code-tags`        |
| 5 | Data Sharing      | `data_sharing`     | MaterialIcons `mobile-screen-share`       |
| 6 | Payment           | `payment`          | MaterialIcons `credit-card`               |
| 7 | Magic             | `magic`            | MaterialIcons `content-copy`              |
| 8 | Illumination      | `illumination`     | MaterialIcons `lightbulb-outline`         |
| 9 | Sensors           | `sensors`          | MaterialCommunityIcons `thermometer-half` |

Plus an **Other** group containing `Install Method` (Injection / 4g Needle / Scalpel).

Children are not hand-coded — they're derived by `getAllModelFeaturesRecursive()` walking each implant's `features` object. Examples:

- `access_control` → `[legacy, mifare_classic, desfire, iclass_legacy]`
- `cryptography.algorithms` → `[AES, RSA, ECC]`, `cryptography.auth_methods` → `[TAM, MAM, SDM/SUN]`
- `illumination.type` → `[HF, LF, glow]`, `illumination.available_colors` → `[red, green, blue, white, amber, RGB, aqua]`
- `sensors` → `[temperature]`
- `magic.chips` → `[Magic MIFARE Classic G1a, G2, Ultimate Gen4, …]`

## Data porting

The existing `src/data/products.ts` keeps powering the scanner's match logic unchanged. A new module powers Explore:

```
src/data/chipImplants/
  mod.ts            ← port of dt-shopify app/lib/models/mod.ts
  chip.ts           ← port of dt-shopify app/lib/models/chip.ts
  chipImplant.ts    ← port of dt-shopify app/lib/models/chip_implant.ts (CHIP_IMPLANT_MAP)
  filters.ts        ← CHIPS / OTHER / INSTALL_METHODS / populateFiltersFromFeatures,
                      lifted from collections route, react-icons swapped for vector-icons
  productLinks.ts   ← Record<chipImplantKey, dangerousthings.com product URL>;
                      joined by name against existing PRODUCTS where possible
  index.ts          ← barrel
```

Entries in `CHIP_IMPLANT_MAP` with no current product (discontinued `xdf`, `xdf2`, bundles) hide the "VIEW PRODUCT" button and show a small grey "Discontinued" label instead.

## ExploreScreen layout

```
┌──────────────────────────────────────┐
│  ←  EXPLORE IMPLANTS         ⚙ (3)  │  Surface header (back · title · filter icon + DTBadgeOverlay)
│  Showing 7 of 22 implants            │  mode-emphasis result count
│  [ NTAG · Cryptography · LED  × ]    │  active-filter DTChip row (tap × to clear individually)
│──────────────────────────────────────│
│  FlatList<ChipImplant> of cards…     │
└──────────────────────────────────────┘
```

Empty state: if filters yield zero matches, replace the FlatList with a centered `DTCard` saying "No implants match these filters" + a "CLEAR ALL" `DTButton variant="warning"`.

No pull-to-refresh (bundled catalog). Hardware back behavior is standard React Navigation — pops to Home.

## Filter sheet UX

Filter icon tap → `DTMobileFilterOverlay` slides up. Inside: a `ScrollView` of one `DTAccordion` per top-level facet, each containing `DTCheckbox` leaves. Two-level facets (Cryptography → Algorithms → AES/RSA/ECC) render the second level as indented checkboxes (max nesting depth in the taxonomy).

Filter state applies live as the user toggles. Bottom sticky CTA "SHOW N IMPLANTS" updates live with `filterImplants(allImplants, draftFilterState).length` and acts as a dismiss button.

Filter state is local React state, lost on navigation away. No AsyncStorage.

## Product card

Each card renders from a `ChipImplant` instance.

```tsx
<DTCard variant="normal">
  <Text variant="headlineSmall">{name}</Text>
  <Text variant="bodySmall">{form_factor} · {chip names joined}</Text>
  <Text variant="bodyMedium">{description}</Text>
  <TagRow />                           // DTChip per supported feature: NFC / LED / Access / Secure / Sensor / Magic
  <SummaryRows />                      // from ChipImplant.summary getter
  <DTButton variant="emphasis" mode="outlined"
    onPress={() => Linking.openURL(productUrl)}>
    VIEW PRODUCT →
  </DTButton>
</DTCard>
```

`ChipImplant.summary` ([`chip_implant.ts:501-525`](../../../dt-shopify/apps/storefront/app/lib/models/chip_implant.ts#L501-L525)) already produces the canonical `SummaryLine[]` rendered on storefront cards — port as-is.

Whole-card press is not wired. Only the "VIEW PRODUCT" button launches the browser — prevents accidental launches on scroll.

## Filter logic

```ts
// src/services/explore/filter.ts
type FilterState = Set<string>;       // dotted handle paths, e.g. 'cryptography.algorithms.aes'

export function filterImplants(
  implants: ChipImplant[],
  state: FilterState,
): ChipImplant[] {
  if (state.size === 0) return implants;
  const byFacet = groupByFacet(state);  // Map<facetHandle, Set<leafPath>>
  return implants.filter(implant =>
    [...byFacet.entries()].every(([, leaves]) =>
      [...leaves].some(path => implantSatisfies(implant, path))
    )
  );
}
```

`implantSatisfies(implant, path)` walks `implant.features` along the dotted path and checks `supported`, array membership, or scalar equality. Ported from the storefront's `matchFilter` / `getActiveLeaves` helpers ([`($locale).collections.$handle.tsx:373-460`](../../../dt-shopify/apps/storefront/app/routes/($locale).collections.$handle.tsx#L373-L460)), with the React Router URL-state coupling stripped out.

Semantics: AND across facets, OR within a facet — matches the storefront.

### State in ExploreScreen

```ts
const [allImplants] = useState(() =>
  Object.values(CHIP_IMPLANT_MAP).map(fn => fn())
);
const [filterState, setFilterState] = useState<FilterState>(new Set());
const visible = useMemo(
  () => filterImplants(allImplants, filterState),
  [allImplants, filterState],
);
```

## Testing

Pure-function unit tests (Jest):

- `__tests__/services/explore/filter.test.ts` — empty state, single-leaf, OR-within-facet, AND-across-facets, toggle idempotency, result count.
- `__tests__/data/chipImplants/productLinks.test.ts` — every `CHIP_IMPLANT_MAP` key has a URL or is marked discontinued; URL prefix sanity.
- `__tests__/data/chipImplants/filters.test.ts` — all 9 facets present; every leaf is exercised by at least one implant.

Component tests (React Native Testing Library):

- `__tests__/screens/ExploreScreen.test.tsx` — initial render, sheet open/close, checkbox toggling updates visible list and count, "VIEW PRODUCT" calls mocked `Linking.openURL`, empty state.

Manual smoke pass on one Android + one iOS device pre-OTA: navigation, sheet animation, external browser launch, back behavior.

No Detox E2E.

## Rollout

1. Bump `@dangerousthings/react-native` to `^0.4.1` in `package.json`; commit lockfile.
2. Implement on a feature branch; merge to `main` when `npm run typecheck` and `npm test` are green.
3. `eas update --branch beta --message "Add Explore Implants browse mode"` at 100% on beta channel.
4. Bake 48 hours; promote to `production` if no forum/support reports.
5. Rollback path: `eas update --branch production` republishing the prior commit. Users get the rollback on next app open.

In-app release-notes copy (precedent `8dcea26`):

> Browse all Dangerous Things implants without scanning a card. New EXPLORE IMPLANTS button on the home screen filters by chip features, form factor, install method, and more.

## File summary

**New (~12):**

- `src/screens/ExploreScreen.tsx`
- `src/components/explore/ProductCard.tsx`
- `src/components/explore/ActiveFilterChips.tsx`
- `src/services/explore/filter.ts` (+ `index.ts`)
- `src/data/chipImplants/{mod,chip,chipImplant,filters,productLinks,index}.ts`
- `__tests__/services/explore/filter.test.ts`
- `__tests__/data/chipImplants/filters.test.ts`
- `__tests__/data/chipImplants/productLinks.test.ts`
- `__tests__/screens/ExploreScreen.test.tsx`

**Modified (5):**

- `src/screens/HomeScreen.tsx` — add EXPLORE IMPLANTS button
- `src/screens/index.ts` — export
- `src/types/navigation.ts` — add `Explore: undefined` to `RootStackParamList`
- `App.tsx` — register the route
- `package.json` — bump `@dangerousthings/react-native` to `^0.4.1`

## Suggested commit / PR cadence

1. Port `mod.ts` / `chip.ts` / `chipImplant.ts` + filters taxonomy; tests for filter fn pass (no UI yet).
2. Add ExploreScreen + navigation wiring (route works, no filter sheet).
3. Wire `DTMobileFilterOverlay` + `DTAccordion` + `DTCheckbox` into the filter sheet.
4. Polish: active-filter chip row, empty state, release-notes copy.
5. EAS update publish.
