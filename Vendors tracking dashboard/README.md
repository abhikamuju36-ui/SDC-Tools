# Vendor Tracker — Vendors Tracking Dashboard

Vendor Tracker is a premium, beautifully crafted single-page web application (SPA) designed to monitor, track, and analyze vendor performance across multiple projects. It features an overall workspace view alongside specialized individual project drill-down analyzers.

## 🚀 Key Features

1. **Dual Dashboard Architecture**:
   - **Overview Dashboard (All Projects)**: Shows consolidated spending, aggregate metrics, vendor rankings by weighted score, and a comprehensive master purchase order ledger.
   - **Project Analyzer**: Provides detailed granular breakdowns for any specific selected project, featuring budget-exhaustion trends, vendor budget shares, and project-specific purchase order ledger.
2. **Dynamic KPI Metrics Cards**:
   - **Total Spend**: Dynamic calculation of aggregate capital spent on POs.
   - **Avg Order Size**: Mathematical mean of all purchase requisitions.
   - **Avg Shipping Duration**: Mean number of days required for suppliers to deliver shipped items.
   - **On-Time Rate**: Multi-factor percentage calculation grading vendor reliability.
3. **Advanced Interactive Elements**:
   - **State Persistence**: Complete `localStorage` integration ensuring new suppliers and purchase orders persist across browser sessions.
   - **Real-time Live Filters**: Instantly search and filter records by PO ID, vendor name, project name, or fulfillment status without reloading.
   - **Premium Aesthetic Styles**: Beautiful Obsidian Dark theme (default) and Crisp Light theme transitions, coupled with glassmorphism backdrops, rich gradients, and custom scrollbars.
   - **Elegant Data Charts**: Fully custom Chart.js models showing spending allocation and delivery metrics.

---

## 🛠️ Architecture & Design System

The application is built on top of high-performance frontend components:
- **Core Engine**: Semantic HTML5 markup and vanilla JavaScript state controllers (`app.js`).
- **Design Tokens**: Standard CSS3 (`styles.css`) specifying custom variables for themes, responsive grids, sleek animations, and modal overlays.
- **Iconography**: [Lucide Icons](https://lucide.dev/) for crisp vector iconography.
- **Charts Engine**: [Chart.js](https://www.chartjs.org/) customized dynamically to fit Dark/Light mode theme changes.

---

## 📂 File Layout

- **`index.html`** — Application template shell.
- **`styles.css`** — Core style sheets, responsive layouts, glassmorphism elements, custom themes.
- **`app.js`** — Mock data initialization, metric calculation, filter engines, DOM controllers.

---

## 💻 Running Locally

Because Vendor Tracker is a pure client-side SPA, there are no heavy server dependencies to build!

1. Double-click [index.html](file:///c:/Transfer/Projects/Vendors%20tracking%20dashboard/index.html) to open the dashboard directly in any modern browser (Chrome, Edge, Safari, Firefox).
2. Alternatively, run a simple local web server in this folder:
   ```bash
   npx serve .
   ```
   or
   ```bash
   python -m http.server 8000
   ```
3. Open `http://localhost:8000` in your web browser.
