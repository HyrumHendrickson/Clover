/* Runs before first paint so the page never flashes the wrong theme. */
(function () {
  var theme = null;
  var params = new URLSearchParams(window.location.search);
  var embedded = params.has('embed');
  if (embedded) {
    // An embedded frame follows its address, not a preference saved by the full site on this device.
    var asked = params.get('theme');
    if (asked === 'light' || asked === 'dark') theme = asked;
  } else {
    try {
      var saved = localStorage.getItem('clover:theme');
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch {
      /* storage unavailable */
    }
  }
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
