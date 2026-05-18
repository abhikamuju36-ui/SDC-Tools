/**
 * formatters.js
 * High-fidelity utility functions for data formatting and presentation.
 */

/**
 * Formats a date string into a relative "time ago" string or a local date.
 */
export const formatTimeAgo = (date) => {
  if (!date) return 'Not available';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Invalid date';
    
    const now = new Date();
    const diffInSeconds = Math.floor((now - d) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return 'Yesterday';
    if (diffInDays < 7) return `${diffInDays}d ago`;
    
    return d.toLocaleDateString(undefined, { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch (e) {
    return '...';
  }
};

/**
 * Formats numbers with locale-specific separators.
 */
export const formatNumber = (num) => {
  return Number(num || 0).toLocaleString();
};

/**
 * Converts a string to Title Case, handling underscores and hyphens.
 */
export const toTitleCase = (str) => {
  if (!str) return '---';
  return str
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/**
 * Cleans and truncates text for display.
 */
export const truncateText = (text, maxLength = 60) => {
  if (!text) return '---';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

/**
 * Maps a category or library name to a specific accent color.
 * Returns a CSS class or color code.
 */
export const getCategoryColor = (category) => {
  if (!category) return 'slate';
  const c = category.toLowerCase();
  
  if (c.includes('standard')) return 'blue';
  if (c.includes('job') || c.includes('custom')) return 'amber';
  if (c.includes('library')) return 'indigo';
  if (c.includes('internal')) return 'emerald';
  if (c.includes('archive')) return 'rose';
  
  return 'slate';
};

/**
 * Ensures a value is never just an empty string or null in the UI.
 */
export const cleanValue = (val) => {
  if (val === null || val === undefined || val === '' || val === 'None') return '---';
  return val;
};
