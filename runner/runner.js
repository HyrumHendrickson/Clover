/*
 * Clover Python runner.
 *
 * This page is loaded in an iframe with `sandbox="allow-scripts"` and no
 * `allow-same-origin`, so it has an opaque origin: it cannot read Clover's
 * storage, touch the parent page, or make network requests (see the CSP in
 * index.html). The parent decides how long a frame lives. Removing the frame is
 * how a run is stopped, and it also discards any variables the frame held.
 *
 * Protocol (postMessage). Every message is validated on both sides.
 *
 *   One-shot program (the turtle tab; each run uses a fresh frame):
 *     parent -> runner   { type: 'run', code }
 *                        { type: 'snapshot' }
 *     runner -> parent   { type: 'ready' }
 *                        { type: 'stdout', text }
 *                        { type: 'done' }
 *                        { type: 'error', message }
 *                        { type: 'snapshot', dataUrl }
 *
 *   Session (notebook cells; one frame, globals persist from cell to cell):
 *     parent -> runner   { type: 'cell', id, code, canvas }   canvas: draw with turtle, send frames
 *                        { type: 'reset' }                      forget every variable
 *     runner -> parent   { type: 'stdout', id, text }
 *                        { type: 'frame', id, dataUrl }
 *                        { type: 'cell-done', id }
 *                        { type: 'cell-error', id, message }
 *                        { type: 'reset-done' }
 *
 *   Cellular automaton rules:
 *     parent -> runner   { type: 'ca-load', code }
 *                        { type: 'ca-step', cells, width, height, steps }
 *     runner -> parent   { type: 'ca-ready', colors, names, wrap, edge }
 *                        { type: 'ca-result', cells }
 *                        { type: 'ca-error', message }
 */
