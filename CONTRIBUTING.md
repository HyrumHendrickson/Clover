# Contributing

Thanks for helping improve Clover.

## Getting started

1. Fork and clone the repository.
2. Install Node 22 or later, then run `npm install`.
3. Start the dev server with `npm start`.

## Before opening a pull request

- Run `npm run check`. It must pass.
- Add or update tests for behaviour you change. Parser, import, and security changes need tests.
- Keep pull requests focused. One change per PR is easier to review.
- Update `CHANGELOG.md` under **Unreleased**.
- For UI changes, include a screenshot in the PR and check both themes and keyboard use.

Read [AGENTS.md](AGENTS.md) for the architecture rules, especially the security constraints.

## Commit messages

Use a short imperative summary, for example `Add Hilbert curve preset`. Explain the reason in the body when it is not obvious.

## Reporting bugs and requesting features

Use the issue templates. For security issues, follow [SECURITY.md](SECURITY.md) instead.

By contributing you agree that your work is released under the [MIT License](LICENSE).
