# Security policy

## Supported versions

Only the latest release on `main` is supported.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue. Include steps to reproduce and, where possible, a sample `.clover` file. You can expect an acknowledgement within a few days.

## Threat model

Clover runs entirely in the browser with no backend. The main risk is a malicious `.clover` file shared with a user.

| Concern                          | Mitigation                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Script injection from a file     | All text is inserted with DOM text APIs; there is no `innerHTML`. Imported state passes through schema validation and per-tool `normalize`.                       |
| Prototype pollution              | Imported JSON is deep-copied with `__proto__`, `constructor`, and `prototype` keys removed, with depth and size limits.                                           |
| Malicious Python in a file       | Code never runs on import. It runs only when the user presses Run, in an iframe with `sandbox="allow-scripts"` (opaque origin) and a CSP of `connect-src 'none'`. |
| Access to saved data from Python | The sandboxed frame cannot read `localStorage` or the parent DOM. Messages from it are accepted only from that frame and are shape-checked.                       |
| Expression evaluation            | Math expressions are parsed and interpreted by closures. `eval` and `Function` are not used, so the main page CSP omits `unsafe-eval`.                            |
| Untrusted embedded links         | The Desmos tab accepts only `https://desmos.com` or `https://www.desmos.com` calculator URLs and keeps only the product and graph id.                             |
| Supply chain                     | Skulpt is vendored with recorded SHA-256 checksums (`npm run verify:vendor`). Dev dependencies are monitored by Dependabot.                                       |

## Known limits

- The runner page needs `unsafe-eval` because Skulpt compiles Python to JavaScript. It is isolated for that reason.
- The Desmos frame uses `allow-scripts allow-same-origin` so Desmos can keep its own storage. It is cross-origin from Clover, and top-level navigation is not allowed. Browsers log a generic warning for this flag combination.
- GitHub Pages cannot set HTTP headers, so the CSP is delivered by `<meta>` tags and `frame-ancestors` cannot be enforced.
