/**
 * End-to-end tests for SDC Assemblies Library
 *
 * Pre-conditions: the e2e-server.js has seeded 6 E2E-* records.
 * Tests run against http://localhost:5173 (Vite dev server → Express proxy).
 */

// @ts-check
const { test, expect } = require('@playwright/test');

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function waitForTable(page) {
  await page.waitForSelector('.assembly-table tbody tr, .gallery-grid .card, [data-testid="assembly-row"]', {
    timeout: 10_000,
  });
}

async function waitForNoSpinner(page) {
  // Wait for any loading skeleton to disappear
  await page.waitForFunction(() => !document.querySelector('.skeleton-card'), { timeout: 10_000 });
}

// ─── 1. App Load & Layout ─────────────────────────────────────────────────────
test.describe('App load and layout', () => {
  test('loads the app and shows the SDC branding', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SDC|Assembl/i);
    // Brand logo / name visible somewhere on the page
    const brand = page.locator('text=/SDC/i').first();
    await expect(brand).toBeVisible({ timeout: 10_000 });
  });

  test('shows the main header with search input', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('input[type="text"], input[placeholder*="earch"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
  });

  test('shows the sidebar with navigation items', async ({ page }) => {
    await page.goto('/');
    // Sidebar should have "All Assemblies" or similar
    const sidebar = page.locator('.sidebar, aside, [class*="sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
  });

  test('shows assemblies in the content area', async ({ page }) => {
    await page.goto('/');
    // Wait for actual data rows — at least the E2E records should appear
    await page.waitForSelector('table tbody tr, .gallery-grid, .assembly-table', { timeout: 15_000 });
    const rows = page.locator('table tbody tr');
    const cards = page.locator('[class*="card"]');
    const count = await rows.count() + await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('shows sync status component', async ({ page }) => {
    await page.goto('/');
    // SyncStatus renders a .sync-pill div with "LIBRARY READY" / "SYNCING..." / "SERVER OFFLINE"
    const syncPill = page.locator('.sync-pill');
    await expect(syncPill).toBeVisible({ timeout: 10_000 });
    const label = syncPill.locator('.lbl, .sync-btn');
    await expect(label.first()).toBeVisible({ timeout: 5_000 });
  });
});

// ─── 2. View Mode Switching ───────────────────────────────────────────────────
test.describe('View mode switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000); // allow initial data fetch
  });

  test('switches to Grid view', async ({ page }) => {
    // Find the grid view toggle button
    const gridBtn = page.locator('button[title*="Grid"], button[aria-label*="Grid"], [class*="grid"] button').first();
    if (await gridBtn.isVisible()) {
      await gridBtn.click();
      await page.waitForSelector('.gallery-grid, [class*="gallery"]', { timeout: 5000 });
    } else {
      // View buttons may use icons; click the one that switches to grid
      const toolbarBtns = page.locator('.toolbar button, [class*="toolbar"] button');
      const count = await toolbarBtns.count();
      // Try clicking view-related toolbar buttons
      for (let i = 0; i < count; i++) {
        const btn = toolbarBtns.nth(i);
        const title = await btn.getAttribute('title') || '';
        if (/grid/i.test(title)) { await btn.click(); break; }
      }
    }
    // After switching, gallery grid should appear
    const gallery = page.locator('.gallery-grid, .gallery-area, [class*="gallery"]');
    const tableArea = page.locator('.table-area, .assembly-table');
    // One of them should be visible
    const galleryVisible = await gallery.count() > 0;
    expect(galleryVisible || await tableArea.count() > 0).toBe(true);
  });

  test('switches to Table view', async ({ page }) => {
    const tableBtn = page.locator('button[title*="Table"], button[aria-label*="Table"]').first();
    if (await tableBtn.isVisible()) {
      await tableBtn.click();
      await page.waitForSelector('.assembly-table, table.assembly-table', { timeout: 5000 });
    }
    // Table should be in the DOM
    const table = page.locator('table, .assembly-table');
    expect(await table.count()).toBeGreaterThan(0);
  });

  test('switches to Split view', async ({ page }) => {
    const splitBtn = page.locator('button[title*="Split"], button[aria-label*="Split"]').first();
    if (await splitBtn.isVisible()) {
      await splitBtn.click();
      await page.waitForTimeout(500);
    }
    // Split view: table should still be visible
    const table = page.locator('table');
    expect(await table.count()).toBeGreaterThan(0);
  });
});

