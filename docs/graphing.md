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

## Not supported

Tables, folders, images, regressions, draggable points, polar inequalities, and symbolic derivatives. Three-coordinate points belong to the 3D graph; see below.

## 3D graph

The 3D tab uses the same language. Variables are `x`, `y`, `z`; `t`, `u`, `v` are parameters.

| Type               | Example                                         |
| ------------------ | ----------------------------------------------- |
| Surface            | `z = sin(x)cos(y)`, `x^2 - y^2`, `f(x, y) = xy` |
| Implicit surface   | `x^2 + y^2 + z^2 = 9`, `x = 2`                  |
| Space curve        | `(cos(t), sin(t), t/4) {0 <= t <= 12}`          |
| Parametric surface | `(u cos(v), u sin(v), u) {0 <= u <= 3}`         |
| Points             | `(1, 2, 3)`, `[(0, 0, 0), (1, 1, 1)]`           |

Parameter limits default to 0 to 2π and come from a restriction or the boxes under the row. Lists of surfaces (`z = [1, 2, 3]x`) draw up to 12 sheets. Inequalities are not supported in 3D. Drag to orbit, shift-drag or right-drag to pan, scroll or pinch to zoom; arrow keys orbit, `+`/`-` zoom, `0` resets.

## Notebook

The notebook tab is a column of text, math, and graph cells, and any other tool can be embedded in a cell with **Embed a tool**; embedded tools keep their own state and do not share definitions. Definitions and sliders are shared by every cell. Text cells accept `#` headings, lists, `**bold**`, `*italic*`, `` `code` ``, and `$math$`.

## Typing math

Math fields show typeset math as you type. `^` opens an exponent, `/` a fraction, and brackets close themselves. Typing `sum`, `prod`, or `int` produces ∑, ∏, or ∫ with empty boxes for the limits. Write the arguments inside brackets as `∑(k, 1, 10, k^2)`, and press Tab to move from one argument to the next. To add up a list, write `total(L)`, since a typed ∑(L) is drawn as an operator with L as its index.

## Geometry

The Geometry tab takes one definition or claim per line, such as `M = midpoint(A, B)` or `collinear(A, B, C)`. The Help panel in the tab lists every construction. Constructions that need square roots (angle bisectors, the incenter, a general line-circle intersection) are not offered; `second(l, c, Q)` gives the other intersection when one is known. See [the engine notes](../js/lib/geometry/engine.js) for how claims are decided.
