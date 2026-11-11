# Clover

A browser workspace for visualising mathematics. Open as many tabs as you like, including several of the same tool, and share your work as a single file.

![Clover launcher](docs/images/launcher.png)

## Tools

| Tool                  | What it does                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Graphing**          | A built-in 2D graphing calculator: functions, equations, inequalities, polar and parametric curves, points and lists, sliders, and click-to-inspect intercepts.  |
| **Matrices**          | Matrix × matrix and matrix × vector, one dot product at a time. For 2×2 maps it draws the transformed grid, unit square, and basis vectors. Drag the vector tip. |
| **Complex functions** | Domain colouring of any f(z). Three colourings, pan and zoom, a value probe, and PNG export.                                                                     |
| **Vector fields**     | Plot F = ⟨P, Q⟩ as arrows, magnitude shading, and animated flow. Click to trace trajectories. Divergence and curl are shown under the cursor.                    |
| **Python turtle**     | Python with the `turtle` module, run in the browser. Presets for Koch, Sierpinski, dragon, tree, Hilbert, Lévy, Gosper, and Barnsley fern.                       |

![Complex functions](docs/images/complex.png)
![Python turtle](docs/images/python.png)

## Saving and sharing

- Work is saved automatically in your browser's local storage. Nothing is sent to a server.
- **Export** writes the whole workspace or one tab to a `.clover` file. A recipient opens it with **Import** or by dropping it on the page and sees what you saw. See [docs/file-format.md](docs/file-format.md).
- Graphs are saved as their expressions, so a shared file reproduces the whole graph. Files from version 1 that held a Desmos link open as an empty graph with the link kept as a note.

## Run locally

Clover is a static site with no build step. ES modules do not load from `file://`, so serve the folder:

```sh
npm start            # http://localhost:8080
# or
python3 -m http.server 8080
```

## Develop

```sh
npm install
npm run check        # lint, format check, tests
npm test
npm run verify:vendor
```

Tests cover the expression parser, complex math, domain colouring, field numerics, import validation, every Python preset (run through the real Skulpt build), and UI smoke tests in jsdom. See [AGENTS.md](AGENTS.md) for conventions and [docs/architecture.md](docs/architecture.md) for the design.

## Deploy

Push to `main`. The Pages workflow in `.github/workflows/pages.yml` publishes the site. Enable it under **Settings → Pages → Source: GitHub Actions**.

## Security

Shared files are treated as untrusted data. Python runs in a sandboxed iframe with no access to your saved workspace or the network, and only when you press Run. See [SECURITY.md](SECURITY.md).

## Third-party software

[Skulpt](https://github.com/skulpt/skulpt) (MIT) is vendored in `vendor/skulpt`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The graphing tool is original code. Its input syntax follows Desmos conventions where practical; Clover is not affiliated with Desmos Studio PBC. See [docs/graphing.md](docs/graphing.md) for the full syntax.

## License

[MIT](LICENSE)
