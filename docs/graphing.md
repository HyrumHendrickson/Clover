# Graphing syntax

Type into a row; the graph updates as you go. Enter adds a row, and Backspace on an empty row removes it. Syntax follows Desmos conventions where practical, but input is plain text rather than a typeset editor.

## What a row can be

| Type                | Example                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| Function            | `y = x^2`, `x^2`, `f(x) = sin(x)`                                                      |
| x in terms of y     | `x = y^2`                                                                              |
| Implicit equation   | `x^2 + y^2 = 25`, `y^2 = x^3 - 3x + 2`                                                 |
| Inequality          | `y > x^2`, `0 < y < x`; strict ones have dashed edges                                  |
| Polar               | `r = 1 + cos(theta)` (default 0 to 12π)                                                |
| Parametric          | `(cos(t), sin(t))` (default 0 to 1; set limits below the row or use `{0 <= t <= 2pi}`) |
| Point or point list | `(2, 3)`, `[(1, 2), (3, 4)]`, `(L, L^2)`                                               |
| Slider              | `a = 1`, then use `a` anywhere                                                         |
| Value               | `2 + 3`, `total([1...10])` show their result                                           |

An undefined letter in a row offers an **Add slider** button.

## Writing expressions

- Multiplication can be implied: `2x`, `xy`, `x(x+1)`, `2sin(x)`. A run of letters is split into single letters, so `xy` is x times y. Variable names are one letter with an optional subscript: `a`, `x_1`.
- Powers: `x^2`, `sin^2(x)`. Roots: `sqrt(x)`, `nthroot(3, x)`; odd roots of negatives are real. Absolute value: `abs(x)` or `|x|`.
- Constants: `pi`, `tau`, `e`. `log` is base 10, `ln` is natural, `log_2(x)` is base 2.
- Trigonometric, inverse (`arcsin`, `asin`), and hyperbolic functions are available. Angles are in radians unless you choose degrees in the graph settings; `30°` converts to radians.
- Restrictions: `y = x {0 < x < 5}`. Piecewise values: `y = {x < 0: -x, x}`.
- Functions: `f(x) = x^2`, `g(x, y) = x + y`, then `f(3)`. `f'(x)` and `f''(x)` are numeric derivatives, and so is `d/dx x^3` (it differentiates the next term; use brackets for more, like `d/dx (x^2 + x)`).
- `sum(k, 1, 10, k^2)`, `prod(k, 1, 5, k)`, `int(t, 0, x, sin(t))`.
- Also: `mod`, `gcd`, `lcm`, `nCr`, `nPr`, `floor`, `ceil`, `round`, `sign`, `x!`.

## Typeset display and typing aids

Rows show as typeset math when you are not editing them: powers rise, `/` stacks into a fraction, roots get a radical, and `sum`, `prod`, and `int` become big operators with limits. While you edit, a live typeset preview sits under the text. Typing a complete Greek name (`theta`, `pi`, `tau`, `alpha`, `beta`, `gamma`, `delta`, `epsilon`, `lambda`, `phi`, `sigma`, `omega`) turns it into the letter. Greek letters can be used as variable names.

## Lists in definitions

A list inside a function or equation draws one curve per item: `f(x) = [1, 2, 3]x` draws three lines, and `y = [1...n]x` follows the slider `n`. This works for `y =`, `x =`, polar rows, and function definitions, up to 50 curves per row.

## Lists and points

`[1, 2, 3]`, `[1...10]`, `[1, 3...11]`. Index from one: `L[2]`, `L[1, 3]`, `L[2...4]`, `L[3...]`. Comprehensions: `[i^2 for i = [1...5]]`. Arithmetic and functions apply to every element; two lists must be the same length. Lists hold at most 10,000 items.

List functions: `total`, `length`, `mean`, `median`, `stdev` (sample), `stdevp` (population), `min`, `max`, `sort`, `unique`, `join`. Points: `(1, 2) + (3, 4)`, `2(1, 2)`, `P.x`, `P.y`, `distance(P, Q)`, `midpoint(P, Q)`.

## On the graph

- Drag to pan; scroll or pinch to zoom; arrow keys pan; `+` and `-` zoom; `0` resets.
- Drag along the axis numbers to stretch one axis. Use the settings panel to set an exact window.
- Click a curve to select it. For `y = f(x)` curves, intercepts, turning points, and intersections with other functions appear; hover or click a dot for its coordinates.
- The colour dot hides or shows a row. **Save image** exports a PNG.

## Tables

**Add table** puts a table in the list. Its column headings are names: `x_1` and `y_1` are columns you type values into, and each becomes a list other rows can use (`mean(y_1)`, `(x_1, y_1 + 1)`). A heading that is an expression, such as `x_1^2` or `sin(x_1)`, computes that column from the others, and its cells are read-only. Every column after the first is plotted against the first; **Dots**, **Line**, colour, and show or hide are set per column. A row that is missing a value in a typed column is ignored.

Arrow keys and Enter move between cells (Enter in the last row adds one). Paste tab- or comma-separated text from a spreadsheet into a cell to fill the table, up to 8 columns and 500 rows. Leave a column's cells empty and give it the name of a list defined elsewhere to use that list in the table.

## Regression

