import { debounce, downloadBlob, h, slugify, uid } from '../core/dom.js';
import { createCodeEditor } from '../core/codeeditor.js';
import { icon } from '../core/icons.js';
import { openMenu } from '../core/menu.js';
import {
  IMAGE_TYPES,
  MAX_FILES,
  MAX_FOLDERS,
  MAX_IMAGE_BYTES,
  MAX_PATH,
  MAX_PROJECT_BYTES,
  MAX_TEXT,
  allFolders,
  bytesToBase64,
  compileRequest,
  extensionOf,
  firstTexError,
  folderOf,
  isImagePath,
  isTextPath,
  isValidFolder,
  isValidPath,
  normalizeProject,
  projectBytes,
  tokenizeLatex,
  uniquePath,
} from '../lib/latexproject.js';
import { PythonFrame } from '../lib/pyframe.js';
import { fitCanvas } from '../lib/viewport.js';

const RUNNER_URL = new URL('../../runner/latex.html', import.meta.url).href;
const MAX_PDF_BYTES = 50_000_000;
const MAX_LOG = 120000;
const AUTO_DELAY_MS = 1500;
const UPLOAD_ACCEPT = '.tex,.bib,.sty,.cls,.bst,.cfg,.txt,.png,.jpg,.jpeg,.pdf';

const isArrayBuffer = (value) => Object.prototype.toString.call(value) === '[object ArrayBuffer]';

/** A file name made safe to use as a project path. */
const cleanName = (name) =>
  String(name)
    .replace(/[^A-Za-z0-9._ /-]+/g, '-')
    .replace(/^[-./ ]+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\.\.+/g, '.')
    .slice(0, MAX_PATH);

