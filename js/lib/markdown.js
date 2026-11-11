/**
 * A small, safe Markdown subset for notebook text cells.
 *
 * Supported: `#`, `##`, `###` headings; `-`, `*`, and `1.` lists; paragraphs;
 * `**bold**`, `*italic*` or `_italic_`, `` `code` ``, and `$math$`, which is
 * typeset like a graph row. There are no links, images, or raw HTML. Output is
 * built with `h()`, so text is always inserted as text.
 */
import { h } from '../core/dom.js';
import { typeset } from './graph/typeset.js';

export const MAX_MARKDOWN = 4000;

const INLINE =
  /\*\*([^*]+)\*\*|`([^`]+)`|\$([^$]+)\$|\*([^*\s][^*]*)\*|(?<![A-Za-z0-9])_([^_\s][^_]*)_(?![A-Za-z0-9])/g;

/** Inline spans of one line as nodes. */
export function renderInline(text) {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const [, bold, code, math, em1, em2] = match;
    if (bold !== undefined) out.push(h('strong', {}, bold));
    else if (code !== undefined) out.push(h('code', {}, code));
    else if (math !== undefined) out.push(h('span', { class: 'nb-math-inline' }, typeset(math)));
    else out.push(h('em', {}, em1 ?? em2));
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Block structure of `source` as a list of `{ kind, ... }` records (exported for tests). */
export function parseBlocks(source) {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of String(source).slice(0, MAX_MARKDOWN).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: `h${heading[1].length}`, text: heading[2] });
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { kind: 'list', ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)[1]);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Render Markdown text as a `div.md`. */
export function renderMarkdown(source) {
  const root = h('div', { class: 'md' });
  for (const block of parseBlocks(source)) {
    if (block.kind === 'list') {
      root.append(
        h(
          block.ordered ? 'ol' : 'ul',
          {},
          block.items.map((item) => h('li', {}, ...renderInline(item))),
        ),
      );
    } else {
      root.append(h(block.kind === 'p' ? 'p' : block.kind, {}, ...renderInline(block.text)));
    }
  }
  return root;
}
