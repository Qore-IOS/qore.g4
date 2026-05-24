# CLAUDE.MD - INV-zen Project Guide

## Project Overview

**INV-zen** is a comprehensive web-based inventory management application for medical supply companies (like Roche). It manages product stock across a central warehouse and multiple hospitals, featuring AI-powered suggestions, barcode scanning, and real-time inventory tracking.

**Repository:** batuhanue/qore.g4
**Primary Branch:** `claude/update-claude-md-h9sV4`

## Technology Stack

### Core Framework
- **Next.js 14.2.35** with App Router (migrating towards Next.js 15+ patterns)
- **React 18.2.0** with TypeScript 5
- **Node.js 22** (uses built-in test runner)

### Backend & Database
- **Firebase** - Complete backend platform
  - Firestore for database
  - Firebase Authentication for user management
  - Firebase Functions for serverless backend
  - Firebase Storage for file uploads

### UI & Styling
- **Tailwind CSS** - Utility-first styling
- **ShadCN UI** - Component library based on Radix UI
- **Lucide Icons** - Icon library
- **Framer Motion** - Animations
- **Theme System** - CSS variables in `src/app/globals.css` for light/dark modes

### State Management
- **Zustand** - Global state management
- **React Query (@tanstack/react-query)** - Server state management
- **React Context** - Authentication, Global Scanner, Loading states

### AI & Intelligence
- **Genkit** with Google AI provider
- **Anthropic SDK** (@anthropic-ai/sdk)
- AI-powered order suggestions and cross-location transfer recommendations

### Specialized Features
- **Barcode Processing** - Custom HID scanner integration
- **Document Processing** - jsPDF, docx, mammoth, xlsx
- **QR Codes** - @zxing/library, qrcode
- **3D Graphics** - Three.js with React Three Fiber
- **Maps** - Leaflet with react-leaflet
- **OCR** - Tesseract.js
- **Virtual Scrolling** - @tanstack/react-virtual

## Architecture Patterns

### 1. Single-Page Application Shell
- **Central Hub:** `src/app/page.tsx` is the main orchestrator
- All data fetched from Firestore on load and stored in top-level state
- Navigation via `currentView` state (AppView type), not URL routing
- Data flows down via props to panel components

### 2. Global Barcode Scanner System
- **Provider:** `GlobalScannerProvider` wraps the entire app
- **Mechanism:**
  - Listens for `keydown` events at capture phase
  - Buffers keystrokes until Enter is pressed
  - Processes 61-character barcodes
  - Callback registration system via `useScannerContext`
- **Usage:** Panels like `AnaPanel` or `SiparisSevkiyatPanel` register callbacks

### 3. Firebase Integration Patterns
- **Authentication:** `src/contexts/auth-context.tsx`
  - Uses `onAuthStateChanged` for auth state
  - Role-based access control (admin/user)
  - Protected routes with redirect to `/login`
- **Firestore:** `src/lib/firebase.ts`
  - Primary data source
  - Real-time listeners where needed
  - All CRUD operations through Firebase SDK

### 4. Loading State Management
- **Global Loading Context:** See `GLOBAL_LOADING_USAGE.md`
- **Synced Loading Hook:** `useSyncedLoading` for coordinated loading states
- Use `useGlobalLoading` for app-wide loading indicators

### 5. Multi-Tenancy (companyId isolation)

Every Firestore document carries a `companyId` field. Each tenant only sees its
own data; SuperAdmin sees everything.

**Source of truth:**
- `request.auth.token.companyId` (custom claim set by `onUserClaimSync` Cloud
  Function on every `users/{uid}` write).
- Client reads via `useAuth().currentCompanyId` (refreshed from token on auth
  state change, falls back to users doc).

**Three enforcement layers:**

1. **Reads** — `scopedQuery()` in `src/lib/firestore-helpers.ts` injects
   `where('companyId', '==', X)` for non-superadmin sessions. All hooks in
   `src/hooks/useFirebaseQueries.ts` use it.
2. **Writes** — `withCompanyScope(payload, currentCompanyId)` in
   `src/lib/company-scope.ts` attaches companyId to every new doc.
3. **Server enforcement** — `firestore.rules` denies cross-tenant reads/writes
   via `inCompany()` / `writingInCompany()` helpers using token claims.

**When adding a new collection:**
1. Use `scopedQuery()` in any new read hook.
2. Wrap writes with `withCompanyScope()`.
3. Add a `match /<collectionName>/{id}` block to `firestore.rules` with
   `inCompany()` / `writingInCompany()`.
4. If the query uses orderBy or extra where clauses, add a composite index
   to `firestore.indexes.json` starting with `companyId ASC`.

**Cloud Function writes** must propagate the source doc's companyId into any
notification or derived doc they create — see `functions/src/index.ts`
`faultInterventionReminder` and `maintenanceUpcomingReminder` for the pattern.

**Migration history:** `docs/multi-tenancy-migration.md`. QA checklist:
`docs/multi-tenancy-qa.md`.

## Key Data Models

