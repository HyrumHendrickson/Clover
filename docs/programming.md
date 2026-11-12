# Programming tab

The tab runs Python, Rust, C, C++, and Java. Each language keeps its own program, and a text box supplies standard input.

## How it runs

Browsers cannot compile Rust, C, C++, or Java without large downloads, so the tab sends the program to a [Judge0](https://github.com/judge0/judge0) service when a person presses Run.

- The request is made from `runner/code.html`, a sandboxed frame (`sandbox="allow-scripts"`, opaque origin) with its own CSP. The main page still has `connect-src 'self'`.
- The frame reads the service's `/languages` list and picks the newest GCC (C, C++), OpenJDK (Java), CPython 3 (Python), and Rust it offers, so nothing depends on fixed language ids.
- It submits with `base64_encoded=true`, then polls for the result. It does not use `wait=true`, which hosts may disable.
- Stop removes the frame, which cancels the pending requests.

## What leaves the browser

The program and its input, only when Run is pressed. They are not saved by Clover, but the service operator can see them.

## The default service

`DEFAULT_ENDPOINT` in `js/lib/codeapi.js` is `https://ce.judge0.com`, the public community instance. It needs no key, but it is shared and best effort; Judge0's own documentation says public instances are for small projects and testing. It can be slow, rate limited (HTTP 429), or offline. Language versions are whatever it runs. Check the Rust and Java versions if you depend on newer features (the Judge0 CE documentation lists Rust 1.40.0).

## Using your own service

1. Deploy Judge0 CE ([deployment guide](https://github.com/judge0/judge0/blob/master/CHANGELOG.md#deployment-procedure)).
2. Change `DEFAULT_ENDPOINT` in `js/lib/codeapi.js` to its https address (http is accepted only for `localhost`).
3. Make sure it sends `Access-Control-Allow-Origin` for a page with an opaque origin (`*`), and that it needs no `X-Auth-Token`. Keys are not supported, because anything in a static page is public.

The runner's CSP allows `https:` for `connect-src`, as the LaTeX runner does, so no CSP change is needed.

## Limits

Source up to 50,000 characters, input up to 10,000, output shown up to 50,000. CPU time, memory, and process limits are the service's defaults (Judge0 CE defaults to 2 seconds of CPU and 128 MB). Programs cannot use the network or read files you did not provide. Java programs must use the class name `Main`.
