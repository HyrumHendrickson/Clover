# Clover file format

Files use the `.clover` extension and are UTF-8 JSON. Importers accept `.clover` and `.json`.

## Workspace

```json
{
  "format": "clover",
  "version": 6,
  "kind": "workspace",
  "exportedAt": "2026-01-01T12:00:00.000Z",
  "workspace": {
    "activeIndex": 0,
    "tabs": [{ "type": "complex", "title": "Roots of unity", "state": { "expr": "z^3 - 1" } }]
  }
}
```

## Single tab

```json
{
  "format": "clover",
  "version": 6,
  "kind": "tab",
  "exportedAt": "2026-01-01T12:00:00.000Z",
  "tab": { "type": "vector", "title": "Saddle", "state": { "p": "x", "q": "-y" } }
}
```

## Tool state

| `type`        | State                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------- |
| `graph`       | `rows`, `view`, `grid`, `minor`, `numbers`, `angle`                                       |
| `matrix`      | `lines`: matrices (`name`, `cells`) and calculations (`text`). Shown as "Linear algebra". |
| `complex`     | `expr`, `mode`, `quality`, `grid`, `view`                                                 |
| `vector`      | `p`, `q`, `arrows`, `heat`, `flow`, `grid`, `density`, `seeds`, `view`                    |
| `python`      | `code`                                                                                    |
| `graph3d`     | `rows`, `camera`, `bounds`, `grid`, `numbers`, `wire`, `angle`                            |
| `notebook`    | `cells` (`text`, `math`, `graph`, `embed`, `code`, or `pycanvas`), `angle`                |
| `geometry`    | `rows` (`id`, `text`), `snap`, `view`                                                     |
| `stats`       | `cols`, `mode`, `describe`, `regress`, `dist`, `tests`                                    |
| `fractals`    | `kind`, `view`, `iterations`, `palette`, `power`, `cRe`, `cIm`                            |
| `automata`    | `code` (a Python rule), `width`, `height`, `cells` (one hex digit per cell), `speed`      |
| `latex`       | `files` (`path` with `text`, or `data` as base64), `main`, `active`, `engine`, `auto`     |
| `maxima`      | `inputs`: the commands of the session, replayed when the tab opens                        |
| `probability` | `mode`, `counting`, `events`, `bayes`, `trials`, `variable`                               |
| `finance`     | `mode`, `compound`, `goal`, `loan`, `tvm`, `flows`                                        |

`view` is `{ cx, cy, radius }`: the centre and half the shorter canvas side in world units. The `graph` tool uses `{ cx, cy, xspan, yspan }` instead, because its axes scale independently: the units across the width and height, with a `yspan` of 0 meaning "square".

### Graph rows

Each entry of `rows` has an `id`, a `kind`, and an optional `folder` (the `id` of a `folder` row in the same list; folders do not nest, and a folder's rows follow it).

- `expr` and `note`: `{ id, kind, text, color, hidden, min, max, step, tmin, tmax, folder, style }`. `text` is at most 500 characters; `color` indexes the six-colour palette; `min`, `max`, and `step` set a slider's range; `tmin` and `tmax` set the parameter range of a parametric or polar row. A slider's current value lives in its row's text (`a = 1.5`). A regression is an `expr` row whose text contains `~`.
- `folder`: `{ id, kind: "folder", text, collapsed, hidden }`. `text` is the title (at most 80 characters). Hiding a folder hides everything in it.
- `table`: `{ id, kind: "table", folder, hidden, style, cols }`. Each column is `{ head, cells, color, hidden, points, lines }`. A `head` that is one variable name (`x_1`) names a list built from the typed `cells`; any other `head` is an expression computed from the other columns. Every column has the same number of `cells`, each at most 40 characters, in at most 8 columns and 500 rows. Only rows where every typed column has a value are used. The 3D graph and the notebook ignore plotting flags.
- `style` holds only what differs from the defaults: `line` (`solid`, `dashed`, `dotted`), `width` (0.5 to 20), `opacity` (0 to 1), `point` (`point`, `open`, `cross`, `square`, `plus`, `triangle`, `diamond`, `star`), `size` (2 to 40), and `fill` (0 to 1). The 3D graph keeps style but does not draw with it yet.

There are at most 60 rows. The syntax is described in [graphing.md](graphing.md). The notebook drops `folder` and `table` rows from its graph cells.

### Stats

`cols` holds 2 to 4 columns of `{ name, cells }` (up to 500 cells of 24 characters each; cells are text and may be any expression that evaluates to a number). `mode` is `describe`, `regress`, `dist`, or `tests`. The other four objects keep each mode's choices (column picks, chart, model, distribution and its parameters, test and its inputs). Every value is validated on load.

### Matrix lines

`lines` holds up to 40 entries. A matrix line is `{ id, kind: "matrix", name, cells }`, where `cells` is rows of entry text (at most 10 by 10, 24 characters each). A calculation is `{ id, kind: "expr", text }`. Lines are evaluated in order, and later lines can use earlier names. Files from before version 3, which stored `mode`, `m`, `n`, `p`, `A`, `B`, and `x`, are converted to the equivalent lines.

### Programming

`{ language, sources, stdin }`. `language` is `python`, `rust`, `c`, `cpp`, or `java`. `sources` holds one program per language (up to 50,000 characters each; a missing one is replaced by the example), and `stdin` is the text given to the program (up to 10,000 characters). Output is never saved. Code in an imported file is sent to the run service only when a person presses Run. See [programming.md](programming.md).

### Notebook embeds

An `embed` cell is `{ id, type: "embed", tool, height, state }`. `tool` is any other tool type except `notebook`, `state` is that tool's own state and is normalized by it, and `height` is clamped to 220 to 1000 pixels. A notebook can hold at most 8 embeds.

### Geometry rows

Each row is `{ id, text }`, one line of the geometry language: a comment (`#`), a definition (`M = midpoint(A, B)`), or a claim (`collinear(A, B, C)`). Free points are written `(x, y)` with exact rationals, and dragging rewrites that text, so the text is the whole state. At most 60 rows of 300 characters. `snap` is `1`, `1/2`, `1/4`, or `1/10`.

## Versions

| Version | Change                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | First release. The `desmos` tool saved `product` and `graphId` for an embedded calculator.                                                 |
| 2       | `graph` replaces `desmos`. Version 1 `desmos` tabs are migrated to an empty graph, with a note holding the saved link.                     |
| 3       | `matrix` holds named lines (older state is converted). `embed` notebook cells and the `geometry` tool are added.                           |
| 4       | Graph rows gain `folder` and `style`, and `folder` and `table` rows are added. The `stats` tool is added. Older files open unchanged.      |
| 5       | The `fractals`, `automata`, `latex`, and `maxima` tools are added. Notebooks gain `code` and `pycanvas` cells. Older files open unchanged. |
| 6       | The `programming` tool is added. Older files open unchanged.                                                                               |
| 7       | The `probability` and `finance` tools are added. Older files open unchanged.                                                               |

Notebook `code` and `pycanvas` cells are `{ id, type, code }`. Their output is never saved. Python code in an imported file runs only when a person presses Run, Play, Step, or Compile.

## Import rules

- Maximum size 8 MB; at most 24 tabs; titles are trimmed to 60 characters.
- Unknown tool types are skipped. Each tool's `normalize` replaces invalid state with defaults.
- Files with a `version` newer than the app supports are refused.
- Internal tab ids are never written; new ids are generated on import.