Location: `src/lib/types.ts`

### Core Types
- **ProductCode** - Product definitions with stock codes, names, and packaging values
- **DepoStokItem** - Serialized inventory items (central inventory record)
- **Hospital** - Hospital definitions
- **User** - User profiles with roles and accessible views
- **Order** - Shipment orders with status tracking
- **Shipment** - Shipment records
- **ConsumptionRecord** - Product usage tracking
- **EfficiencyData** - Monthly efficiency calculations

### Important Fields
- **miad** - Expiry date format: "dd.MM.yyyy"
- **seriNumarasi** - Serial number (61-character barcode)
- **rafAdresi** - Shelf address in warehouse
- **isShipped** - Boolean flag for shipment status
- **hedefKurum** - Destination hospital name

## Application Panels (Components)

### AnaPanel - Goods Receipt
- Warehouse receiving operations
- Barcode scanning for incoming items
- Duplicate checking (session and database)
- Shelf address assignment
- Delivery note management

### StokYonetimiPanel - Warehouse Stock
- Central warehouse inventory view
- Advanced search/filtering
- Expiry warnings (MIAD alerts)
- Color-coded urgency indicators

### SiparisSevkiyatPanel - Orders & Shipments
- **Tab 1:** Order creation with AI suggestions
- **Tab 2:** Picking & shipment with FIFO/FEFO
- **Tab 3:** Direct transfers without orders
- **Tab 4:** Shipment history

### HastaneYonetimiPanel - Hospital Stock
- Hospital-specific inventory view
- Stock counting feature
- Barcode-based verification
- Stock count session management

### UrunKullanimPanel - Product Consumption
- Record product usage at hospitals
- Barcode scanning for consumption
- Consumption history tracking
- Hospital-specific filtering

### VerimlilikHesaplamaPanel - Efficiency Calculation
- Multi-step wizard for monthly efficiency
- Opening stock, consumption, closing stock
- Cumulative device data integration
- Waste calculation (known/unknown)
- Results visualization with charts

### YonetimPanel - Admin Panel
- Master data CRUD operations
- User management with role assignments
- Product codes, hospitals, addresses
- Bulk Excel import/export

## Development Guidelines

### Code Quality
- **TypeScript:** Strict mode enabled
- **Linting:** ESLint with Next.js config
- **Testing:** Node.js built-in test runner
- **Type Checking:** Run `pnpm typecheck` before commits

### Commands
```bash
pnpm dev          # Dev server on port 9002 with Turbo
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm lint         # ESLint validation
pnpm test         # Run test suite
pnpm test:coverage # Test with coverage
```

