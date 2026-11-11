/*
 * Clover Python runner.
 *
 * This page is loaded in an iframe with `sandbox="allow-scripts"` and no
 * `allow-same-origin`, so it has an opaque origin: it cannot read Clover's
 * storage, touch the parent page, or make network requests (see the CSP in
 * index.html). The parent starts every run with a fresh iframe, which is also
 * how a run is stopped.
 *
 * Protocol (postMessage):
 *   parent -> runner   { type: 'run', code: string }
 *                      { type: 'snapshot' }
 *   runner -> parent   { type: 'ready' }
 *                      { type: 'stdout', text }
 *                      { type: 'done' }
 *                      { type: 'error', message }
 *                      { type: 'snapshot', dataUrl }
 */
(function () {
  'use strict';

  var STAGE_SIZE = 640;
  var MAX_CODE_LENGTH = 200000;
  var stage = document.getElementById('stage');

  function post(message) {
    window.parent.postMessage(message, '*');
  }

  function fitStage() {
    var scale = Math.min(window.innerWidth / STAGE_SIZE, window.innerHeight / STAGE_SIZE);
    stage.style.transform = 'scale(' + (scale > 0 ? scale : 1) + ')';
  }

  function builtinRead(path) {
    if (!Sk.builtinFiles || Sk.builtinFiles.files[path] === undefined) {
      throw new Error("File not found: '" + path + "'");
    }
    return Sk.builtinFiles.files[path];
  }

  function run(code) {
    while (stage.firstChild) stage.removeChild(stage.firstChild);
    Sk.configure({
      output: function (text) {
        post({ type: 'stdout', text: String(text) });
      },
      read: builtinRead,
      __future__: Sk.python3,
      yieldLimit: 50,
    });
    Sk.TurtleGraphics = { target: 'stage', width: STAGE_SIZE, height: STAGE_SIZE };
    Sk.misceval
      .asyncToPromise(function () {
        return Sk.importMainWithBody('<stdin>', false, code, true);
      })
      .then(
        function () {
          post({ type: 'done' });
        },
        function (error) {
          post({ type: 'error', message: String(error) });
        },
      );
  }

  function snapshot() {
    var canvases = stage.querySelectorAll('canvas');
    var out = document.createElement('canvas');
    out.width = STAGE_SIZE;
    out.height = STAGE_SIZE;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, STAGE_SIZE, STAGE_SIZE);
    for (var i = 0; i < canvases.length; i += 1) {
      ctx.drawImage(canvases[i], 0, 0, STAGE_SIZE, STAGE_SIZE);
    }
    post({ type: 'snapshot', dataUrl: out.toDataURL('image/png') });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'run' && typeof data.code === 'string' && data.code.length <= MAX_CODE_LENGTH) {
      run(data.code);
    } else if (data.type === 'snapshot') {
      snapshot();
    }
  });

  window.addEventListener('resize', fitStage);
  fitStage();
  post({ type: 'ready' });
})();
