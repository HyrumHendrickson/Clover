# Siglum engine (vendored)

[`@siglum/engine`](https://github.com/SiglumProject/siglum) 0.2.2 compiles LaTeX in the browser with TeX Live running in
WebAssembly (a build of [BusyTeX](https://github.com/busytex/busytex)). Clover uses it in the LaTeX tab, inside a sandboxed
frame (see `runner/latex.html`).

| Item    | Value                                                |
| ------- | ---------------------------------------------------- |
| Version | 0.2.2                                                |
| License | MIT (see `LICENSE`)                                  |
| Files   | `engine.js` (ES module) and `worker.js` (classic worker script) |

The two files were produced by `scripts/vendor-siglum.mjs`, which bundles the npm package with esbuild. The optional BLAKE3
hash is switched off, as the engine's documentation recommends for bundlers. Do not edit them by hand.

The WebAssembly binary, format files, and TeX packages are not stored here. The engine downloads them on first use from the
Siglum runtime service (`packages.siglum.org`) and caches them. That is the only network access the LaTeX tab makes, and it
happens inside the frame, which has no access to your saved workspace.