Write `~` instead of `=`: `y_1 ~ a x_1 + b`. The left side is a list of data; the right side is a model. Letters that are not defined elsewhere (`a` and `b`) are what the fit solves for, by least squares, and they become values other rows can use. The row shows each value and R². When the model contains one data list, the fitted curve is drawn with that list standing for x. Examples: `y_1 ~ a x_1^2 + b x_1 + c`, `y_1 ~ a e^(b x_1)`. Nonlinear models are solved numerically from several starting guesses, so rewrite a model in linear form when you can.

## Folders and styling

**Add folder** adds a row you can collapse. Choose a folder in a row's options menu (the gear) to put it inside; the dot on a folder shows or hides everything in it, and deleting a folder keeps its rows. The same menu moves a row up or down (Alt+Up and Alt+Down do too) and sets line style (solid, dashed, dotted), width, opacity, point shape and size, and fill opacity for regions.

## Statistics in rows

`count`, `var` (sample), `varp`, `quantile(L, p)` (p from 0 to 1), `quartile(L, q)` (q from 0 to 4), `mad`, `cov`, `covp`, `corr`, and `spearman`, in addition to the list functions above. Quantiles use linear interpolation between sorted values. `gcd` and `lcm` take any number of values.

Distributions follow Desmos: `normaldist(0, 1)`, `tdist(10)`, `chisqdist(4)`, `uniformdist(0, 1)`, `binomialdist(10, 0.3)`, `poissondist(5)`, `geodist(0.3)`. A continuous one alone graphs its density. Add `.pdf(x)`, `.cdf(x)`, `.cdf(a, b)` (the probability between a and b), or `.inversecdf(p)`; each accepts a list. Discrete ones need a method, like `binomialdist(10, 0.3).pdf([0...10])`. The Statistics tab covers data summaries, charts, regression, and significance tests.

## Not supported

Images, actions, `with` substitution, `and` and `or` in restrictions, draggable points, polar inequalities, symbolic derivatives, random numbers, and custom colours. Three-coordinate points belong to the 3D graph; see below. [desmos-parity.md](desmos-parity.md) lists every Desmos feature this was compared against.

## 3D graph

The 3D tab uses the same language. Variables are `x`, `y`, `z`; `t`, `u`, `v` are parameters.

| Type               | Example                                         |
| ------------------ | ----------------------------------------------- |
| Surface            | `z = sin(x)cos(y)`, `x^2 - y^2`, `f(x, y) = xy` |
| Implicit surface   | `x^2 + y^2 + z^2 = 9`, `x = 2`                  |
| Space curve        | `(cos(t), sin(t), t/4) {0 <= t <= 12}`          |
| Parametric surface | `(u cos(v), u sin(v), u) {0 <= u <= 3}`         |
| Points             | `(1, 2, 3)`, `[(0, 0, 0), (1, 1, 1)]`           |

Parameter limits default to 0 to 2π and come from a restriction or the boxes under the row. Lists of surfaces (`z = [1, 2, 3]x`) draw up to 12 sheets. Inequalities are not supported in 3D. Folders and tables work as in the Graphing tool, except that a table only defines lists: plot them with a row like `(x_1, y_1, z_1)`. Drag to orbit, shift-drag or right-drag to pan, scroll or pinch to zoom; arrow keys orbit, `+`/`-` zoom, `0` resets.

## Notebook

The notebook tab is a column of text, math, and graph cells, and any other tool can be embedded in a cell with **Embed a tool**; embedded tools keep their own state and do not share definitions. Definitions and sliders are shared by every cell. Text cells accept `#` headings, lists, `**bold**`, `*italic*`, `` `code` ``, and `$math$`.

## Typing math

Math fields show typeset math as you type. `^` opens an exponent, `/` a fraction, and brackets close themselves. Typing `sum`, `prod`, or `int` produces ∑, ∏, or ∫ with every box ready to fill: the caret starts in the first one, and the arrow keys visit all of them in reading order. A sum or product goes index variable, start, end, then body. An integral goes lower limit, upper limit, body, then the variable of integration. Up and Down move between stacked boxes, such as the two limits or a numerator and denominator. Tab and a typed comma also move to the next box and then out of the operator. The text underneath is still `∑(k, 1, 10, k^2)`, so typing it out that way works as well. To add up a list, write `total(L)`, since a typed ∑(L) is drawn as an operator with L as its index.

## Statistics tab

The Statistics tab holds up to four columns of data (paste from a spreadsheet to fill them) and four views. **Summary** gives count, mean, median, mode, standard deviations, quartiles, outliers, and a histogram, box plot, or dot plot. **Regression** fits linear, quadratic, cubic, exponential, power, or logarithmic models, shows parameters with standard errors where they exist, R², and an optional residual plot, and copies the equation in Graphing syntax. **Distributions** shades the probability between two values and gives the mean, standard deviation, and inverse values. **Tests** runs one- and two-sample t-tests, z-tests, proportion tests, and chi-square tests with p-values and confidence intervals.

## Geometry

The Geometry tab takes one definition or claim per line, such as `M = midpoint(A, B)` or `collinear(A, B, C)`. The Help panel in the tab lists every construction. Constructions that need square roots (angle bisectors, the incenter, a general line-circle intersection) are not offered; `second(l, c, Q)` gives the other intersection when one is known. See [the engine notes](../js/lib/geometry/engine.js) for how claims are decided.
