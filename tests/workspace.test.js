import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ImportError,
  MAX_TABS,
  exportTab,
  exportWorkspace,
  normalizeWorkspace,
  parseImport,
  sanitizeJson,
  uniqueTitle,
} from '../js/core/workspace.js';

const tools = {
  note: {
    type: 'note',
    name: 'Note',
    normalize: (raw) => ({ text: typeof raw.text === 'string' ? raw.text : '' }),
  },
  graph: {
    type: 'graph',
    name: 'Graph',
    normalize: (raw) => ({ n: Number.isFinite(raw.n) ? raw.n : 0 }),
  },
};

let n = 0;
const newId = () => `t${(n += 1)}`;

test('export then import round-trips a workspace', () => {
  const ws = {
    activeId: 'b',
    tabs: [
      { id: 'a', type: 'note', title: 'First', state: { text: 'hello' } },
      { id: 'b', type: 'graph', title: 'Second', state: { n: 4 } },
    ],
  };
  const text = JSON.stringify(exportWorkspace(ws));
  const result = parseImport(text, tools, newId);
  assert.equal(result.kind, 'workspace');
  assert.equal(result.tabs.length, 2);
  assert.equal(result.activeIndex, 1);
  assert.deepEqual(
    result.tabs.map((t) => [t.type, t.title, t.state]),
    [
      ['note', 'First', { text: 'hello' }],
      ['graph', 'Second', { n: 4 }],
    ],
  );
  assert.notEqual(result.tabs[0].id, 'a');
});

test('export then import round-trips a single tab', () => {
  const tab = { id: 'a', type: 'note', title: 'Solo', state: { text: 'x' } };
  const result = parseImport(JSON.stringify(exportTab(tab)), tools, newId);
  assert.equal(result.kind, 'tab');
  assert.equal(result.tab.title, 'Solo');
});

test('exported files carry no internal ids', () => {
  const ws = { activeId: 'a', tabs: [{ id: 'a', type: 'note', title: 'T', state: {} }] };
  assert.ok(!JSON.stringify(exportWorkspace(ws)).includes('"id"'));
});

test('rejects malformed, foreign, and future files with clear messages', () => {
  assert.throws(() => parseImport('', tools, newId), ImportError);
  assert.throws(() => parseImport('not json', tools, newId), /not valid JSON/);
  assert.throws(() => parseImport('{"format":"other"}', tools, newId), /not a Clover file/);
  assert.throws(() => parseImport('{"format":"clover","version":99,"kind":"tab"}', tools, newId), /newer version/);
  assert.throws(() => parseImport('{"format":"clover","version":1,"kind":"mystery"}', tools, newId), ImportError);
  assert.throws(
    () => parseImport('{"format":"clover","version":1,"kind":"tab","tab":{"type":"unknown","state":{}}}', tools, newId),
    /does not have/,
  );
});

test('unknown tools are skipped but known tabs survive', () => {
  const text = JSON.stringify({
    format: 'clover',
    version: 1,
    kind: 'workspace',
    workspace: {
      activeIndex: 0,
      tabs: [
        { type: 'zzz', state: {} },
        { type: 'note', title: 'ok', state: { text: 'k' } },
      ],
    },
  });
  const result = parseImport(text, tools, newId);
  assert.equal(result.tabs.length, 1);
  assert.equal(result.tabs[0].title, 'ok');
});

test('prototype-pollution keys are stripped', () => {
  const hostile =
    '{"format":"clover","version":1,"kind":"tab","tab":{"type":"note","state":{"__proto__":{"polluted":true},"text":"x"}}}';
  const result = parseImport(hostile, tools, newId);
  assert.equal(result.tab.state.text, 'x');
  assert.equal({}.polluted, undefined);
  const cleaned = sanitizeJson(JSON.parse('{"a":{"constructor":{"x":1},"b":2}}'));
  assert.deepEqual(cleaned, { a: { b: 2 } });
});

test('sanitizeJson bounds depth and removes non-finite numbers', () => {
  let deep = { v: 1 };
  for (let i = 0; i < 30; i += 1) deep = { child: deep };
  assert.ok(JSON.stringify(sanitizeJson(deep)).includes('null'));
  assert.equal(sanitizeJson(Infinity), null);
  assert.equal(
    sanitizeJson(() => 1),
    null,
  );
});

test('titles are trimmed, limited, and defaulted', () => {
  const text = JSON.stringify({
    format: 'clover',
    version: 1,
    kind: 'tab',
    tab: { type: 'note', title: `   ${'x'.repeat(200)}  `, state: {} },
  });
  assert.equal(parseImport(text, tools, newId).tab.title.length, 60);
  const blank = JSON.stringify({
    format: 'clover',
    version: 1,
    kind: 'tab',
    tab: { type: 'graph', title: '  ', state: {} },
  });
  assert.equal(parseImport(blank, tools, newId).tab.title, 'Graph');
});

test('tab count is capped', () => {
  const tabs = Array.from({ length: MAX_TABS + 10 }, () => ({ type: 'note', state: {} }));
  assert.equal(normalizeWorkspace({ tabs }, tools, newId).tabs.length, MAX_TABS);
});

test('normalizeWorkspace restores the active tab and tolerates garbage', () => {
  const raw = {
    activeId: 'y',
    tabs: [
      { id: 'x', type: 'note' },
      { id: 'y', type: 'graph' },
    ],
  };
  const ws = normalizeWorkspace(raw, tools, newId);
  assert.equal(ws.tabs[1].id, ws.activeId);
  assert.deepEqual(normalizeWorkspace(null, tools, newId), { activeId: null, tabs: [] });
  assert.deepEqual(normalizeWorkspace({ tabs: 'nope' }, tools, newId), { activeId: null, tabs: [] });
});

test('uniqueTitle numbers duplicates', () => {
  assert.equal(uniqueTitle('Graph', []), 'Graph');
  assert.equal(uniqueTitle('Graph', [{ title: 'Graph' }]), 'Graph 2');
  assert.equal(uniqueTitle('Graph', [{ title: 'Graph' }, { title: 'Graph 2' }]), 'Graph 3');
});