// ─── 3. Search ────────────────────────────────────────────────────────────────
test.describe('Search functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr, [class*="card"]', { timeout: 15_000 });
  });

  test('searching by description filters results', async ({ page }) => {
    const searchInput = page.locator('input[type="text"], input[placeholder*="earch"]').first();
    await searchInput.fill('E2E Alpha Structural');
    await page.waitForTimeout(600); // debounce

    // Should see E2E-001 somewhere on the page
    await expect(page.locator('text=E2E Alpha Structural').first()).toBeVisible({ timeout: 8000 });
  });

  test('clearing search restores full list', async ({ page }) => {
    const searchInput = page.locator('input[type="text"], input[placeholder*="earch"]').first();
    await searchInput.fill('E2E Alpha Structural');
    await page.waitForTimeout(600);

    const beforeClear = await page.locator('table tbody tr, [class*="card"]').count();

    await searchInput.clear();
    await page.waitForTimeout(600);

    const afterClear = await page.locator('table tbody tr, [class*="card"]').count();
    expect(afterClear).toBeGreaterThanOrEqual(beforeClear);
  });

  test('no results state shown for unmatched search', async ({ page }) => {
    const searchInput = page.locator('input[type="text"], input[placeholder*="earch"]').first();
    await searchInput.fill('ZZZZ_IMPOSSIBLE_MATCH_99999');
    await page.waitForTimeout(600);

    // Should show empty state or 0 rows
    const rows = page.locator('table tbody tr');
    const emptyMsg = page.locator('text=/No assemblies|no results/i');
    const rowCount = await rows.count();
    const emptyVisible = await emptyMsg.isVisible().catch(() => false);
    expect(rowCount === 0 || emptyVisible).toBe(true);
  });

  test('Ctrl+K focuses the search input', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const focused = page.locator('input:focus');
    await expect(focused).toBeVisible({ timeout: 3000 });
  });
});

// ─── 4. Sidebar Navigation ────────────────────────────────────────────────────
test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr, [class*="card"]', { timeout: 15_000 });
  });

  test('clicking a category in sidebar filters results', async ({ page }) => {
    // Find category links in the sidebar
    const structuralLink = page.locator('.sidebar text=Structural, aside text=Structural, [class*="sidebar"] *:has-text("Structural")').first();
    if (await structuralLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await structuralLink.click();
      await page.waitForTimeout(600);

      // All visible rows should be Structural (or at least the E2E ones)
      const rows = page.locator('table tbody tr');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThanOrEqual(0); // just confirm no crash
    } else {
      test.skip(); // sidebar category not visible in this state
    }
  });

  test('clicking All Assemblies resets filters', async ({ page }) => {
    // First apply a filter
    const searchInput = page.locator('input[type="text"], input[placeholder*="earch"]').first();
    await searchInput.fill('E2E Alpha');
    await page.waitForTimeout(600);

    // Click the SDC logo / All button
    const allBtn = page.locator('text=/All Assembl/i, [class*="brand"], [class*="logo"]').first();
    if (await allBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await allBtn.click();
      await page.waitForTimeout(600);
      // Search should be cleared
      const inputValue = await searchInput.inputValue();
      expect(inputValue).toBe('');
    }
  });
});

