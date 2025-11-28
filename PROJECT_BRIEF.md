
# Comprehensive AI Prompt for Recreating the INV-zen Application

## 1. Core Project Overview & Technology Stack

**Objective:** Build a web-based inventory management application named "INV-zen" for a medical supply company (like Roche) to manage product stock across a central warehouse and multiple hospitals.

**Tech Stack:**
*   **Framework:** Next.js 15+ with App Router.
*   **Language:** TypeScript.
*   **UI Library:** React 18+ with ShadCN UI components and Lucide Icons for iconography.
*   **Styling:** Tailwind CSS. The theme is defined in `src/app/globals.css` using CSS variables for light and dark modes.
*   **Backend & Database:** Firebase. Use Firestore for the database and Firebase Authentication for user management.
*   **AI Functionality:** Genkit, specifically using the Google AI provider for features like smart order suggestions.
*   **State Management:** Primarily component-level state (`useState`, `useMemo`, `useCallback`) and React Context for global concerns (Authentication, Global Scanner).

## 2. Core Architectural Concepts

### 2.1. Single-Page Application (SPA) Shell

The application operates like a Single-Page Application within the `src/app/page.tsx` component. This file is the central hub.
*   It handles user authentication state via a context.
*   Upon successful login, it fetches all necessary data collections from Firestore (products, hospitals, warehouse stock, orders, etc.) and stores them in top-level state arrays.
*   It maintains a `currentView` state variable (`AppView` type) which determines which "panel" (component) is currently visible.
*   It passes down the master data and relevant state-setting functions as props to all child panel components.
*   Navigation between panels is handled by updating the `currentView` state, not by changing the URL.

### 2.2. Global Barcode Scanning

A `GlobalScannerProvider` wraps the entire application.
*   It listens for `keydown` events globally at the `capture` phase.
*   It buffers keystrokes that are not `Enter` or modifier keys.
*   When `Enter` is pressed, it processes the buffer. If the buffer content is a 61-character string, it calls a callback function.
*   This callback function can be registered by any component (like `AnaPanel` or `SiparisSevkiyatPanel`) using the `useScannerContext`. This allows the active panel to define how a globally scanned barcode is handled.

### 2.3. Firebase Integration

*   **Authentication (`src/contexts/auth-context.tsx`):**
    *   Uses Firebase Authentication (`onAuthStateChanged`).
    *   Manages `currentUser` (Firebase user object) and `currentUserProfile` (data from Firestore `users` collection).
    *   Protected routes: Unauthenticated users are redirected to `/login`.
    *   An `isAdmin` state is determined by the user's role in their Firestore profile or by a hardcoded admin UID for bootstrapping.
*   **Firestore (`src/lib/firebase.ts`):**
    *   The primary data source.
    *   `HomePage` fetches all required data on load.
    *   All data modifications (creating, updating, deleting) should be done via Firestore SDK calls within the relevant components.

## 3. Data Models (`src/lib/types.ts`)

Define the following TypeScript interfaces:

*   **`ProductCode`**: Represents a product definition. Fields: `id`, `stokKodu` (stock code), `stokAdi` (name), `urunGrubu` ('kit' or 'sarf'), `ambalajDegeri` (number of tests per kit, if applicable).
*   **`DepoStokItem`**: Represents a single, serialized item in the main warehouse or a hospital. This is the central inventory record. Fields: `id`, `stokKodu`, `stokAdi`, `lotNumarasi`, `miad` (exp. date as "dd.MM.yyyy"), `seriNumarasi`, `rafAdresi` (shelf address in warehouse), `isShipped` (boolean), `sevkTarihi` (shipment date), `hedefKurum` (destination hospital name).
*   **`Hospital`**: A hospital definition. Fields: `id`, `name`.
*   **`User`**: A user profile stored in Firestore. Fields: `uid`, `email`, `role` ('admin' or 'user'), `name`, `accessibleViews` (array of `AppView` keys).
*   **`Order`**: A shipment order. Fields: `id`, `kurumAdi` (hospital name), `orderItems` (array of `OrderItem`), `olusturmaTarihi`, `durum` ('yeni', 'toplaniyor', 'sevk edildi').
*   **`Shipment`**: A record of a shipment. Fields: `id`, `orderId` (if from an order), `kurumAdi`, `sevkEdilenUrunSeriNumaralari` (array of strings), `sevkTarihi`.
*   **`ConsumptionRecord`**: A record of a product being used at a hospital. Fields: `id`, `stokKodu`, `stokAdi`, `seriNumarasi`, `hospitalName`, `consumptionTimestamp`, `consumptionType`.
*   **`EfficiencyData`**: A record for calculating monthly efficiency. Fields: `id` (composite key: hospitalId-year-month), `hospitalId`, `month`, `year`, `cihazUstuDevir` (on-device stock from previous month), `hesaplananTestBazliTuketim` (calculated consumption), `cihazUstuAySonu` (on-device stock at end of month), `kumulatifVeriler` (cumulative device data), `verimlilikSonuclari` (the calculated results).

