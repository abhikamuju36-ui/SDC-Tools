# Changelog

All notable changes to SDC Centralized Calendar are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.1.0] — 2026-04-22

### ✨ Smartsheet Integration

#### New Feature: Smartsheet Sync
- **Connect button** in user menu dropdown (📊 Smartsheet Sync) with live event count badge
- **SmartsheetPanel modal** — shows connection status, lists all your sheets, lets you select which to import
- **Backend proxy** (`/api/smartsheet/*`) — all Smartsheet API calls go server-side using `SMARTSHEET_API_TOKEN` from `.env`
- **Intelligent column mapping** — auto-detects Task Name, Start Date, Finish Date, % Complete, Manager, Comments, Duration, Status columns by title keywords
- **Privacy enforced** — all synced events stored as `category: 'personal'`, never shown to other users
- **Persistent selection** — remembers which sheets you had selected (localStorage)
- **SS badge** on event chips for Smartsheet-sourced events, with % complete display
- **Last synced timestamp** shown in panel
- **Clear All** button to remove all Smartsheet events
- Select All / Select None sheet shortcuts

#### Backend
- New route file `server/routes/smartsheet.js`
- Routes: `GET /api/smartsheet/status`, `GET /api/smartsheet/sheets`, `POST /api/smartsheet/sync`
- Uses Node.js built-in `https` module — no new npm dependencies

---

## [1.0.0] — 2026-04-22

### 🎉 Initial Release

#### Core Calendar
- Month, Week, Day view modes
- Drag-and-drop event rescheduling
- Right-click context menu on calendar cells
- Undo / Redo for event edits
- Keyboard shortcuts overlay (`?`)
- Week numbers toggle
- Density presets: Compact, Default, Comfy

#### Event Management
- 7 categories: Holidays, Pay Days, Birthdays, Meetings, Company Events, Deadlines, Personal
- Reminder Bell — set reminders on any event
- Pin Events — pin to cell top
- Import / Export (JSON)
- Employee Directory modal

#### UI / UX
- Birthday Spotlight banner (this week's birthdays, expandable)
- Payday Countdown pill in sidebar
- Monthly Summary Bar with category count pills
- My Events filter toggle
- Jump-to-Date mini-calendar
- Search with live chip highlight / dim
- Dark mode support
- Mobile bottom navigation bar
- Swipe gestures (mobile)
- Collapsible sidebar sections
- Hover cards on event chips
- Pre-loader skeleton screen

#### Auth & Backend
- Microsoft Azure AD SSO (OAuth2 + JWT)
- LOCAL_MODE flag for local dev (no backend needed)
- Role-based access: Admin, HR, Manager, Employee
- Admin Panel — manage users & role permissions
- Node.js/Express server (port 3001 API, port 3000 static)
- NeDB embedded database
- Windows auto-start VBS script

#### Bug Fixes (pre-release)
- Fixed `</script>` inside Babel template literal causing blank page
- Fixed `$setOnInsert` NeDB incompatibility (find-then-upsert pattern)
- Fixed account dropdown disappearing on pointer move (click-based state)
- Fixed summary bar pills touching the dividing line (bottom padding)
- Fixed "+N more" birthday button not functional (extracted component with state)
- Fixed TODAY cell number overlapping "TODAY" label (moved label outside circle)
- Fixed AdminPanel crash (`users.map is not a function`) in LOCAL_MODE
- Fixed Sign Out being a no-op in LOCAL_MODE (now reloads page)