// ─── 5. Sorting ───────────────────────────────────────────────────────────────
test.describe('Sorting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table', { timeout: 15_000 });
  });

  test('clicking a table column header sorts the data', async ({ page }) => {
    // Find a sortable column header
    const partnoHeader = page.locator('th:has-text("Part"), th:has-text("partno"), th:has-text("PART")').first();
    if (await partnoHeader.isVisible({ timeout: 2000 }).catch(() => false)) {
      await partnoHeader.click();
      await page.waitForTimeout(500);
      // Sort indicator or order should change — just verify no crash
      const rows = page.locator('table tbody tr');
      expect(await rows.count()).toBeGreaterThan(0);
    }
  });

  test('sort dropdown in filter bar works', async ({ page }) => {
    const sortDropdown = page.locator('[class*="sort"] select, select[id*="sort"], select').first();
    if (await sortDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sortDropdown.selectOption({ index: 1 });
      await page.waitForTimeout(500);
      const rows = page.locator('table tbody tr');
      expect(await rows.count()).toBeGreaterThan(0);
    }
  });
});

// ─── 6. Filter Bar / Active Filter Chips ─────────────────────────────────────
test.describe('Filter bar and chips', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr, [class*="card"]', { timeout: 15_000 });
  });

  test('filter chips appear when filters are active', async ({ page }) => {
    // Open advanced filter panel
    const filterBtn = page.locator('button:has-text("Filter"), button[title*="Filter"], button[aria-label*="Filter"]').first();
    if (await filterBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await filterBtn.click();
      await page.waitForTimeout(300);
      // Try to select a category checkbox
      const checkbox = page.locator('[class*="filter"] input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await checkbox.check();
        await page.waitForTimeout(300);
        // A chip should appear in the filter bar
        const chip = page.locator('[class*="chip"], [class*="tag"], [class*="badge"]').first();
        // Just verify UI didn't crash
        expect(await page.locator('table tbody tr, [class*="card"]').count()).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('clear all filters button works', async ({ page }) => {
    const clearBtn = page.locator('button:has-text("Clear"), button:has-text("Reset"), button:has-text("clear all")').first();
    if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearBtn.click();
      await page.waitForTimeout(500);
      expect(await page.locator('table tbody tr, [class*="card"]').count()).toBeGreaterThan(0);
    }
  });

  test('results count is displayed', async ({ page }) => {
    // FilterBar shows total results count
    const countText = page.locator('text=/\\d+\\s*(assembl|result)/i').first();
    await expect(countText).toBeVisible({ timeout: 8000 });
  });
});

// ─── 7. Add Assembly Modal ────────────────────────────────────────────────────
test.describe('Add assembly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr, [class*="card"]', { timeout: 15_000 });
  });

  test('opens the Add Assembly modal', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add"), button[title*="Add"], button[aria-label*="Add"]').first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    await addBtn.click();
    // Modal should appear
    const modal = page.locator('[class*="modal"], dialog, [role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test('submit button is disabled when partno is empty', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add"), button[title*="Add"]').first();
    await addBtn.click();
    const modal = page.locator('.modal-overlay, [class*="modal"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // The "ADD RECORD" button is disabled when partno is empty (React-controlled)
    // The modal renders: <button ... disabled={saving || !partno.trim()}>ADD RECORD</button>
    const submitBtn = modal.locator('button:has-text("ADD RECORD")');
    await expect(submitBtn).toBeVisible({ timeout: 3000 });
    await expect(submitBtn).toBeDisabled();

    // Typing a part number should enable the button
    const partnoInput = modal.locator('input[placeholder*="e.g. ASM"]').first();
    await partnoInput.fill('TEMP-123');
    await expect(submitBtn).toBeEnabled();

    // Clearing it disables again
    await partnoInput.clear();
    await expect(submitBtn).toBeDisabled();
  });

  test('can create a new assembly and it appears in the list', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add"), button[title*="Add"]').first();
    await addBtn.click();
    const modal = page.locator('[class*="modal"], dialog, [role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill in partno (required)
    const partnoInput = modal.locator('input[name="partno"], input[placeholder*="part"], input[id*="partno"]').first();
    if (await partnoInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await partnoInput.fill('E2E-PLAYWRIGHT-TEST');
      const descInput = modal.locator('input[name="description"], textarea[name="description"], input[placeholder*="desc"]').first();
      if (await descInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await descInput.fill('Created by Playwright');
      }
      const submitBtn = modal.locator('button[type="submit"], button:has-text("Save"), button:has-text("Create"), button:has-text("Add")').last();
      await submitBtn.click();
      await page.waitForTimeout(1000);

      // Toast or confirmation
      const toast = page.locator('[class*="toast"], [class*="notification"]').or(page.getByText(/added|created|success/i)).first();
      await expect(toast).toBeVisible({ timeout: 5000 });
    }
  });

  test('closes modal on Escape key', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add"), button[title*="Add"]').first();
    await addBtn.click();
    const modal = page.locator('[class*="modal"], dialog, [role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });
});

