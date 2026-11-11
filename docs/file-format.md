# Clover file format

Files use the `.clover` extension and are UTF-8 JSON. Importers accept `.clover` and `.json`.

## Workspace

```json
{
  "format": "clover",
  "version": 2,
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
  "version": 2,
  "kind": "tab",
  "exportedAt": "2026-01-01T12:00:00.000Z",
  "tab": { "type": "vector", "title": "Saddle", "state": { "p": "x", "q": "-y" } }
}
```

## Tool state

| `type`     | State                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| `graph`    | `rows`, `view`, `grid`, `minor`, `numbers`, `angle`                    |
| `matrix`   | `mode`, `m`, `n`, `p`, `A`, `B`, `x` (cell text), `view`               |
| `complex`  | `expr`, `mode`, `quality`, `grid`, `view`                              |
| `vector`   | `p`, `q`, `arrows`, `heat`, `flow`, `grid`, `density`, `seeds`, `view` |
| `python`   | `code`                                                                 |
| `graph3d`  | `rows`, `camera`, `bounds`, `grid`, `numbers`, `wire`, `angle`         |
| `notebook` | `cells` (`text`, `math`, or `graph`), `angle`                          |

`view` is `{ cx, cy, radius }`: the centre and half the shorter canvas side in world units. The `graph` tool uses `{ cx, cy, xspan, yspan }` instead, because its axes scale independently: the units across the width and height, with a `yspan` of 0 meaning "square".

### Graph rows

Each entry of `rows` is `{ id, kind, text, color, hidden, min, max, step, tmin, tmax }`. `kind` is `expr` or `note`; `text` is at most 500 characters; `color` indexes the six-colour palette; `min`, `max`, and `step` set a slider's range; `tmin` and `tmax` set the parameter range of a parametric or polar row. There are at most 60 rows. A slider's current value lives in its row's text (`a = 1.5`). The syntax is described in [graphing.md](graphing.md).

## Versions

| Version | Change                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1       | First release. The `desmos` tool saved `product` and `graphId` for an embedded calculator.                             |
| 2       | `graph` replaces `desmos`. Version 1 `desmos` tabs are migrated to an empty graph, with a note holding the saved link. |

## Import rules

- Maximum size 8 MB; at most 24 tabs; titles are trimmed to 60 characters.
- Unknown tool types are skipped. Each tool's `normalize` replaces invalid state with defaults.
- Files with a `version` newer than the app supports are refused.
- Internal tab ids are never written; new ids are generated on import.
