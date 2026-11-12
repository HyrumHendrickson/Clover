# Embedding Clover

Clover can be shown inside another page, either whole or as a single tool.

## The quick way

Open Clover, choose **Export, Embed on a website**, pick the whole workspace or the current tool, and copy the code.

```html
<iframe
  src="https://hyrumhendrickson.github.io/Clover/?embed=1&tool=matrix"
  title="Clover: Linear algebra"
  width="100%"
  height="600"
  style="border: 0"
  loading="lazy"
  allow="clipboard-write; fullscreen"
  sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms"
></iframe>
```

Tool types: `graph`, `graph3d`, `notebook`, `matrix` (Linear algebra), `geometry`, `stats`, `complex`, `fractals`, `vector`, `automata`, `latex`, `maxima`, `python`, `programming`.

## Address options

| Option      | Effect                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `embed=1`   | Required. Shows Clover without the home screen branding and page chrome.                                 |
| `tool=TYPE` | Shows only that tool: no tab strip, no launcher.                                                         |
| `tools=A,B` | Shows the whole workspace but offers only those tools.                                                   |
| `theme=`    | `light` or `dark`. The default follows the visitor's system setting.                                     |
| `persist=1` | Remembers the visitor's work in their browser. Without it, nothing is saved.                             |
| `id=NAME`   | Names the remembered work (letters, digits, `_`, `-`), so two embeds of one tool on a page do not share. |

An embedded frame never reads or writes the full site's workspace. Persisted work uses its own storage key, `clover:embed:v1:<id or tool>`.

## The script

```html
<script src="https://hyrumhendrickson.github.io/Clover/embed.js" async></script>
<clover-embed tool="stats" height="520" theme="light" file="lesson3.clover"></clover-embed>
```

Attributes: `tool`, `tools`, `theme`, `height`, `width`, `file`, `persist`, `id`, `src`, `title`. `file` is the address of a `.clover` file on your site (made with **Export this tab**); it is opened when the embed starts. `src` points at Clover if it is not where `embed.js` came from. Where custom elements are stripped, use `<div data-clover data-tool="stats"></div>`.

From script:

```js
const handle = Clover.embed(document.getElementById('box'), { tool: 'matrix', height: 480 });
await handle.ready; // { tools: [...] }
handle.load(fileTextOrObject); // open a .clover file
handle.setTheme('dark');
handle.open('graph'); // not available when one tool is shown
const text = await handle.exportText(); // current work as .clover text
```

Elements also fire `clover-ready` and `clover-loaded` events.

## Messages

`embed.js` is a thin layer over `postMessage`, if you prefer to talk to the frame directly. To the frame: `{ type: 'clover:load', text }`, `{ type: 'clover:theme', theme }`, `{ type: 'clover:open', tool }`, `{ type: 'clover:export' }`. From the frame: `{ type: 'clover:ready', tools }`, `{ type: 'clover:loaded', ok, message? }`, `{ type: 'clover:export', text }`. The frame ignores messages that do not come from its parent, and checks file text exactly as Import does.

## Notes

- Give the frame a height. Clover's tools fill their frame, so the frame does not resize itself.
- Run in the Programming tab sends code to a remote service; tell your visitors if that matters (see [programming.md](programming.md)).
- GitHub Pages cannot send `frame-ancestors`, so any site can embed Clover. If you host it yourself and want to restrict that, send `Content-Security-Policy: frame-ancestors ...`.
- Serve `embed.js` and Clover from the same place, or set `src`.