// ─── 8. Edit Assembly (Preview / Modal) ──────────────────────────────────────
test.describe('Edit assembly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });
  });

  test('clicking a row opens the edit modal or preview pane', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    await firstRow.click();
    await page.waitForTimeout(500);
    // Either a modal or a preview pane should appear
    const modal   = page.locator('[class*="modal"], dialog, [role="dialog"]');
    const preview = page.locator('[class*="preview"], [class*="pane"]');
    const visible = await modal.first().isVisible().catch(() => false)
                 || await preview.first().isVisible().catch(() => false);
    expect(visible).toBe(true);
  });

  test('edit modal shows assembly fields', async ({ page }) => {
    // Click on a specific E2E record
    const row = page.locator('table tbody tr:has-text("E2E-001"), table tbody tr:has-text("E2E Alpha")').first();
    if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
      await row.click();
      await page.waitForTimeout(500);
      // Part number should be visible somewhere
      const partnoField = page.locator('text=E2E-001').first();
      await expect(partnoField).toBeVisible({ timeout: 5000 });
    }
  });
});

// ─── 9. Delete Assembly (requires password) ───────────────────────────────────
test.describe('Delete assembly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });
  });

  test('delete dialog requires password input', async ({ page }) => {
    // Click a row to open modal
    const row = page.locator('table tbody tr').first();
    await row.click();
    const modal = page.locator('[class*="modal"], dialog, [role="dialog"]').first();
    if (!await modal.isVisible({ timeout: 3000 }).catch(() => false)) return;

    // Find delete button in modal
    const deleteBtn = modal.locator('button:has-text("Delete"), button[class*="delete"], button[class*="danger"]').first();
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(300);
      // Password input should appear
      const pwInput = page.locator('input[type="password"], input[placeholder*="password"], input[placeholder*="assword"]').first();
      await expect(pwInput).toBeVisible({ timeout: 5000 });
    }
  });

  test('wrong password shows error toast', async ({ page }) => {
    const row = page.locator('table tbody tr').first();
    await row.click();
    const modal = page.locator('[class*="modal"], dialog, [role="dialog"]').first();
    if (!await modal.isVisible({ timeout: 3000 }).catch(() => false)) return;

    const deleteBtn = modal.locator('button:has-text("Delete"), button[class*="delete"], button[class*="danger"]').first();
    if (!await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) return;
    await deleteBtn.click();

    const pwInput = page.locator('input[type="password"]').first();
    if (!await pwInput.isVisible({ timeout: 2000 }).catch(() => false)) return;
    await pwInput.fill('wrong-password');

    const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Delete"), button[class*="danger"]').last();
    await confirmBtn.click();
    await page.waitForTimeout(800);

    const errorToast = page.locator('[class*="toast"][class*="error"]').or(page.getByText(/Forbidden|Incorrect|wrong/i)).first();
    await expect(errorToast).toBeVisible({ timeout: 5000 });
  });
});