(function () {
  'use strict';

  var STAGE_SIZE = 640;
  var MAX_CODE_LENGTH = 200000;
  var MAX_STATES = 16;
  var MAX_GRID = 200;
  var MAX_STEPS = 10;
  var ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
  var COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
  var FRAME_MS = 250;
  var stage = document.getElementById('stage');
  var session = null;
  var automaton = null;

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

  function configure(onOutput) {
    Sk.configure({
      output: onOutput,
      read: builtinRead,
      __future__: Sk.python3,
      yieldLimit: 50,
    });
    Sk.TurtleGraphics = { target: 'stage', width: STAGE_SIZE, height: STAGE_SIZE };
  }

  function clearStage() {
    while (stage.firstChild) stage.removeChild(stage.firstChild);
  }

  /** A fresh module namespace, as `__main__` would have. */
  function newGlobals() {
    return { __name__: new Sk.builtin.str('__main__'), __doc__: Sk.builtin.none.none$ };
  }

  /**
   * Run `code` in the namespace `globals`, so names defined by earlier runs stay visible.
   * Skulpt's own `importMainWithBody` always builds a new module, which is why this compiles by hand.
   */
  function execIn(globals, code, filename) {
    return Sk.misceval.asyncToPromise(function () {
      var compiled = Sk.compile(code, filename, 'exec', true);
      var body = Sk.global.eval(compiled.code + '\n' + compiled.funcname + ';');
      Sk.execStart = Sk.lastYield = new Date();
      return body(globals);
    });
  }

  function snapshotUrl() {
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
    return out.toDataURL('image/png');
  }

  /* ------------------------------------------------------------ one program */

  function run(code) {
    clearStage();
    configure(function (text) {
      post({ type: 'stdout', text: String(text) });
    });
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

  /* ---------------------------------------------------------------- session */

  function runCell(id, code, canvas) {
    if (!session) session = newGlobals();
    var timer = 0;
    configure(function (text) {
      post({ type: 'stdout', id: id, text: String(text) });
    });
    if (canvas) {
      clearStage();
      // Importing turtle again gives this cell a fresh screen. The old one belongs to a cell that has finished.
      try {
        Sk.sysmodules.mp$del_subscript(new Sk.builtin.str('turtle'));
      } catch {
        // turtle was not imported yet.
      }
      timer = setInterval(function () {
        post({ type: 'frame', id: id, dataUrl: snapshotUrl() });
      }, FRAME_MS);
    }
    execIn(session, code, '<cell>').then(
      function () {
        if (timer) clearInterval(timer);
        if (canvas) post({ type: 'frame', id: id, dataUrl: snapshotUrl() });
        post({ type: 'cell-done', id: id });
      },
      function (error) {
        if (timer) clearInterval(timer);
        if (canvas) post({ type: 'frame', id: id, dataUrl: snapshotUrl() });
        post({ type: 'cell-error', id: id, message: String(error) });
      },
    );
  }

  /* ---------------------------------------------------- cellular automata */

  function fail(message) {
    post({ type: 'ca-error', message: message });
  }

  function loadRule(code) {
    var globals = newGlobals();
    configure(function (text) {
      post({ type: 'stdout', id: 'ca', text: String(text) });
    });
    execIn(globals, code, '<rule>').then(
      function () {
        var rule = globals.rule;
        if (!rule || typeof rule.tp$call !== 'function') {
          fail('Define a function named rule, like def rule(cell, neighbors): ...');
          return;
        }
        var argc = rule.co_argcount;
        if (typeof argc !== 'number' || argc < 1 || argc > 4) {
          fail(
            'rule takes between one and four arguments: (cell), (cell, neighbors), (cell, neighbors, x), or (cell, neighbors, x, y).',
          );
          return;
        }
        var colors = globals.COLORS ? Sk.ffi.remapToJs(globals.COLORS) : ['#ffffff', '#000000'];
        if (!Array.isArray(colors) || colors.length < 2 || colors.length > MAX_STATES) {
          fail('COLORS must be a list of 2 to ' + MAX_STATES + ' colours written like "#rrggbb".');
          return;
        }
        for (var i = 0; i < colors.length; i += 1) {
          if (typeof colors[i] !== 'string' || !COLOR_PATTERN.test(colors[i])) {
            fail('COLORS entry ' + (i + 1) + ' must be written like "#1f5124".');
            return;
          }
        }
        var names = globals.NAMES ? Sk.ffi.remapToJs(globals.NAMES) : [];
        names = Array.isArray(names)
          ? names.slice(0, colors.length).map(function (n) {
              return String(n).slice(0, 24);
            })
          : [];
        var wrap = globals.WRAP === undefined ? true : Boolean(Sk.ffi.remapToJs(globals.WRAP));
        var edge = globals.EDGE === undefined ? 0 : Sk.ffi.remapToJs(globals.EDGE);
        if (typeof edge !== 'number' || edge < 0 || edge >= colors.length || Math.floor(edge) !== edge) edge = 0;
        automaton = { rule: rule, argc: argc, states: colors.length, wrap: wrap, edge: edge };
        post({ type: 'ca-ready', colors: colors, names: names, wrap: wrap, edge: edge });
      },
      function (error) {
        fail(String(error));
      },
    );
  }

  function stepAutomaton(cells, width, height, steps) {
    if (!automaton) {
      fail('Load a rule first.');
      return;
    }
    var states = automaton.states;
    var ints = [];
    for (var s = 0; s < states; s += 1) ints.push(new Sk.builtin.int_(s));
    var rule = automaton.rule;
    var argc = automaton.argc;
    var wrap = automaton.wrap;
    var edge = automaton.edge;
    var current = Uint8Array.from(cells);
    var next = new Uint8Array(width * height);
    var offsets = [
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
    ];
    configure(function (text) {
      post({ type: 'stdout', id: 'ca', text: String(text) });
    });
    Sk.execStart = Sk.lastYield = new Date();
    try {
      for (var step = 0; step < steps; step += 1) {
        for (var y = 0; y < height; y += 1) {
          for (var x = 0; x < width; x += 1) {
            var neighbours = [];
            for (var k = 0; k < 8; k += 1) {
              var nx = x + offsets[k][0];
              var ny = y + offsets[k][1];
              if (wrap) {
                nx = (nx + width) % width;
                ny = (ny + height) % height;
                neighbours.push(ints[current[ny * width + nx]]);
              } else if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                neighbours.push(ints[edge]);
              } else {
                neighbours.push(ints[current[ny * width + nx]]);
              }
            }
            var args = [
              ints[current[y * width + x]],
              new Sk.builtin.list(neighbours),
              new Sk.builtin.int_(x),
              new Sk.builtin.int_(y),
            ];
            var result = Sk.ffi.remapToJs(Sk.misceval.callsimArray(rule, args.slice(0, argc)));
            if (typeof result === 'boolean') result = result ? 1 : 0;
            if (typeof result !== 'number' || Math.floor(result) !== result || result < 0 || result >= states) {
              throw new Error(
                'rule returned ' +
                  String(result) +
                  ' for the cell at column ' +
                  x +
                  ', row ' +
                  y +
                  '. Return a whole number from 0 to ' +
                  (states - 1) +
                  '.',
              );
            }
            next[y * width + x] = result;
          }
        }
        var swap = current;
        current = next;
        next = swap;
      }
    } catch (error) {
      fail(String(error && error.message ? error.message : error));
      return;
    }
    post({ type: 'ca-result', cells: current });
  }

  /* --------------------------------------------------------------- messages */

  var isInt = function (n, min, max) {
    return typeof n === 'number' && Math.floor(n) === n && n >= min && n <= max;
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    var codeOk = typeof data.code === 'string' && data.code.length <= MAX_CODE_LENGTH;
    if (data.type === 'run' && codeOk) {
      run(data.code);
    } else if (data.type === 'snapshot') {
      post({ type: 'snapshot', dataUrl: snapshotUrl() });
    } else if (data.type === 'cell' && codeOk && typeof data.id === 'string' && ID_PATTERN.test(data.id)) {
      runCell(data.id, data.code, data.canvas === true);
    } else if (data.type === 'reset') {
      session = null;
      clearStage();
      post({ type: 'reset-done' });
    } else if (data.type === 'ca-load' && codeOk) {
      loadRule(data.code);
    } else if (
      data.type === 'ca-step' &&
      isInt(data.width, 1, MAX_GRID) &&
      isInt(data.height, 1, MAX_GRID) &&
      isInt(data.steps, 1, MAX_STEPS) &&
      data.cells &&
      data.cells.length === data.width * data.height
    ) {
      stepAutomaton(data.cells, data.width, data.height, data.steps);
    }
  });

  window.addEventListener('resize', fitStage);
  fitStage();
  post({ type: 'ready' });
})();
