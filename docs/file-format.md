# Clover file format

Files use the `.clover` extension and are UTF-8 JSON. Importers accept `.clover` and `.json`.

## Workspace

```json
{
  "format": "clover",
  "version": 1,
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
  "version": 1,
  "kind": "tab",
  "exportedAt": "2026-01-01T12:00:00.000Z",
  "tab": { "type": "vector", "title": "Saddle", "state": { "p": "x", "q": "-y" } }
}
```

## Tool state

| `type`    | State                                                                  |
| --------- | ---------------------------------------------------------------------- |
| `desmos`  | `product`, `graphId`                                                   |
| `matrix`  | `mode`, `m`, `n`, `p`, `A`, `B`, `x` (cell text), `view`               |
| `complex` | `expr`, `mode`, `quality`, `grid`, `view`                              |
| `vector`  | `p`, `q`, `arrows`, `heat`, `flow`, `grid`, `density`, `seeds`, `view` |
| `python`  | `code`                                                                 |

`view` is `{ cx, cy, radius }`: the centre and half the shorter canvas side in world units.

## Import rules

- Maximum size 8 MB; at most 24 tabs; titles are trimmed to 60 characters.
- Unknown tool types are skipped. Each tool's `normalize` replaces invalid state with defaults.
- Files with a `version` newer than the app supports are refused.
- Internal tab ids are never written; new ids are generated on import.