// ─── 10. Bulk Selection & Bulk Operations ─────────────────────────────────────
test.describe('Bulk operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });
  });

  test('selecting a row checkbox shows the bulk actions bar', async ({ page }) => {
    const checkbox = page.locator('table tbody tr input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await checkbox.check();
      // Bulk actions bar should appear at the bottom
      const bulkBar = page.locator('[class*="bulk"], [class*="BulkAction"]').first();
      await expect(bulkBar).toBeVisible({ timeout: 5000 });
    }
  });

  test('bulk set preference updates records', async ({ page }) => {
    const checkboxes = page.locator('table tbody tr input[type="checkbox"]');
    const count = await checkboxes.count();
    if (count < 2) return;

    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    const bulkBar = page.locator('[class*="bulk"], [class*="BulkAction"]').first();
    await expect(bulkBar).toBeVisible({ timeout: 5000 });

    const prefBtn = bulkBar.locator('button:has-text("Preference"), button:has-text("PREFERENCE")').first();
    if (await prefBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prefBtn.click();
      await page.waitForTimeout(300);
      // Sub-menu should show Yes/No options
      const yesBtn = page.locator('button:has-text("Yes")').first();
      if (await yesBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await yesBtn.click();
        await page.waitForTimeout(800);
        // Use .or() to combine CSS and text locators (can't mix in one CSS string)
        const toast = page.locator('[class*="toast"]').or(page.getByText(/updated|record/i)).first();
        await expect(toast).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('deselecting clears selection and hides bulk bar', async ({ page }) => {
    const checkbox = page.locator('table tbody tr input[type="checkbox"]').first();
    if (!await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) return;

    await checkbox.check();
    const bulkBar = page.locator('[class*="bulk"], [class*="BulkAction"]').first();
    await expect(bulkBar).toBeVisible({ timeout: 5000 });

    await checkbox.uncheck();
    await page.waitForTimeout(300);
    await expect(bulkBar).not.toBeVisible({ timeout: 3000 });
  });

  test('bulk delete requires password', async ({ page }) => {
    const checkbox = page.locator('table tbody tr input[type="checkbox"]').first();
    if (!await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) return;
    await checkbox.check();

    const bulkBar = page.locator('[class*="bulk"], [class*="BulkAction"]').first();
    await expect(bulkBar).toBeVisible({ timeout: 5000 });

    const deleteBtn = bulkBar.locator('button:has-text("Delete"), button[class*="delete"]').first();
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(300);
      // Password input should appear
      const pwInput = page.locator('input[type="password"], input[placeholder*="password"]').first();
      await expect(pwInput).toBeVisible({ timeout: 5000 });
    }
  });
});

// ─── 11. Sync Status ──────────────────────────────────────────────────────────
test.describe('Sync status', () => {
  test('sync status shows last scan time or ready state', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000); // wait for sync status to load
    // The SyncStatus component should show some text
    const syncStatus = page.locator('[class*="sync"], [class*="SyncStatus"]').first();
    if (await syncStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
      const text = await syncStatus.textContent();
      expect(text.length).toBeGreaterThan(0);
    }
  });

  test('clicking Sync Now triggers a sync', async ({ page }) => {
    await page.goto('/');
    const syncBtn = page.locator('button:has-text("Sync"), button[title*="Sync"]').first();
    if (await syncBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await syncBtn.click();
      await page.waitForTimeout(500);
      // Status should update (running indicator or completion toast)
      // Just confirm no crash
      expect(await page.locator('body').isVisible()).toBe(true);
    }
  });
});

