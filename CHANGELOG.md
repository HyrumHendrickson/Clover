# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Home screen: tools are grouped into sections and a search box filters them by name, description, or related words (press / to focus it, Enter to open the first match, Escape to clear it). The Help dialog lists the keyboard shortcuts.
- A Probability tab: exact permutations and combinations (with or without repeats, up to 1000), two events (union, conditional probabilities, independence), Bayes' theorem with natural frequencies, binomial probabilities with a shaded chart, and the expected value, variance, and standard deviation of a random variable. See docs/calculators.md.
- A Finance tab: compound interest with regular contributions and inflation, the contribution needed to reach a savings goal, loan payments with extra payments and a year-by-year schedule, present and future value solved for any unknown, and NPV, IRR, and payback with an NPV profile chart. See docs/calculators.md.
- Statistics: data goes into a spreadsheet-style grid with named columns, row numbers, and arrow-key movement, and the sheet grows as you type. **Upload CSV** loads a file (comma, tab, or semicolon separated; a text-only first row is used as the column names), **Download** saves the data as CSV, and **Edit as text** shows and edits the same data as CSV text. Pasting cells from a spreadsheet or CSV text fills the grid from the cell you paste into. Up to 8 columns and 500 rows.
- Graphing (2D and 3D): a button to hide and show the expression list.
- Symbolic algebra: a command reference beside the session (select an entry to put its example in the input), starting points when the session is empty, and a Run button.
- A Programming tab that runs Python, Rust, C, C++, and Java, with standard input and a highlighted editor. Code runs on a Judge0 service; see docs/programming.md.
- Embedding: `?embed=1` shows Clover without page chrome, `&tool=<type>` shows one tool, `&tools=a,b` offers a subset, and `embed.js` adds a `<clover-embed>` element. The Export menu has an "Embed on a website" dialog. See docs/embedding.md.
- Linear algebra: an Examples menu, and a legend and one-line summary under the picture.
- Statistics: headline tiles, a confidence interval for the mean, skewness and kurtosis, prediction from a regression, hypotheses and a plain-language verdict for each test, a chart of the test statistic with the p-value shaded, and a button to copy results as text.
- LaTeX tab: create folders, and put new files and uploads into the selected folder.
- 3D graphing: hover a surface to see the coordinates of the point under the pointer.
- Graphing: expression rows are numbered.
- Clicking the Clover logo returns to the home screen without closing tabs.
- Press ? to open Help. Help lists keyboard shortcuts as a table, and dialogs and messages have a close button.
- The tab strip scrolls with the mouse wheel and fades at an edge where tabs are cut off.
- Notebook: an empty notebook explains how to add the first cell.

### Changed

- Mobile: pages no longer scroll sideways, so the theme and Help buttons stay on screen, and tools that stack their panels (Linear algebra, Cellular automata, Python turtle, Programming, LaTeX) no longer overlap them.
- Home screen: one tool per short row on phones, section headings in sentence case with a tool count, and no duplicate logo.
- Buttons that open a menu show a chevron. Import, Export, and Help have tooltips.
- Statistics, Finance, and Probability inputs fill their cells instead of staying 58 pixels wide.
- Graphing: the Add buttons wrap instead of hiding behind a scroll, and the expression list is up to 400 pixels wide.
- Small section labels are in sentence case, as the rest of the interface is.
- The Notebook picture on the home screen shows a written cell, a math cell, and a graph cell that share a definition, and draws correctly in both themes.
- The README now lists the Geometry tool, uses the name Linear algebra, and describes the home screen; the package and page descriptions cover every tool.
- Graphing (2D and 3D) is restyled after Desmos: a white canvas with grey gridlines, a grey gutter beside the numbered expression rows, a coloured bar on the row being edited, an add bar that stays at the top of the list, and a vertical stack of view buttons (settings, zoom, reset, save) over the graph. The 3D preset menu moved to the lower left of the graph.
- Statistics: the layout is a data sheet on the left and the analysis on the right, with the chart and the numbers side by side when there is room, and underlined mode tabs.
- Linear algebra: the sheet and the picture now share the full width. The 780-pixel cap on the sheet left an empty band between them on wide screens.
- Symbolic algebra: each command is a card with its result in large type, the input is pinned under the session and grows with what you type, and the page uses the full height.
- Linear algebra: the page is restyled, and the picture of `A*x` shows only the two vectors until "Show grid and details" is ticked.
- Statistics: the mode tabs and options moved above the results.
- The file format is version 7 (adds the `probability` and `finance` tools). Older files open unchanged.
- Notebook and Geometry tabs open empty instead of with example content.
- The two-stars orbit example now animates while it runs.

