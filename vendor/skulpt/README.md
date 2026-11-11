# Skulpt (vendored)

[Skulpt](https://github.com/skulpt/skulpt) compiles Python to JavaScript in the
browser. Clover uses it to run the Python and turtle tab, inside a sandboxed
iframe (see `runner/`).

| Item     | Value                                                              |
| -------- | ------------------------------------------------------------------ |
| Version  | 1.2.0 (npm package `skulpt`)                                       |
| License  | MIT (see `LICENSE`)                                                |
| Source   | https://github.com/skulpt/skulpt                                   |

## Integrity

These files are unmodified copies of `dist/skulpt.min.js` and
`dist/skulpt-stdlib.js` from the `skulpt@1.2.0` npm tarball.

```text
1a319d8eedf314dba5af2444313e3cf2ac072a335df0f5100277e8f49b64eae9  skulpt.min.js
e3ecccbc17c6164d19ed3c5561aaaeb752c38c8efa2d88b62b5fb7a7e1b086a7  skulpt-stdlib.js
```

Verify with `sha256sum -c` from this directory after saving the lines above to a
file, or run `npm run verify:vendor` from the repository root.

## Updating

1. `npm pack skulpt@<version>` and extract `package/dist/`.
2. Replace the two files here and update the version and checksums above and in
   `scripts/verify-vendor.mjs`.
3. Run `npm test` and exercise the Python tab manually.