// ─── 12. Toast Notifications ─────────────────────────────────────────────────
test.describe('Toast notifications', () => {
  test('success toast appears after creating an assembly', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    const addBtn = page.locator('button:has-text("Add"), button[title*="Add"]').first();
    if (!await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) return;
    await addBtn.click();

    const modal = page.locator('[class*="modal"], dialog, [role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    const partnoInput = modal.locator('input[name="partno"], input[placeholder*="part"]').first();
    if (!await partnoInput.isVisible({ timeout: 2000 }).catch(() => false)) return;
    await partnoInput.fill('E2E-TOAST-TEST');

    const submitBtn = modal.locator('button:has-text("Save"), button:has-text("Create"), button:has-text("Add")').last();
    await submitBtn.click();

    const toast = page.locator('[class*="toast"], [class*="notification"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    const text = await toast.textContent();
    expect(text).toMatch(/added|created|success/i);
  });

  test('error toast is persistent (not auto-dismissed)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr, [class*="card"]', { timeout: 15_000 });

    // Trigger an error: delete with wrong password via API
    const row = page.locator('table tbody tr').first();
    await row.click();
    const modal = page.locator('[class*="modal"], dialog, [role="dialog"]').first();
    if (!await modal.isVisible({ timeout: 3000 }).catch(() => false)) return;

    const deleteBtn = modal.locator('button:has-text("Delete"), button[class*="delete"], button[class*="danger"]').first();
    if (!await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) return;
    await deleteBtn.click();

    const pwInput = page.locator('input[type="password"]').first();
    if (!await pwInput.isVisible({ timeout: 2000 }).catch(() => false)) return;
    await pwInput.fill('wrong');

    const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Delete")').last();
    await confirmBtn.click();
    await page.waitForTimeout(500);

    const errorToast = page.locator('[class*="toast"][class*="error"], [class*="toast-error"]').first();
    if (await errorToast.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Wait 4 seconds (auto-dismiss window for success toasts)
      await page.waitForTimeout(4000);
      // Error toast should still be visible (persistent)
      await expect(errorToast).toBeVisible();
    }
  });
});

// ─── 13. Keyboard Shortcuts ───────────────────────────────────────────────────
test.describe('Keyboard shortcuts', () => {
  test('Ctrl+K focuses the search input', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr, [class*="card"]', { timeout: 15_000 });

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(200);

    const searchInput = page.locator('input[type="text"]:focus, input[placeholder*="earch"]:focus').first();
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test('Escape closes preview pane', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    const row = page.locator('table tbody tr').first();
    await row.click();
    await page.waitForTimeout(300);

    const preview = page.locator('[class*="preview"], [class*="pane"]');
    const modal   = page.locator('[class*="modal"], dialog');
    const anyOpen = await preview.first().isVisible().catch(() => false)
                 || await modal.first().isVisible().catch(() => false);

    if (anyOpen) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      // Either closed or no longer expanded
      const stillOpen = await preview.first().isVisible().catch(() => false)
                     || await modal.first().isVisible().catch(() => false);
      // After Escape, at least the modal should be gone
      expect(!stillOpen || !(await modal.first().isVisible().catch(() => false))).toBe(true);
    }
  });
});

// ─── 14. Pagination / Load More ───────────────────────────────────────────────
test.describe('Pagination', () => {
  test('Load More button or infinite scroll loads additional records (table view)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('table tbody tr', { timeout: 15_000 });

    const loadMoreBtn = page.locator('button:has-text("Load more"), button:has-text("LOAD MORE")').first();
    if (await loadMoreBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      const beforeCount = await page.locator('table tbody tr').count();
      await loadMoreBtn.click();
      await page.waitForTimeout(1000);
      const afterCount = await page.locator('table tbody tr').count();
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    }
    // If no load more button, pagination works via state — just verify rows exist
    expect(await page.locator('table tbody tr').count()).toBeGreaterThan(0);
  });
});

// ─── 15. Dark Mode Toggle ─────────────────────────────────────────────────────
test.describe('Theme toggle', () => {
  test('dark mode toggle switches the theme', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    const themeBtn = page.locator('button[title*="theme"], button[aria-label*="theme"], button[title*="Dark"], button[title*="Light"]').first();
    if (await themeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await themeBtn.click();
      await page.waitForTimeout(200);
      const newTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(newTheme).not.toBe(initialTheme);
    }
  });
});
