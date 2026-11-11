/* Runs before first paint so the page never flashes the wrong theme. */
(function () {
  var theme = null;
  try {
    var saved = localStorage.getItem('clover:theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    /* storage unavailable */
  }
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
