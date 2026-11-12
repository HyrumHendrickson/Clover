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
  /** @param {string} [key] storage key; embedded frames use their own so they never touch the full site's workspace
   * @returns {any|null} parsed saved workspace, or null */
  loadWorkspace(key = WORKSPACE_KEY) {
    const text = safeGet(key);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },

  /** @returns {boolean} false if the browser refused the write */
  saveWorkspace(workspace, key = WORKSPACE_KEY) {
    return safeSet(key, JSON.stringify(workspace));
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