## 4. Component & Module Functionality

Implement the following panels as React components.

### `AnaPanel` (Main Panel)
*   **Function:** Goods receipt for the central warehouse.
*   **Logic:**
    1.  Registers a callback with `GlobalScannerProvider` to handle scanned 61-character barcodes.
    2.  Parses the barcode into GTIN, lot, serial number, and expiry date.
    3.  Checks for duplicates in the current session (`scannedItems` state) and in the main warehouse stock (`depoStok` prop).
    4.  Adds the new, valid item to a local `scannedItems` list.
    5.  The user can select items from this list and assign a shelf address (`rafAdresi`) and a delivery note number (`irsaliyeNumarasi`) via modals.
    6.  A "Mal Kabul" (Goods Receipt) process finalizes the items, which would involve saving them to the `depoStok` collection in Firestore.

### `StokYonetimiPanel` (Warehouse Stock Management)
*   **Function:** View and search the central warehouse inventory.
*   **Logic:**
    1.  Displays all `DepoStokItem` where `isShipped` is `false`.
    2.  Provides a search input to filter items by any field (name, code, serial, lot, shelf).
    3.  Includes a separate section for "Miad Uyarıları" (Expiry Warnings) which lists items nearing or past their expiry date, sorted by urgency and color-coded.

### `SiparisSevkiyatPanel` (Order & Shipment)
*   **Function:** Create orders, pick items, and manage shipments.
*   **Logic:**
    1.  **Tab 1: Order Creation:**
        *   User selects a hospital.
        *   User adds products and quantities to a new order list, either manually or via Excel upload.
        *   An AI suggestion button (`suggestOrderQuantities` Genkit flow) can propose an order quantity for a product based on its stock and average consumption.
        *   On creation, the order is saved to the `orders` collection in Firestore.
    2.  **Tab 2: Picking & Shipment:**
        *   Displays a list of "yeni" (new) orders.
        *   Clicking "Start Picking" generates a picking list based on available warehouse stock, prioritizing items with the earliest expiry date (FIFO/FEFO).
        *   A picking modal opens, registering a new barcode handler with `GlobalScannerProvider`. The user scans the serial numbers of the items on the picking list to confirm.
        *   Once all items are picked, the "Complete & Ship" button updates the `DepoStokItem` records in Firestore (sets `isShipped` to true, adds `sevkTarihi` and `hedefKurum`), updates the order status, and creates a `Shipment` record.
    3.  **Tab 3: Direct Transfer:**
        *   Allows shipping an item without a formal order.
        *   User selects a hospital, scans a single item's barcode.
        *   The system validates the item exists in the warehouse.
        *   On confirmation, the system performs the same state updates as a regular shipment for that single item.
    4.  **Tab 4: Shipment History:**
        *   Displays a table of all `Shipment` records, showing the destination, date, and items shipped.

### `HastaneYonetimiPanel` (Hospital Stock Management)
*   **Function:** View stock at a specific hospital and perform stock counts.
*   **Logic:**
    1.  User selects a hospital from a dropdown.
    2.  The panel displays all `DepoStokItem` where `isShipped` is true and `hedefKurum` matches the selected hospital.
    3.  **Stock Count Feature:**
        *   A "Start Count" button initiates counting mode.
        *   It registers a barcode handler. When a barcode is scanned, the system checks if it exists in the selected hospital's expected stock.
        *   The UI shows a list of all expected items and visually tracks which ones have been successfully scanned (e.g., changes color, shows a checkmark).
        *   The results are saved to a `hospitalStockCountSessions` collection.

