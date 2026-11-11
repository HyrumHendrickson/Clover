# AGENTS.md

Guidance for AI coding agents and human contributors working in this repository.

## What this is

Clover is a static, dependency-free browser app (ES modules, no build step) for visualising mathematics. Runtime code has no npm dependencies; npm is used only for tests and linting.

## Commands

```sh
npm install          # dev tooling only
npm start            # serve at http://localhost:8080
npm run check        # lint + format check + tests (run before every commit)
npm test             # node --test, requires Node 22+
npm run format       # prettier --write
npm run verify:vendor
```

## Layout

- `index.html`, `css/` – shell and styles. Theme tokens live in `css/base.css`.
- `js/core/` – app shell, tabs, menus, dialogs, storage, workspace model.
- `js/lib/` – pure helpers: expression parser (`expr.js`), complex math, viewport, domain colouring, field numerics.
- `js/tools/` – one module per tool, plus `index.js` registry.
- `runner/` – sandboxed Python runner page (loaded in an iframe).
- `vendor/` – third-party files. Never edit by hand; see `vendor/skulpt/README.md`.
- `tests/` – `node:test` suites; `tests/support/` holds the jsdom and Skulpt harnesses.

## Adding a tool

1. Create `js/tools/<name>.js` exporting `{ type, name, description, defaultState, normalize, mount, preview? }`. `mount(root, ctx)` returns `{ onShow?, onHide?, destroy? }`.
2. `normalize(raw)` must accept any input (including hostile imports), return safe state, and be idempotent.
3. Mutate `ctx.state` in place and call `ctx.save()`. Do not touch `localStorage` directly.
4. Register it in `js/tools/index.js` and add an icon named `tool-<type>` in `js/core/icons.js`.
5. Add tests, including the hostile-input check in `tests/app.test.js`.

## Rules

- Never use `eval`, `new Function`, or `innerHTML`. Build DOM with `h()` from `js/core/dom.js`; text is inserted as text.
- The parser must stay closure-based so the CSP can forbid `unsafe-eval`. Only `runner/index.html` may allow it.
- The Python iframe must keep `sandbox="allow-scripts"` without `allow-same-origin`. Validate every `postMessage` (check `event.source` and shape). Tests enforce this.
- Anything imported from a file is untrusted: pass it through `parseImport` and the tool's `normalize`.
- Keep the file format backward compatible. Changing it requires bumping `VERSION` in `js/core/workspace.js`, a migration, and an update to `docs/file-format.md`.
- Respect `prefers-reduced-motion`, keep keyboard access and visible focus, and keep both themes working.
- Prose in the UI: sentence case, plain verbs, specific errors that say how to fix the problem.
- Do not add runtime dependencies without discussion.
