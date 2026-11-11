# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A Geometry tool for Euclidean geometry with an exact engine. Claims are proved only when exact algebra shows they hold for every position of the free points, and refuted only by an exact counterexample; nothing is measured. The figure on screen is checked exactly too and reported separately.
- Notebook cells can embed any other tool, each with its own saved state.
- Math fields are edited as typeset math, in place, with a caret inside exponents, fractions, and roots. Brackets close themselves, and Tab moves between the arguments of a sum.
- Typing `sum`, `prod`, or `int` produces the ∑, ∏, or ∫ sign, with empty limits to fill in.
- A 3D graphing tool: surfaces, implicit surfaces, space curves, parametric surfaces, and points, with orbit, pan, zoom, preset views, and PNG export.
- A notebook tool: text, math, and graph cells that share definitions and sliders.
- Typeset math in graph rows (raised powers, fractions, roots, big operators), a live preview while editing, and automatic Greek letters when a name like `theta` is typed.
- `d/dx` derivatives, Greek letters as variable names, and lists in definitions: `f(x) = [1, 2, 3]x` draws three curves.
- A built-in Graphing tool: functions, implicit equations, inequalities (dashed boundaries for strict ones), polar and parametric curves, points, lists, piecewise values, restrictions, sliders with animation, derivatives, sums, and integrals. Click a curve for its intercepts, turning points, and intersections.

### Changed

- The Matrices tool is a sheet: type `matrix` or use the buttons to create a named grid of any size, then calculate with `A+B`, `A*B`, `A^-1`, `det(A)`, `solve(A, b)`, and more on later lines. Arithmetic is exact. The old multiplication walkthrough and 2×2 picture are removed.
- File format version 3. Older files still open; saved matrix tabs are converted to lines.
- The Desmos embed is replaced by the Graphing tool, and the Content-Security-Policy no longer allows frames from desmos.com.
- File format version 2. Version 1 files still open: Desmos tabs become graphs, keeping any saved share link as a note.

## [0.1.0]

### Added

- Tabbed workspace with launcher, rename, duplicate, reorder, close with undo, and a 24-tab limit.
- Desmos, Matrices, Complex functions, Vector fields, and Python turtle tools.
- Automatic local saving, and export and import of `.clover` workspace and tab files.
- Light and dark themes.
- Sandboxed Python runner using vendored Skulpt 1.2.0, with nine fractal presets.