### `UrunKullanimPanel` (Product Consumption)
*   **Function:** Record that a product has been used at a hospital.
*   **Logic:**
    1.  User selects a hospital.
    2.  Panel registers a barcode handler.
    3.  When a user scans a product's 61-character barcode, the system finds that item in the selected hospital's stock (`hospitalStocks` derived from `depoStok`).
    4.  The item is removed from the hospital's stock (in the data model, this could mean deleting it or moving it to a `ConsumptionRecord` collection).
    5.  A `ConsumptionRecord` is created in Firestore.
    6.  A "Show Consumption History" button opens a modal to view recent consumptions for that hospital, filterable by time.

### `VerimlilikHesaplamaPanel` (Efficiency Calculation)
*   **Function:** A multi-step wizard to calculate product efficiency and waste for a selected hospital and month.
*   **Logic:**
    1.  **Step 1: Devir Stok (Opening Stock):** User provides on-device stock counts (in # of tests) from the start of the month, usually via Excel upload. The system can attempt to auto-fill this from the previous month's closing stock.
    2.  **Step 2: Tüketim (Consumption):** User chooses one of two methods:
        *   **System:** Calculate consumption by pulling all `ConsumptionRecord`s for the hospital within a date range and converting them to # of tests using `ambalajDegeri`.
        *   **Manual:** User uploads an Excel file with total boxes consumed per product.
    3.  **Step 3: Ay Sonu Stok (Closing Stock):** User provides on-device stock counts at the end of the month via Excel.
    4.  **Step 4: Kümülatif Veri (Cumulative Data):** User uploads an Excel file with cumulative data from the device (e.g., total tests, routine tests, control tests, calibration tests, repeats).
    5.  **Step 5: Results:** The system calculates:
        *   `Ana Tüketim (Hesaplanan)` = (Devir + Giren) - Ay Sonu
        *   `Bilinen Fire` = Kontrol + Kalibrasyon + Tekrar
        *   `Bilinmeyen Fire` = Ana Tüketim - Kümülatif Total
        *   Results are displayed in tables and charts. The entire `EfficiencyData` object is saved to Firestore.

### `YonetimPanel` (Admin Panel)
*   **Function:** Master data management. Accessible only to admin users.
*   **Logic:** Provides CRUD (Create, Read, Update, Delete) interfaces for:
    *   `productCodes` collection.
    *   `addressDefinitions` collection.
    *   `hospitals` collection.
    *   `users` collection (including setting accessible panels/views for each user).
*   All operations directly modify the Firestore collections.
*   Supports both manual entry via modals and bulk upload/download via Excel for each data type.

## 5. AI Flows (Genkit)

Implement Genkit flows for specific AI-powered features.

*   **`smart-stock-suggestions.ts`**:
    *   Defines a flow `suggestOrderQuantities`.
    *   **Input:** `hospitalName`, `productCode`, `averageMonthlyConsumption`, `currentStockLevel`, `leadTimeDays`, `safetyStockDays`.
    *   **Output:** `suggestedOrderQuantity`, `reasoning`.
    *   **Logic:** The prompt instructs an AI to act as a logistics expert and calculate an optimal order quantity based on the inputs to prevent stockouts while considering lead time and safety stock.

*   **`cross-location-recommendation.ts`**:
    *   Defines a flow `suggestCrossLocationTransfer`.
    *   **Input:** Data for a primary hospital (product, stock level, usage, expiry date) and an array of other hospitals with their stock levels and usage.
    *   **Output:** A `recommendation` string (e.g., "Transfer 50 units from Hospital B to Hospital A") and `reasoning`.
    *   **Logic:** The prompt asks the AI to analyze the inventory across all locations to suggest a stock transfer that can prevent waste from expiry at one location while fulfilling a need at another.