### Fixed

- The CI and Pages workflows only ran for pushes to `main`, but the default branch is `master`, so neither ran. They now run for both.
- Linear algebra: the picture canvas covered the inputs, so nothing could be typed.
- LaTeX: a failed engine download now says how to fix it.

- A Cellular automata tab: grids that evolve by a rule written in Python, with any number of colours. Click cells to paint, then play, pause, step, or step back. Presets include Conway's Game of Life, a glider gun, a forest fire, Wireworld, Brian's Brain, and a cyclic rock-paper-scissors rule.
- A Fractals tab: the Mandelbrot and Julia sets, the Burning Ship, the tricorn, and a Newton fractal, with pan, zoom, palettes, and a way to pick a Julia set from the Mandelbrot set.
- A LaTeX tab: several files and pictures per project, source on the left and the compiled PDF on the right. TeX Live runs in WebAssembly (vendored Siglum engine) inside a sandboxed frame and downloads packages on demand.
- A Symbolic algebra tab with a built-in engine that reads Maxima syntax: expand, diff, integrate, solve up to degree 2, subst, ev, factor for whole numbers, float, function definitions, and earlier results. It is not the full Maxima program.
- Notebook cells for Python and Python canvas. Variables and functions defined in one Python cell are visible in the others until the session is restarted.
- Python turtle presets: Monty Hall, pairs of dice, and two stars in orbit.
- Linear algebra: `eig`, `eigenvalues`, and `eigenvectors`, exact for rational matrices. Click any line to see it drawn: vectors (drag the tip to edit), what a 2 by 2 or 3 by 3 matrix does, and `A*x` as x turned and scaled by A.

### Changed

- The Matrices tab is now called Linear algebra. Saved files are unaffected.
- The notebook offers Python cells instead of embedding the Python tool. Existing embedded Python tools keep working.
- Clover is now released under the GNU General Public License, version 2, the same license as Maxima. Earlier releases were published under the MIT license.
- The file format is version 5.

### Fixed

- On the Statistics tab, the chart no longer covers part of the control panel.

- A Statistics tab: data columns (paste from a spreadsheet), summaries with histogram, box plot, and dot plot, regression (linear, quadratic, cubic, exponential, power, logarithmic) with R² and residuals, probability distributions with shaded probabilities and inverse values, and t, z, proportion, and chi-square tests.
- Tables in the Graphing and 3D tools: typed columns define lists, computed columns fill themselves, spreadsheet paste, and per-column dots, lines, and colour.
- Folders that collapse, hide, and group rows; rows can be moved with Alt+Arrow or the options menu.
- Per-row style: line style, width, opacity, point shape and size, and fill opacity.
- Regression rows written with `~`, such as `y_1 ~ a x_1 + b`.
- `count`, `var`, `varp`, `quantile`, `quartile`, `mad`, `cov`, `covp`, `corr`, `spearman`, multi-value `gcd` and `lcm`, and Desmos-style distributions such as `normaldist(0, 1).cdf(1.96)`.
- docs/desmos-parity.md compares Clover with Desmos's documented features.
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

- Typing `sum`, `prod`, or `int` now inserts every box (index, limits, body) and the arrow keys visit all of them in reading order; Up and Down move between stacked boxes. Previously the boxes could not be reached until the commas were typed by hand. Typing the old `sum(k, 1, 10, k^2)` form still works.
- File format version 4. Older files open unchanged.
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
