/**
 * Browser persistence. Clover uses localStorage (not cookies): data stays on
 * this device, is never sent to a server, and is not attached to requests.
 */
const WORKSPACE_KEY = 'clover:workspace:v1';
const THEME_KEY = 'clover:theme';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export const store = {
  /** @returns {any|null} parsed saved workspace, or null */
  loadWorkspace() {
    const text = safeGet(WORKSPACE_KEY);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },

  /** @returns {boolean} false if the browser refused the write */
  saveWorkspace(workspace) {
    return safeSet(WORKSPACE_KEY, JSON.stringify(workspace));
  },

  clearWorkspace() {
    try {
      localStorage.removeItem(WORKSPACE_KEY);
    } catch {
      /* storage unavailable */
    }
  },

  loadTheme() {
    const value = safeGet(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  },

  saveTheme(theme) {
    safeSet(THEME_KEY, theme);
  },
};
