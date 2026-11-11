# Clover file format

Files use the `.clover` extension and are UTF-8 JSON. Importers accept `.clover` and `.json`.

## Workspace

```json
{
  "format": "clover",
  "version": 3,
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
  "version": 3,
  "kind": "tab",
  "exportedAt": "2026-01-01T12:00:00.000Z",
  "tab": { "type": "vector", "title": "Saddle", "state": { "p": "x", "q": "-y" } }
}
```

## Tool state

| `type`     | State                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| `graph`    | `rows`, `view`, `grid`, `minor`, `numbers`, `angle`                    |
| `matrix`   | `lines`: matrices (`name`, `cells`) and calculations (`text`)          |
| `complex`  | `expr`, `mode`, `quality`, `grid`, `view`                              |
| `vector`   | `p`, `q`, `arrows`, `heat`, `flow`, `grid`, `density`, `seeds`, `view` |
| `python`   | `code`                                                                 |
| `graph3d`  | `rows`, `camera`, `bounds`, `grid`, `numbers`, `wire`, `angle`         |
| `notebook` | `cells` (`text`, `math`, `graph`, or `embed`), `angle`                 |
| `geometry` | `rows` (`id`, `text`), `snap`, `view`                                  |

`view` is `{ cx, cy, radius }`: the centre and half the shorter canvas side in world units. The `graph` tool uses `{ cx, cy, xspan, yspan }` instead, because its axes scale independently: the units across the width and height, with a `yspan` of 0 meaning "square".

### Graph rows

Each entry of `rows` is `{ id, kind, text, color, hidden, min, max, step, tmin, tmax }`. `kind` is `expr` or `note`; `text` is at most 500 characters; `color` indexes the six-colour palette; `min`, `max`, and `step` set a slider's range; `tmin` and `tmax` set the parameter range of a parametric or polar row. There are at most 60 rows. A slider's current value lives in its row's text (`a = 1.5`). The syntax is described in [graphing.md](graphing.md).

### Matrix lines

`lines` holds up to 40 entries. A matrix line is `{ id, kind: "matrix", name, cells }`, where `cells` is rows of entry text (at most 10 by 10, 24 characters each). A calculation is `{ id, kind: "expr", text }`. Lines are evaluated in order, and later lines can use earlier names. Files from before version 3, which stored `mode`, `m`, `n`, `p`, `A`, `B`, and `x`, are converted to the equivalent lines.

### Notebook embeds

An `embed` cell is `{ id, type: "embed", tool, height, state }`. `tool` is any other tool type except `notebook`, `state` is that tool's own state and is normalized by it, and `height` is clamped to 220 to 1000 pixels. A notebook can hold at most 8 embeds.

### Geometry rows

Each row is `{ id, text }`, one line of the geometry language: a comment (`#`), a definition (`M = midpoint(A, B)`), or a claim (`collinear(A, B, C)`). Free points are written `(x, y)` with exact rationals, and dragging rewrites that text, so the text is the whole state. At most 60 rows of 300 characters. `snap` is `1`, `1/2`, `1/4`, or `1/10`.

## Versions

| Version | Change                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1       | First release. The `desmos` tool saved `product` and `graphId` for an embedded calculator.                             |
| 2       | `graph` replaces `desmos`. Version 1 `desmos` tabs are migrated to an empty graph, with a note holding the saved link. |
| 3       | `matrix` holds named lines (older state is converted). `embed` notebook cells and the `geometry` tool are added.       |

## Import rules

- Maximum size 8 MB; at most 24 tabs; titles are trimmed to 60 characters.
- Unknown tool types are skipped. Each tool's `normalize` replaces invalid state with defaults.
- Files with a `version` newer than the app supports are refused.
- Internal tab ids are never written; new ids are generated on import.