export default {
  type: 'latex',
  name: 'LaTeX',
  description: 'Write LaTeX across several files, add pictures, and see the PDF beside your code.',
  defaultState: () => normalizeProject({}),
  normalize: normalizeProject,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const left = width * 0.12;
    const mid = width * 0.5;
    ctx.fillStyle = colors.grid;
    for (let i = 0; i < 6; i += 1)
      ctx.fillRect(left, height * (0.2 + i * 0.12), (mid - left) * (i % 2 ? 0.7 : 0.95), 5);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = colors.axis;
    ctx.fillRect(mid + 12, height * 0.12, width * 0.34, height * 0.76);
    ctx.strokeRect(mid + 12, height * 0.12, width * 0.34, height * 0.76);
    ctx.fillStyle = colors.accent;
    ctx.font = `${Math.round(height * 0.2)}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText('\u2211', mid + 12 + width * 0.17, height * 0.5);
  },

  mount(root, ctx) {
    const state = ctx.state;
    let pdfUrl = null;
    let pdfBytes = null;
    let busy = false;
    let again = false;
    let requestId = null;
    let lastLog = '';

    const byPath = (path) => state.files.find((f) => f.path === path);
    const save = () => ctx.save();

    /* ----------------------------------------------------------- compiler */

    const status = h('span', { class: 'py-status ltx-status', role: 'status' });
    const logEl = h('pre', { class: 'py-console ltx-log', 'aria-label': 'TeX log', tabindex: 0 });
    const logBox = h('details', { class: 'ltx-log-box' }, h('summary', {}, 'Log'), logEl);
    const preview = h('iframe', { class: 'ltx-pdf', title: 'PDF preview', hidden: true });
    const empty = h(
      'div',
      { class: 'ltx-empty' },
      h('p', {}, 'Press Compile to see your PDF here.'),
      h(
        'p',
        { class: 'tool-note' },
        'The first compile downloads the TeX engine, which can take a minute. Later ones are quick.',
      ),
    );
    const frameHost = h('div', { class: 'ca-frame-host' });

    const setStatus = (text, state_ = '') => {
      status.textContent = text;
      status.dataset.state = state_;
    };

    const runner = new PythonFrame(frameHost, {
      title: 'LaTeX compiler',
      hidden: true,
      url: RUNNER_URL,
      onFailure: (message) => finish({ ok: false, error: message, log: '' }),
      onMessage: (data) => {
        if (typeof data.id !== 'string' || data.id !== requestId) return;
        if (data.type === 'status' && typeof data.text === 'string') setStatus(data.text.slice(0, 80), 'running');
        else if (data.type === 'log' && typeof data.text === 'string') appendLog(data.text);
        else if (data.type === 'compiled') {
          const ok =
            data.ok === true &&
            isArrayBuffer(data.pdf) &&
            data.pdf.byteLength > 0 &&
            data.pdf.byteLength <= MAX_PDF_BYTES;
          finish({
            ok,
            pdf: ok ? data.pdf : null,
            error: typeof data.error === 'string' ? data.error.slice(0, 2000) : '',
            log: typeof data.log === 'string' ? data.log.slice(0, MAX_LOG) : '',
          });
        }
      },
    });

    function appendLog(text) {
      lastLog = (lastLog + text + '\n').slice(-MAX_LOG);
      logEl.textContent = lastLog;
      logEl.scrollTop = logEl.scrollHeight;
    }

    function showPdf(buffer) {
      const bytes = new Uint8Array(buffer);
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== '%PDF') return false;
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfBytes = bytes;
      pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      preview.src = `${pdfUrl}#toolbar=1&navpanes=0`;
      preview.hidden = false;
      empty.hidden = true;
      openButton.disabled = false;
      downloadButton.disabled = false;
      return true;
    }

    function finish(result) {
      busy = false;
      requestId = null;
      compileButton.disabled = false;
      if (result.log) {
        lastLog = result.log;
        logEl.textContent = result.log;
      }
      if (result.ok && showPdf(result.pdf)) {
        setStatus('Compiled', 'done');
      } else {
        const offline = /could not fetch|failed to fetch|networkerror|load failed/i.test(result.error ?? '');
        const detail = offline
          ? 'The TeX engine could not be downloaded. Check that this browser can reach packages.siglum.org, then compile again.'
          : firstTexError(result.log) || result.error || 'The document did not compile.';
        setStatus(detail.slice(0, 200), 'error');
        logBox.open = true;
        if (result.error) appendLog(result.error);
      }
      if (again) {
        again = false;
        compile();
      }
    }

    function compile() {
      if (busy) {
        again = true;
        return;
      }
      let request;
      try {
        request = compileRequest(state);
      } catch {
        setStatus('A file in this project could not be read.', 'error');
        return;
      }
      busy = true;
      requestId = uid('tex');
      lastLog = '';
      logEl.textContent = '';
      compileButton.disabled = true;
      setStatus('Starting\u2026', 'running');
      runner.post({ type: 'compile', id: requestId, ...request });
    }
    const compileLater = debounce(() => compile(), AUTO_DELAY_MS);

    /* -------------------------------------------------------------- files */

    const fileList = h('ul', { class: 'ltx-files', 'aria-label': 'Project files' });
    const editorHost = h('div', { class: 'ltx-editor' });
    const imageHost = h('div', { class: 'ltx-image', hidden: true });
    let editor = null;
    let renaming = null;
    let creatingFolder = false;
    /** Folder that new files and uploads go into ('' is the top level). Not saved. */
    let currentFolder = '';

    const mimeOf = (path) => IMAGE_TYPES[extensionOf(path)] ?? 'application/octet-stream';

    function showActive() {
      const file = byPath(state.active);
      const text = file && typeof file.text === 'string';
      editorHost.hidden = !text;
      imageHost.hidden = Boolean(text);
      if (text) {
        editor.textarea.value = file.text;
        editor.textarea.setAttribute('aria-label', `${file.path}, LaTeX source`);
        editor.refresh();
        editor.textarea.scrollTop = 0;
      } else if (file) {
        imageHost.replaceChildren(
          extensionOf(file.path) === 'pdf'
            ? h(
                'p',
                {},
                `${file.path} is a PDF figure (${Math.round((file.data.length * 3) / 4 / 1024)} KB). Use it with \\includegraphics{${file.path.replace(/\.pdf$/, '')}}.`,
              )
            : h('img', { src: `data:${mimeOf(file.path)};base64,${file.data}`, alt: `Preview of ${file.path}` }),
          h('p', { class: 'tool-note' }, `Use it with \\includegraphics{${file.path}}.`),
        );
      }
    }

    const inFolder = (path) => (currentFolder ? `${currentFolder}/${path}` : path);

    function folderChip(folder) {
      const selected = folder === currentFolder;
      const depth = folder.split('/').length - 1;
      const more = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon ltx-more',
          type: 'button',
          'aria-label': `Options for folder ${folder}`,
          'aria-haspopup': 'menu',
          onclick: (event) => {
            event.stopPropagation();
            currentFolder = folder;
            openMenu(
              event.currentTarget,
              [
                { label: 'New .tex file here', icon: 'plus', onSelect: newFile },
                { label: 'Upload files here\u2026', icon: 'upload', onSelect: () => fileInput.click() },
                { label: 'New folder inside\u2026', onSelect: () => beginFolder() },
                { separator: true },
                { label: 'Delete folder', icon: 'trash', onSelect: () => removeFolder(folder) },
              ],
              { align: 'end' },
            );
          },
        },
        icon('settings', 14),
      );
      return h(
        'li',
        { class: `ltx-file ltx-folder${selected ? ' is-selected' : ''}`, style: { marginLeft: `${depth * 14}px` } },
        h(
          'button',
          {
            class: 'ltx-file-name',
            type: 'button',
            'aria-pressed': selected ? 'true' : 'false',
            title: 'New files and uploads go into the selected folder',
            onclick: () => {
              currentFolder = selected ? '' : folder;
              buildFiles();
            },
          },
          `${folder.split('/').pop()}/`,
        ),
        more,
      );
    }

    function beginFolder() {
      creatingFolder = true;
      buildFiles();
    }

    function commitFolder(value) {
      creatingFolder = false;
      const name = cleanName(value.trim()).replace(/\/+$/, '');
      if (name) {
        const path = inFolder(name);
        if (!isValidFolder(path)) {
          ctx.notify('Use letters, digits, dashes, and underscores for a folder name.', 'error');
        } else if (allFolders(state).includes(path)) {
          ctx.notify(`There is already a folder called ${path}.`, 'error');
        } else if (allFolders(state).length >= MAX_FOLDERS) {
          ctx.notify(`A project can have up to ${MAX_FOLDERS} folders.`, 'error');
        } else {
          state.folders.push(path);
          currentFolder = path;
          save();
        }
      }
      buildFiles();
    }

    function removeFolder(folder) {
      const inside = (path) => path.startsWith(`${folder}/`);
      const doomed = state.files.filter((f) => inside(f.path));
      const remainingTex = state.files.filter((f) => !inside(f.path) && extensionOf(f.path) === 'tex');
      if (remainingTex.length === 0) {
        ctx.notify('A project needs at least one .tex file outside the folder you delete.', 'info');
        return;
      }
      state.files = state.files.filter((f) => !inside(f.path));
      state.folders = state.folders.filter((f) => f !== folder && !inside(f));
      if (currentFolder === folder || inside(currentFolder)) currentFolder = '';
      if (!byPath(state.main)) state.main = remainingTex[0].path;
      if (!byPath(state.active)) state.active = state.main;
      save();
      buildFiles();
      showActive();
      if (doomed.length)
        ctx.notify(`Deleted ${folder} and ${doomed.length} file${doomed.length === 1 ? '' : 's'}.`, 'info');
    }

    function buildFiles() {
      const folders = allFolders(state);
      const ordered = [
        ...state.files.filter((f) => folderOf(f.path) === '').map((file) => ({ file })),
        ...folders.flatMap((folder) => [
          { folder },
          ...state.files.filter((f) => folderOf(f.path) === folder).map((file) => ({ file })),
        ]),
      ];
      const folderInput = creatingFolder
        ? (() => {
            const input = h('input', {
              class: 'input input-mono ltx-rename',
              type: 'text',
              placeholder: currentFolder ? `Folder inside ${currentFolder}` : 'Folder name',
              maxlength: String(MAX_PATH),
              'aria-label': 'Name of the new folder',
              onkeydown: (event) => {
                if (event.key === 'Enter') commitFolder(input.value);
                else if (event.key === 'Escape') {
                  creatingFolder = false;
                  buildFiles();
                }
              },
              onblur: () => {
                if (creatingFolder) commitFolder(input.value);
              },
            });
            queueMicrotask(() => input.focus());
            return h('li', { class: 'ltx-file' }, input);
          })()
        : null;
      fileList.replaceChildren(
        ...(folderInput ? [folderInput] : []),
        ...ordered.map((entry) => {
          if (!entry.file) return folderChip(entry.folder);
          const file = entry.file;
          const selected = file.path === state.active;
          if (renaming === file.path) {
            const input = h('input', {
              class: 'input input-mono ltx-rename',
              type: 'text',
              value: file.path,
              maxlength: String(MAX_PATH),
              'aria-label': `New name for ${file.path}`,
              onkeydown: (event) => {
                if (event.key === 'Enter') commitRename(file, input.value);
                else if (event.key === 'Escape') {
                  renaming = null;
                  buildFiles();
                }
              },
              onblur: () => {
                if (renaming === file.path) commitRename(file, input.value);
              },
            });
            queueMicrotask(() => input.focus());
            return h('li', { class: 'ltx-file' }, input);
          }
          const more = h(
            'button',
            {
              class: 'btn btn-quiet btn-icon ltx-more',
              type: 'button',
              'aria-label': `Options for ${file.path}`,
              'aria-haspopup': 'menu',
              onclick: (event) => {
                event.stopPropagation();
                openMenu(
                  event.currentTarget,
                  [
                    ...(extensionOf(file.path) === 'tex' && file.path !== state.main
                      ? [{ label: 'Compile this file', onSelect: () => setMain(file.path) }]
                      : []),
                    { label: 'Rename', onSelect: () => beginRename(file.path) },
                    { label: 'Download', onSelect: () => downloadFile(file) },
                    { separator: true },
                    { label: 'Delete', icon: 'trash', onSelect: () => removeFile(file.path) },
                  ],
                  { align: 'end' },
                );
              },
            },
            icon('settings', 14),
          );
          return h(
            'li',
            { class: `ltx-file${selected ? ' is-selected' : ''}` },
            h(
              'button',
              {
                class: 'ltx-file-name',
                type: 'button',
                'aria-current': selected ? 'true' : 'false',
                onclick: () => open(file.path),
              },
              file.path.split('/').pop(),
              file.path === state.main ? h('span', { class: 'ltx-main-tag' }, 'main') : null,
            ),
            more,
          );
        }),
      );
    }

    function open(path) {
      if (!byPath(path)) return;
      state.active = path;
      save();
      buildFiles();
      showActive();
    }

    function setMain(path) {
      state.main = path;
      save();
      buildFiles();
      ctx.notify(`${path} is now the file that gets compiled.`, 'info');
    }

    function beginRename(path) {
      renaming = path;
      buildFiles();
    }

    function commitRename(file, value) {
      const next = cleanName(value.trim());
      renaming = null;
      if (next && next !== file.path) {
        if (
          !isValidPath(next) ||
          (extensionOf(next) !== extensionOf(file.path) && isTextPath(next) !== isTextPath(file.path))
        ) {
          ctx.notify(
            'Use letters, digits, dashes, and slashes, and keep the file type (.tex, .png, and so on).',
            'error',
          );
        } else if (byPath(next)) {
          ctx.notify(`There is already a file called ${next}.`, 'error');
        } else {
          if (state.main === file.path) state.main = next;
          if (state.active === file.path) state.active = next;
          file.path = next;
          save();
        }
      }
      buildFiles();
      showActive();
    }

    function removeFile(path) {
      const texCount = state.files.filter((f) => extensionOf(f.path) === 'tex').length;
      if (extensionOf(path) === 'tex' && texCount <= 1) {
        ctx.notify('A project needs at least one .tex file.', 'info');
        return;
      }
      state.files = state.files.filter((f) => f.path !== path);
      if (state.main === path) state.main = state.files.find((f) => extensionOf(f.path) === 'tex').path;
      if (state.active === path) state.active = state.main;
      save();
      buildFiles();
      showActive();
    }

    function addFile(file) {
      if (state.files.length >= MAX_FILES) {
        ctx.notify(`A project can have up to ${MAX_FILES} files. Delete one to add another.`, 'error');
        return false;
      }
      state.files.push(file);
      state.active = file.path;
      save();
      buildFiles();
      showActive();
      return true;
    }

    function newFile() {
      const path = uniquePath(
        inFolder('untitled.tex'),
        state.files.map((f) => f.path),
      );
      if (
        addFile({
          path,
          text: '% New file. Pull it into another file with \\input{' + path.replace(/\.tex$/, '') + '}\n',
        })
      )
        editor.focus();
    }

    async function upload(fileList_) {
      for (const file of [...fileList_]) {
        const name = inFolder(cleanName(file.name));
        if (!isValidPath(name)) {
          ctx.notify(
            `${file.name} is not a file type this tab can use. Add .tex, .bib, .sty, .cls, .png, .jpg, or .pdf files.`,
            'error',
          );
          continue;
        }
        const path = uniquePath(
          name,
          state.files.map((f) => f.path),
        );
        try {
          if (isTextPath(path)) {
            const text = await file.text();
            if (text.length > MAX_TEXT) {
              ctx.notify(`${file.name} is longer than ${MAX_TEXT.toLocaleString()} characters.`, 'error');
              continue;
            }
            if (projectBytes(state.files) + text.length > MAX_PROJECT_BYTES) throw new RangeError('project size');
            addFile({ path, text });
          } else if (isImagePath(path)) {
            if (file.size > MAX_IMAGE_BYTES) {
              ctx.notify(
                `${file.name} is larger than ${Math.round(MAX_IMAGE_BYTES / 1e5) / 10} MB. Shrink it first.`,
                'error',
              );
              continue;
            }
            if (projectBytes(state.files) + file.size > MAX_PROJECT_BYTES) throw new RangeError('project size');
            addFile({ path, data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) });
          }
        } catch (error) {
          ctx.notify(
            error instanceof RangeError
              ? 'The project is full. Delete a file or a large picture first.'
              : `Could not read ${file.name}.`,
            'error',
          );
        }
      }
    }

    function downloadFile(file) {
      const blob =
        typeof file.text === 'string'
          ? new Blob([file.text], { type: 'text/plain;charset=utf-8' })
          : new Blob([Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))], { type: mimeOf(file.path) });
      downloadBlob(file.path.split('/').pop(), blob);
    }

    /* ------------------------------------------------------------ editor */

    editor = createCodeEditor({
      value: byPath(state.active)?.text ?? '',
      label: 'LaTeX source',
      maxLength: MAX_TEXT,
      tokenize: tokenizeLatex,
      onInput: (value) => {
        const file = byPath(state.active);
        if (!file || typeof file.text !== 'string') return;
        file.text = value;
        save();
        if (state.auto) compileLater();
      },
      onRun: () => compile(),
    });
    editorHost.append(editor.el);

    /* ------------------------------------------------------------ toolbar */

    const compileButton = h(
      'button',
      { class: 'btn btn-primary', type: 'button', onclick: () => compile() },
      icon('play', 14),
      ' Compile',
    );
    const openButton = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        disabled: true,
        onclick: () => pdfUrl && window.open(pdfUrl, '_blank', 'noopener'),
      },
      icon('external', 14),
      ' Open PDF',
    );
    const downloadButton = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        disabled: true,
        onclick: () =>
          pdfBytes &&
          downloadBlob(
            `${slugify(state.main.replace(/\.tex$/, ''), 'document')}.pdf`,
            new Blob([pdfBytes], { type: 'application/pdf' }),
          ),
      },
      icon('download', 14),
      ' Download PDF',
    );
    const fileInput = h('input', {
      class: 'ltx-upload',
      type: 'file',
      multiple: true,
      accept: UPLOAD_ACCEPT,
      tabindex: '-1',
      'aria-hidden': 'true',
      onchange: async () => {
        await upload(fileInput.files);
        fileInput.value = '';
      },
    });
    const addMenu = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        'aria-haspopup': 'menu',
        onclick: (event) =>
          openMenu(event.currentTarget, [
            { label: 'New .tex file', icon: 'plus', onSelect: newFile },
            { label: 'New folder\u2026', icon: 'plus', onSelect: () => beginFolder() },
            { label: 'Upload files or pictures\u2026', icon: 'upload', onSelect: () => fileInput.click() },
          ]),
      },
      icon('plus', 14),
      ' Add file',
    );
    const engine = h(
      'select',
      {
        class: 'select',
        'aria-label': 'TeX engine',
        onchange: () => {
          state.engine = engine.value;
          save();
        },
      },
      h('option', { value: 'pdflatex' }, 'pdfLaTeX'),
      h('option', { value: 'xelatex' }, 'XeLaTeX'),
    );
    engine.value = state.engine;
    const auto = h('input', {
      type: 'checkbox',
      checked: state.auto,
      onchange: () => {
        state.auto = auto.checked;
        save();
      },
    });

    root.classList.add('tool', 'latex-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        compileButton,
        addMenu,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Engine'), engine),
        h('label', { class: 'ltx-check' }, auto, ' Compile as I type'),
        h('span', { class: 'tool-bar-spacer' }),
        status,
        openButton,
        downloadButton,
      ),
      h(
        'div',
        { class: 'tool-body ltx-body' },
        h('section', { class: 'ltx-left', 'aria-label': 'Source' }, fileList, editorHost, imageHost),
        h(
          'section',
          { class: 'ltx-right', 'aria-label': 'PDF' },
          h('div', { class: 'ltx-pdf-wrap' }, preview, empty),
          logBox,
        ),
      ),
      h(
        'div',
        { class: 'tool-footer' },
        h(
          'p',
          { class: 'tool-note' },
          'LaTeX is compiled in your browser by TeX Live in WebAssembly, inside a sandboxed frame. Packages that are not already bundled are downloaded when a document asks for them. Ctrl+Enter compiles.',
        ),
      ),
      fileInput,
      frameHost,
    );

    buildFiles();
    showActive();

    return {
      onShow: () => editor.syncScroll(),
      onHide: () => compileLater.cancel(),
      destroy: () => {
        compileLater.cancel();
        runner.destroy();
        if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      },
    };
  },
};