### Firebase Operations
- **Never skip hooks** in git operations
- **Prefer client-side Firebase** for search operations (see recent PR #249)
- **Use Firestore security rules** defined in `firestore.rules` (DSL, wired in `firebase.json`)
- **Firebase Functions** located in `/functions` directory
- **Multi-tenancy:** see the "Multi-Tenancy" section above before adding new
  Firestore queries or collections

### Best Practices

#### 1. State Management
- Use Zustand for complex global state
- Use React Query for server-side data
- Use Context for cross-cutting concerns (auth, scanner)
- Keep component state local when possible

#### 2. Performance
- Use `@tanstack/react-virtual` for long lists
- Implement session-based grouping for search results
- Debounce search inputs with `lodash.debounce`
- Use React.memo for expensive components

#### 3. Barcode Handling
- Always validate 61-character format
- Parse GTIN, lot, serial, expiry from barcodes
- Check duplicates before processing
- Use `useBarcodeParser` and `useBarcodeFormats` hooks

#### 4. Loading States
- Use global loading context for app-wide operations
- Use local loading for component-specific operations
- Always provide user feedback during async operations
- See `GLOBAL_LOADING_USAGE.md` for detailed patterns

#### 5. Error Handling
- Use `useFirebaseOperation` hook for Firebase operations
- Provide user-friendly error messages
- Log errors for debugging
- Use toast notifications (sonner) for user feedback

#### 6. Date Handling
- Use `date-fns` for date operations
- Store dates in Firestore as timestamps
- Display dates in "dd.MM.yyyy" format (Turkish locale)
- Consider timezone implications

#### 7. Excel Operations
- Use `xlsx` for reading/writing Excel files
- Validate data structure before processing
- Provide templates for bulk uploads
- Handle errors gracefully with user feedback

## Important Files & Directories

```
/src
  /app
    page.tsx              # Main SPA shell
    globals.css           # Theme definitions
  /components
    /ui                   # ShadCN components
    /panels               # Main feature panels
  /contexts
    auth-context.tsx      # Authentication
    ai-context.tsx        # AI features
    loading-context.tsx   # Global loading
  /hooks
    useBarcodeParser.ts   # Barcode utilities
    useGlobalLoading.ts   # Loading state
    useHidScanner.ts      # HID scanner
  /lib
    firebase.ts           # Firebase config
    types.ts              # TypeScript types
  /actions
    stokActions.ts        # Stock operations
    searchActions.ts      # Search operations
  /store
    lbys-data-store.ts    # Zustand store
/functions
  /src
    index.ts              # Firebase Functions
/tests                    # Test files
/docs
  quality-assurance.md    # QA guidelines
```

## AI Features (Genkit Flows)

### Order Quantity Suggestions
- Flow: `suggestOrderQuantities`
- Input: Hospital, product, consumption, stock, lead time
- Output: Suggested quantity with reasoning

### Cross-Location Transfer
- Flow: `suggestCrossLocationTransfer`
- Input: Multi-hospital inventory data
- Output: Transfer recommendations to prevent waste

## Testing Strategy

- **Unit Tests:** Node.js test runner for barcode utilities
- **Type Safety:** TypeScript strict mode
- **Linting:** ESLint with Next.js rules
- **Quality Assurance:** See `docs/quality-assurance.md`

### Supply Chain Workflows
Focus on barcode utilities that power supply-chain operations:
- Barcode parsing and validation
- Serial number generation and tracking
- FIFO/FEFO logic for picking
- Expiry date calculations

## Common Development Tasks

### Adding a New Panel
1. Create component in `/src/components/panels`
2. Add to `AppView` type in types.ts
3. Register in main page.tsx switch statement
4. Add to user permissions in admin panel
5. Update navigation menu

### Adding a New Data Model
1. Define interface in `src/lib/types.ts` (include `companyId?: string`)
2. Create Firestore collection
3. Update security rules in `firestore.rules` (add a `match` block with
   `inCompany()` / `writingInCompany()`)
4. Add CRUD operations using `scopedQuery()` for reads and
   `withCompanyScope()` for writes
5. If the query needs orderBy / extra where, add `(companyId ASC, ...)`
   composite index to `firestore.indexes.json`
6. Update admin panel for management

### Implementing Barcode Features
1. Use `useScannerContext` for callback registration
2. Parse barcode with `useBarcodeParser`
3. Validate format (61 characters)
4. Check duplicates in current state and Firestore
5. Provide visual feedback to user

### Adding AI Features
1. Define Genkit flow in `/functions/src`
2. Set up input/output schemas
3. Write prompt with clear instructions
4. Test with various inputs
5. Integrate into UI with loading states

## Security Considerations

- **Authentication:** Firebase Auth with role-based access
- **Authorization:** Firestore security rules
- **Data Validation:** Zod schemas for form validation
- **API Keys:** Environment variables, never commit
- **User Permissions:** Accessible views per user role

## Deployment

- **Firebase Hosting:** Configured in `firebase.json`
- **App Hosting:** Configuration in `apphosting.yaml`
- **Environment:** Production and staging environments
- **CI/CD:** GitHub Actions for automated deployment

## Recent Changes & Patterns

### Search Panel Optimization (PR #250)
- Switched from server actions to client-side Firebase
- Implemented session grouping for better UX
- Fixed MIAD display issues
- Improved performance significantly

### Key Patterns to Follow
1. Client-side Firebase queries over server actions
2. Session-based grouping for search results
3. Virtual scrolling for large datasets
4. Debounced inputs for search/filter operations
5. Global loading context for coordinated states

## Troubleshooting

### Common Issues
1. **Barcode scanner not working:** Check GlobalScannerProvider wrapping
2. **Firebase permissions:** Verify Firestore rules
3. **Build failures:** Run `pnpm typecheck` to identify issues
4. **State not updating:** Check React Query cache invalidation

### Debug Tools
- React Query Devtools (included in dev mode)
- Firebase Emulator Suite for local testing
- Browser DevTools for network inspection
- Console logs with structured error messages

## Resources

- [Project Brief](PROJECT_BRIEF.md) - Detailed requirements
- [Quality Assurance](docs/quality-assurance.md) - Testing guidelines
- [Global Loading Usage](GLOBAL_LOADING_USAGE.md) - Loading state patterns
- [Next.js Documentation](https://nextjs.org/docs)
- [Firebase Documentation](https://firebase.google.com/docs)
- [ShadCN UI](https://ui.shadcn.com/)

## Branch Strategy

- **Main Branch:** (not specified in status)
- **Feature Branch:** `claude/update-claude-md-h9sV4`
- Always develop on designated feature branches
- Create descriptive commit messages
- Push to feature branch with `-u origin <branch-name>`

## Notes for Claude AI

When working on this codebase:

1. **Read before editing:** Always read files before making changes
2. **Respect architecture:** Follow the SPA shell pattern
3. **Use existing patterns:** Don't reinvent solutions
4. **Test thoroughly:** Run typecheck, lint, and tests
5. **Consider performance:** This is a production medical supply system
6. **Maintain type safety:** TypeScript strict mode is enforced
7. **Follow conventions:** Turkish field names (e.g., miad, kurum, stok)
8. **Check recent PRs:** Learn from recent changes and patterns
9. **Use proper tools:** Leverage hooks and contexts provided
10. **Document decisions:** Update this file when adding major features

---

Last Updated: 2026-01-12
Version: 1.0.0
