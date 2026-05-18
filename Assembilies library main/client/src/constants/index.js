/**
 * constants/index.js
 * Global application constants.
 */

export const LIMIT = 40;

export const DEFAULT_VISIBLE_COLS = ['file_name', 'job_name'];

export const VIEW_MODES = {
  TABLE: 'table',
  SPLIT: 'split',
  GRID: 'grid',
};

export const PREDEFINED_CATEGORIES = [
  'chassis', 'conveyor', 'cutting', 'die set', 'dispensing', 'escapement', 'feeding',
  'fixture', 'fixture - assembly chassis', 'gripper', 'heating and cooling', 'HMI',
  'indexer', 'insertion', 'inspection', 'labeler', 'laser', 'linear motion', 'marking',
  'packaging', 'pick and place', 'pneumatics', 'power transmission', 'press', 'process',
  'rotary motion', 'safety', 'screw drive', 'structural', 'testing', 'tray handling',
  'tooling', 'verify', 'slide',
];
