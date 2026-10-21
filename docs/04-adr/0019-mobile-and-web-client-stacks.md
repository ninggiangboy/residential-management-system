# ADR-0019: Build the web CMS and the two Expo apps on one React and Tailwind token set, with the latest stable stack and the New Architecture only

- Status: Accepted
- Date: 2026-10-19 · Related: DR-70, DR-82, DR-94, DR-69, DR-71, DR-04, NFR-13

## Context

There are three clients: the web CMS for the building office (Admin, Manager), a staff app (Manager, Technician, Guard) and a resident app (original SDD §4.3, §18). The design canvas has 115 artboards, so the component surface is large for one person. Original SDD §18.2 says one package implements the design system's components for both Expo apps "from the same tokens", but it names no UI kit, table, chart or form library, and it does not say what happens to the tokens on the web. The mobile ecosystem also moves fast: each Expo SDK bumps React Native and removes APIs, and the New Architecture is no longer optional (DR-82). A stale pin or a design built on removed APIs costs rework in P1.

## Options considered

1. **One client only (web, or native only).** Fewer things to build — but the Guard scans a QR code and the residents pay and get push on a phone, while the Manager imports Excel files and reviews a money log on a wide screen. Neither client replaces the other.
2. **Separate styling and tokens per platform.** Each app styled in its own way — but colors, type and status colors drift between 115 artboards and three clients; the design owner would approve everything twice.
3. **Expo Go, or the legacy architecture, or the npm `latest` of every Expo module.** Fastest to start — but Expo Go cannot load the native modules the apps need, the legacy architecture is going away, and `latest` of a managed module can fall outside the range its SDK bundles (DR-82, DR-94).
4. **Pre-release NativeWind 5 and other RC versions.** Newer — but pre-releases are not used without a DR (DR-82).
5. **Web with shadcn/Tailwind, mobile with expo-router and NativeWind, both driven by one extracted token set, on the verified latest stable.**

## Decision

Option **5** is chosen. The library lists, pins and licences are owned by [DOC-11](../03-architecture/tech-stack-and-versions.md) (§4 web, §6 mobile); this ADR fixes the shape.

- **Web.** A static single-page app on Cloudflare Pages: Vite, React, TanStack Router (file-based) and Query, Tailwind CSS, shadcn/ui on Radix, TanStack Table, react-hook-form with a TypeBox adapter, Recharts, TipTap (DR-70).
- **Mobile.** Two Expo apps, `Resident` and `Staff` (DR-69), on expo-router and NativeWind with Tailwind classes driven by the same preset. TanStack Query keeps a persisted cache for non-money screens (maximum age 24 h); the payment and QR screens always need the network (DR-70, DR-71 for the language catalog).
- **One token source.** `packages/design-tokens` is extracted from the design canvas into JSON and generates both the Tailwind preset and the NativeWind theme (task P1-09). `packages/ui-native` implements the design-system components once for both Expo apps.
- **Types, not server code.** The clients import the API type with a type-only import from `@app/api`; a CI check fails on a value import ([ADR-0004](0004-repository-layout-scopes-and-boundaries.md), [DOC-12](../03-architecture/code-architecture.md) §5.4, §6.1).
- **Currency.** Every version is the latest stable, verified on the web; New Architecture only; development builds through EAS, not Expo Go; every native library is checked for New Architecture support before it is listed (DR-82). Modules that Expo manages follow the SDK's bundled range, not npm `latest` (DR-94).
- **Fallback.** If NativeWind fails the compatibility check of P1-01 against the pinned Tailwind and SDK, `StyleSheet` with token constants replaces it and `ui-native` is written once (DR-70). The fallback is the previous stable of that one package or this style change, never a pre-release.

## Consequences

**Positive**

- A color or spacing change is made once in `design-tokens` and reaches the web and both apps.
- The same TypeScript types, Query keys and error handling concepts serve three clients.
- The stack is current on the day it is adopted and a refresh procedure keeps it so (DOC-11 §12).

**Negative**

- The mobile ecosystem moves fast: each SDK upgrade may remove an API, and the documents that cite it must change in the same change (DR-82 rule 6).
- NativeWind is the riskiest pin: it must work with Tailwind 4 and the current SDK, and if it does not, the style layer is rewritten as token constants.
- Managed Expo modules lag npm `latest` until the next SDK (DR-94).
- Development builds are heavier than Expo Go: every native change needs an EAS build, and store review time (days) is in the P6 schedule risk (DR-69).
- Persisted query cache means a resident can see 24-hour-old data on non-money screens while offline.

**Follow-up work**

- P1-01 and P1-02 fill the compatibility table of DOC-11 (NativeWind with Tailwind 4, Metro in the Bun workspace, Eden types); P1-09 extracts the tokens.
- Write DOC-54 (design system), DOC-55 (client architecture) and DOC-73 (mobile release).

**Notes added 2026-10-20 (no change of the decision)**

- Icons are Phosphor on both platforms (`@phosphor-icons/react`, `phosphor-react-native`), because the design canvas is drawn with them; `lucide-react` of DR-70 is not used (DR-181, DOC-54 §7.3).
- Recharts is listed above and pinned in DOC-11, but it is not adopted before P6: the canvas charts are plain token-styled components (DR-185, DOC-54 §10).
- Shared client logic without React or DOM lives in `packages/client-core`; the shadcn source lives in `apps/cms-web/src/components/ui` (DR-188, DOC-12 §2.1, DOC-55 §2.2).
