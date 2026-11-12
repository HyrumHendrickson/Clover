/*
 * Clover embed script. Put it on any page, from the same place Clover is served:
 *
 *   <script src="https://example.org/Clover/embed.js" async></script>
 *   <clover-embed tool="matrix" height="520"></clover-embed>
 *
 * Attributes of <clover-embed> (all optional):
 *   tool      show only this tool: graph, matrix, stats, programming, ... Leave out for the whole workspace.
 *   tools     comma-separated list of tools to offer in the whole-workspace view
 *   theme     light or dark. Leave out to follow the visitor's system setting.
 *   height    pixels or any CSS length. Default 600.  width: default 100%.
 *   file      address of a .clover file on your site to open when the embed starts
 *   persist   present = remember the visitor's work in their browser between visits
 *   id        names the remembered work, so two embeds of one tool on a page do not share it
 *   src       where Clover is served, if it is not where this script came from
 *   title     accessible name of the frame
 *
 * For pages where custom elements are stripped, <div data-clover data-tool="matrix"></div> works the same.
 * From script: Clover.embed(element, options) returns { load, setTheme, open, exportText, ready, iframe, destroy }.
 * See docs/embedding.md.
 */
(function () {
  'use strict';
  if (window.Clover && window.Clover.embed) return;

  var script = document.currentScript;
  var BASE = script && script.src ? new URL('.', script.src).href : 'https://hyrumhendrickson.github.io/Clover/';
  var ID = /^[A-Za-z0-9_-]{1,40}$/;
  var TOOL = /^[a-z0-9]{1,24}$/;

  function frameUrl(base, o) {
    var url = new URL(base, document.baseURI);
    url.search = '';
    url.hash = '';
    url.searchParams.set('embed', '1');
    if (o.tool && TOOL.test(o.tool)) url.searchParams.set('tool', o.tool);
    else if (o.tools) {
      var list = String(o.tools)
        .split(',')
        .map(function (t) {
          return t.trim();
        })
        .filter(function (t) {
          return TOOL.test(t);
        });
      if (list.length) url.searchParams.set('tools', list.join(','));
    }
    if (o.theme === 'light' || o.theme === 'dark') url.searchParams.set('theme', o.theme);
    if (o.persist) url.searchParams.set('persist', '1');
    if (o.id && ID.test(o.id)) url.searchParams.set('id', o.id);
    return url;
  }

  function cssLength(value, fallback) {
    var v = String(value === undefined || value === null || value === '' ? fallback : value).trim();
    return /^\d+(\.\d+)?$/.test(v) ? v + 'px' : /^[\d.]+(px|%|em|rem|vh|vw)$/.test(v) ? v : fallback;
  }

  function embed(target, options) {
    var o = options || {};
    var src = frameUrl(o.src || BASE, o);
    var iframe = document.createElement('iframe');
    iframe.src = src.href;
    iframe.title = o.title || (o.tool ? 'Clover: ' + o.tool : 'Clover');
    iframe.loading = 'lazy';
    iframe.setAttribute('allow', 'clipboard-write; fullscreen');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads allow-popups allow-forms');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.style.cssText =
      'border:0;display:block;max-width:100%;width:' +
      cssLength(o.width, '100%') +
      ';height:' +
      cssLength(o.height, '600px');
    target.appendChild(iframe);

    var ready = false;
    var queue = [];
    var waiting = [];
    var readyResolve;
    var readyPromise = new Promise(function (resolve) {
      readyResolve = resolve;
    });

    function post(message) {
      if (ready && iframe.contentWindow) iframe.contentWindow.postMessage(message, src.origin);
      else queue.push(message);
    }

    function onMessage(event) {
      if (event.source !== iframe.contentWindow || event.origin !== src.origin) return;
      var data = event.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type === 'clover:ready') {
        ready = true;
        queue.splice(0).forEach(function (m) {
          iframe.contentWindow.postMessage(m, src.origin);
        });
        readyResolve({ tools: Array.isArray(data.tools) ? data.tools : [] });
        target.dispatchEvent(new CustomEvent('clover-ready', { bubbles: true, detail: { tools: data.tools } }));
      } else if (data.type === 'clover:loaded') {
        target.dispatchEvent(
          new CustomEvent('clover-loaded', { bubbles: true, detail: { ok: !!data.ok, message: data.message } }),
        );
      } else if (data.type === 'clover:export' && typeof data.text === 'string') {
        waiting.splice(0).forEach(function (resolve) {
          resolve(data.text);
        });
      }
    }
    window.addEventListener('message', onMessage);

    var handle = {
      iframe: iframe,
      ready: readyPromise,
      /** Open the text of a .clover file (a string, or an object that is turned into JSON). */
      load: function (file) {
        post({ type: 'clover:load', text: typeof file === 'string' ? file : JSON.stringify(file) });
      },
      setTheme: function (theme) {
        post({ type: 'clover:theme', theme: theme });
      },
      open: function (tool) {
        post({ type: 'clover:open', tool: tool });
      },
      /** Resolves with the current work as .clover file text. */
      exportText: function () {
        return new Promise(function (resolve) {
          waiting.push(resolve);
          post({ type: 'clover:export' });
        });
      },
      destroy: function () {
        window.removeEventListener('message', onMessage);
        iframe.remove();
      },
    };

    if (o.file) {
      fetch(o.file)
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.text();
        })
        .then(function (text) {
          handle.load(text);
        })
        .catch(function (error) {
          if (window.console) console.warn('Clover: could not read ' + o.file + ' (' + error.message + ')');
        });
    }
    return handle;
  }

  function optionsFrom(get, has) {
    return {
      tool: get('tool'),
      tools: get('tools'),
      theme: get('theme'),
      height: get('height'),
      width: get('width'),
      file: get('file'),
      persist: has('persist') && get('persist') !== 'false' && get('persist') !== '0',
      id: get('id'),
      src: get('src'),
      title: get('title'),
    };
  }

  if (window.customElements && !customElements.get('clover-embed')) {
    customElements.define(
      'clover-embed',
      class extends HTMLElement {
        connectedCallback() {
          if (this.cloverHandle) return;
          var self = this;
          this.style.display = this.style.display || 'block';
          this.cloverHandle = embed(
            this,
            optionsFrom(
              function (name) {
                return self.getAttribute(name);
              },
              function (name) {
                return self.hasAttribute(name);
              },
            ),
          );
        }
        disconnectedCallback() {
          if (this.cloverHandle) this.cloverHandle.destroy();
          this.cloverHandle = null;
        }
        load(file) {
          if (this.cloverHandle) this.cloverHandle.load(file);
        }
        setTheme(theme) {
          if (this.cloverHandle) this.cloverHandle.setTheme(theme);
        }
        open(tool) {
          if (this.cloverHandle) this.cloverHandle.open(tool);
        }
        exportText() {
          return this.cloverHandle ? this.cloverHandle.exportText() : Promise.reject(new Error('Not connected'));
        }
      },
    );
  }

  function upgradeDataElements() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-clover]'), function (el) {
      if (el.cloverHandle) return;
      el.cloverHandle = embed(
        el,
        optionsFrom(
          function (name) {
            return el.getAttribute('data-' + name);
          },
          function (name) {
            return el.hasAttribute('data-' + name);
          },
        ),
      );
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', upgradeDataElements);
  else upgradeDataElements();

  window.Clover = { embed: embed, base: BASE };
})();
