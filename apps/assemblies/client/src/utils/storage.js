/**
 * storage.js
 * Persistence utilities for local storage.
 */

export const STORAGE_KEYS = {
  VISIBLE_COLS: 'sdc-visible-cols',
  THEME: 'sdc-theme',
  VIEW_MODE: 'sdc-view',
  FILTER_PRESETS: 'sdc-filter-presets',
};

export const loadVisibleCols = (defaultCols = ['job_name']) => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.VISIBLE_COLS);
    if (saved) return new Set(JSON.parse(saved));
  } catch (e) {
    console.warn('Failed to load visible columns from storage', e);
  }
  return new Set(defaultCols);
};

export const saveVisibleCols = (cols) => {
  try {
    localStorage.setItem(STORAGE_KEYS.VISIBLE_COLS, JSON.stringify([...cols]));
  } catch (e) {
    console.error('Failed to save visible columns to storage', e);
  }
};
