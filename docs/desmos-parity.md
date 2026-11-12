# Clover and Desmos

What Clover has compared with what Desmos documents. This was built from Desmos's published help pages and API documentation: the Supported Functions list, Tables, Regressions, Statistics, Probability Distributions, Data Visualizations, the 3D User Guide, and the API reference. Clover is not affiliated with Desmos, and the comparison covers documented features, not every behaviour. "Partial" says what is missing.

## Rows and display

| Feature                                                           | Status                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Expressions, notes                                                | Yes                                                                                                   |
| Tables, computed columns, spreadsheet paste                       | Yes. Up to 8 columns and 500 rows (Desmos allows 10,000 pasted rows). No "create table from function" |
| Folders                                                           | Yes. Collapse, hide all, move in and out. No drag and drop; use the menu or Alt+Arrow                 |
| Images                                                            | Not yet                                                                                               |
| Line style, width, opacity                                        | Yes                                                                                                   |
| Point style, size, opacity; fill opacity                          | Yes                                                                                                   |
| Point and curve labels                                            | Not yet                                                                                               |
| Colours                                                           | Six-colour palette only; no custom colour functions (`rgb`, `hsv`, and others)                        |
| Sliders and animation, parametric and polar domains               | Yes                                                                                                   |
| Movable points, drag modes                                        | Not yet                                                                                               |
| Points of interest (intercepts, extrema, intersect)               | Yes, for functions of x                                                                               |
| Degrees or radians, grid, axis numbers, exact window              | Yes                                                                                                   |
| Polar grid, axis arrows and labels, log scales                    | Not yet                                                                                               |
| Reverse contrast, projector mode, languages, Braille, audio trace | Not yet (a light and a dark theme exist)                                                              |
| Screenshot                                                        | PNG only                                                                                              |
| Actions, `with` substitution, `and`/`or`, recursion, tone, random | Not yet                                                                                               |

## Functions

| Feature                                                                                                                        | Status                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Trigonometric, inverse, hyperbolic, logarithms, roots, `abs`, rounding                                                         | Yes                                                                                                                       |
| `sum`, `prod`, `int`, `d/dx`, `f'(x)`                                                                                          | Yes. Derivatives and integrals are numeric                                                                                |
| `gcd`, `lcm` (any number of values), `mod`, `nCr`, `nPr`                                                                       | Yes                                                                                                                       |
| `mean`, `median`, `min`, `max`, `stdev`, `stdevp`, `total`, `count`                                                            | Yes                                                                                                                       |
| `quantile`, `quartile`, `var`, `cov`, `covp`, `mad`, `corr`, `spearman`                                                        | Yes. Quantiles interpolate linearly; I could not find Desmos's convention documented, so values may differ at the margins |
| `stats`, `histogram`, `dotplot`, `boxplot` as functions                                                                        | Not as functions. The Statistics tab draws all three charts and the summary                                               |
| `sort`, `unique`, `join`, list comprehensions                                                                                  | Yes                                                                                                                       |
| `shuffle`, `repeat`, `random`                                                                                                  | Not yet                                                                                                                   |
| `normaldist`, `tdist`, `chisqdist`, `uniformdist`, `binomialdist`, `poissondist`, `geodist` with `.pdf`, `.cdf`, `.inversecdf` | Yes                                                                                                                       |
| `discretedist`, distribution `.random`                                                                                         | Not yet                                                                                                                   |
| `ztest`, `ttest`, `zproptest`, `chisqtest`, `chisqgof` and `.p`, `.score`, `.conf`                                             | Not as functions. The Statistics tab runs these tests and reports p-values and intervals                                  |

## Regression

| Feature                                                                         | Status                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Custom models with `~`, least squares, several start points                     | Yes                                                         |
| R², parameter values                                                            | Yes                                                         |
| Template models (linear through logarithmic), r, residuals                      | In the Statistics tab, with standard errors for linear fits |
| Residual plot, log mode, regressions with several independent variables plotted | Not in the Graphing tool                                    |

## 3D

| Feature                                                                | Status                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Surfaces, implicit surfaces, space curves, parametric surfaces, points | Yes                                                                        |
| Tables and folders                                                     | Yes. A table defines lists; plot them with `(x_1, y_1, z_1)`, as in Desmos |
| Perspective and orthographic, preset views, mesh lines, bounds         | Yes (perspective is a switch, not a slider)                                |
| Per-row style                                                          | Saved, but not yet used when drawing                                       |
| Translucent surfaces, lighting controls                                | Not yet                                                                    |
| Vectors, `segment`, `triangle`, `sphere`, conic sections               | Not yet                                                                    |
| Spherical coordinates (`rho`, `phi`)                                   | Not yet                                                                    |
| Inequalities in 3D                                                     | Not yet                                                                    |

## Typing

| Feature                                                        | Status                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Typeset math editor with fractions, exponents, roots           | Yes, over a plain-text source                                                          |
| Sum, product, and integral boxes reachable with the arrow keys | Yes: Left and Right in reading order, Up and Down between stacked boxes, Tab and comma |
| On-screen keypad                                               | Not yet                                                                                |

Sources: help.desmos.com (Supported Functions, Tables, Regressions, Statistics, Probability Distributions, Data Visualizations, Desmos 3D User Guide) and desmos.com/api.
