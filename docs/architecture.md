# Architecture

Clover is a static site: HTML, CSS, and ES modules served as-is.

```text
index.html ── js/main.js ── core/app.js (App)
                              ├─ core/workspace.js   pure model, import/export validation
                              ├─ core/store.js       localStorage
                              ├─ core/menu|dialog|toast.js
                              └─ tools/index.js ── desmos | matrix | complex | vectorfield | python
                                                    └─ lib/ expr, complexmath, viewport, domain, field, ...
python tool ── postMessage ── runner/index.html (sandboxed iframe) ── vendor/skulpt
```

## Tabs and tools

`App` owns the tab list. Each tool is an object with `normalize`, `mount`, and optional `preview`. `mount(root, ctx)` receives a state object that the tool mutates in place, then calls `ctx.save()`; the app debounces persistence. Tool instances are created on first activation and kept alive while hidden, with `onShow` and `onHide` for pausing work.

## Expressions

`lib/expr.js` tokenises and parses one grammar and compiles it into closures for either real values (`compileReal`) or complex values (`compileComplex`). Complex nodes write into per-node buffers, so evaluating a function across a canvas allocates nothing. Constant subtrees are folded, and integer powers use exact repeated multiplication.

## Plots

`lib/viewport.js` defines `View` (centre and radius, device independent) and grid drawing. `lib/interact.js` adds pan, zoom, pinch, and keyboard control. Domain colouring renders progressively: a coarse pass for responsiveness, then a full pass in time-sliced bands.

## Python

Skulpt needs `unsafe-eval`, so it lives in `runner/`, loaded in an iframe with `sandbox="allow-scripts"` (opaque origin) and its own restrictive CSP. Each run uses a fresh iframe, and Stop removes it. The parent accepts messages only from that frame and validates their shape.

## Testing

Pure modules are unit tested directly. `tests/support/skulpt-harness.js` runs the vendored Skulpt build in jsdom with a recording canvas, and `tests/support/dom.js` mounts the whole app for smoke tests.
