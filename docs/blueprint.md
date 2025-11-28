# **App Name**: Roche Logistics Hub

## Core Features:

- Inventory Overview: Dashboard: Displays key metrics such as total depot stock, total hospital stock, and actively scanned products. Provides an overview of the entire Roche product ecosystem, updated in real time, locally
- Fast Barcode Entry: Barcode Scanning: Rapidly adds scanned items into the application with relevant parsed details; enables seamless address and invoice assignments prior to stock addition
- Robust Stock Database: Stock Management:  Maintain lists of depot and hospital stocks separately, each with lot numbers, expiration dates, and locations; quickly surface approaching-expiration warnings. Also supports stock receipt, validation, and inventory-wide reports, all without requiring live database access
- Smart Stock Suggestions: Automated Order Proposals: Generates recommended order quantities for hospitals based on past consumption rates and current stock, ensuring optimal stock levels while avoiding expiration losses. The AI LLM should use the average consumption as a tool when it has low confidence on a proposed quantity.
- Item Location Log: Inventory Tracking: Meticulously track scanned product data throughout transfer: in depot and individual hospitals alike. This provides key data points used for the Smart Stock Suggestions.
- Detailed Reports: Report Generation: Full-scale reports, easily convertible into Excel format, covering Depot Stock Levels, Material Receipt validation, and Delivery Validations for internal purposes. Helps discover areas for improvement and insight
- Shipment Optimizer: Cross-Location Recommendation tool: A feature that suggests the relocation of stock between hospitals based on the item's monthly usage average and its expiration date.

## Style Guidelines:

- Primary color: HSL(210, 70%, 50%) / RGB(#367BF5). A strong blue tone, for a sense of technological reliability
- Background color: HSL(210, 20%, 95%) / RGB(#F0F2F7). A light, desaturated color, providing contrast against the primary color
- Accent color: HSL(180, 60%, 50%) / RGB(#23BDBE). An analogous cyan, creating interest and acting as an easy-to-see call to action
- Headline font: 'Space Grotesk', sans-serif. To be used in page headings, card titles and navigation labels.
- Body font: 'Inter', sans-serif. This font is the foundation for card text and other long-form contents.
- Code font: 'Source Code Pro', monospace. Display segments of a code, commandline prompts, inline keywords and values.
- Lucide Icons are be used throughout the application, offering a consistent and clean look. Icons related to medicine, storage and transport may be used with brand's blue and/or analogous colors.