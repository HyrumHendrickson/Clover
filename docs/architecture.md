# Architecture

Clover is a static site: HTML, CSS, and ES modules served as-is.

```text
index.html ── js/main.js ── core/app.js (App)
                              ├─ core/workspace.js   pure model, import/export validation
                              ├─ core/store.js       localStorage
                              ├─ core/menu|dialog|toast.js, mathfield.js, exprlist.js
                              └─ tools/index.js ── graph | graph3d | notebook | matrix | stats | complex | vectorfield | python
                                                    └─ lib/ expr, complexmath, viewport, domain, field, ...
python tool ── postMessage ── runner/index.html (sandboxed iframe) ── vendor/skulpt
```

## Tabs and tools

`App` owns the tab list. Each tool is an object with `normalize`, `mount`, and optional `preview`. `mount(root, ctx)` receives a state object that the tool mutates in place, then calls `ctx.save()`; the app debounces persistence. Tool instances are created on first activation and kept alive while hidden, with `onShow` and `onHide` for pausing work.

## Expressions

`lib/expr.js` tokenises and parses one grammar and compiles it into closures for either real values (`compileReal`) or complex values (`compileComplex`). Complex nodes write into per-node buffers, so evaluating a function across a canvas allocates nothing. Constant subtrees are folded, and integer powers use exact repeated multiplication.

## Plots

`lib/viewport.js` defines `View` (centre and radius, device independent) and grid drawing. `lib/interact.js` adds pan, zoom, pinch, and keyboard control. Domain colouring renders progressively: a coarse pass for responsiveness, then a full pass in time-sliced bands.

## Graphing

`lib/graph/` is a small language and rendering engine, pure and unit tested without a canvas:

- `parse.js` and `compile.js` turn a typed line into an AST, then into closures over a slot array. Names are single letters, so `xy` is `x * y`; `names.js` lists the reserved words.
- `model.js` decides what each row means (curve, region, definition, slider, value), orders definitions by dependency, and reports circular or duplicate ones. Slider changes mutate a value cell, so plots redraw without recompiling.
- `sample.js` turns plots into pixel geometry: adaptive sampling that breaks at asymptotes and steps, refined parametric sampling, marching squares for implicit curves with a pole filter, and raster fill for inequalities. `draw.js` strokes it and returns geometry for hit testing.
- `analysis.js` finds intercepts, extrema, and intersections of explicit functions. `view.js` is a viewport whose axes scale independently.

While you pan, zoom, or drag a slider the tool renders at reduced quality, then redraws in full once input settles.

## Rows, tables, and folders

`lib/graph/rows.js` is pure. It validates saved rows, keeps folders consistent (a folder's rows always follow it), and expands tables for the model: a table becomes ordinary rows (`x_1 = [1, 2, 3]` for a typed column, a value row for a computed one, `(x_1, y_1)` for a plotted one), so dependency ordering, errors, and use from other rows need no special cases. `GraphModel.update` does the expansion itself, so the 3D graph gets tables too, with plotting off. `~` rows are regression plans: the unknown names become definitions ordered after the data they use, and the fit runs inside the normal evaluation pass (`lib/fit.js`). `core/structrows.js` builds the folder, table, and options-menu rows for both lists.

## Statistics

`lib/stats.js` (distributions, descriptive statistics, tests) and `lib/fit.js` (least squares) are pure and checked against SciPy and NumPy values in `tests/stats.test.js`. `lib/statchart.js` turns data into chart descriptions that a test can read, then paints them. The graphing language reaches the same code through the `distcall` node and the statistics builtins in `compile.js`.

## Python

Skulpt needs `unsafe-eval`, so it lives in `runner/`, loaded in an iframe with `sandbox="allow-scripts"` (opaque origin) and its own restrictive CSP. Each run uses a fresh iframe, and Stop removes it. The parent accepts messages only from that frame and validates their shape.

## Testing

Pure modules are unit tested directly. `tests/support/skulpt-harness.js` runs the vendored Skulpt build in jsdom with a recording canvas, and `tests/support/dom.js` mounts the whole app for smoke tests.

## Typeset math, 3D, and notebooks

- `lib/graph/typeset.js` turns text into a layout tree (tolerant of half-typed input) and renders it with `h()`. `core/mathfield.js` wraps an `<input>` so it shows typeset math when idle and a live preview while focused. `core/exprlist.js` is the shared row list (sliders, limits, errors) used by 3D and notebook cells.
- `lib/graph3d/` holds the orbit `camera.js`, pure geometry in `mesh.js` (grid surfaces, marching tetrahedra, clipping to the unit cube), `model.js` (a `GraphModel` subclass), and a painter's-algorithm software renderer in `render.js`.
- The notebook compiles all math and graph rows of every cell into one `GraphModel`, so definitions are shared; each graph cell draws only its own rows.
