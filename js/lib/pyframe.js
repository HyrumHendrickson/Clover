/**
 * A sandboxed Python runner frame: the same page the turtle tab uses, shared by every tool that runs Python.
 * The frame has an opaque origin (`sandbox="allow-scripts"` without `allow-same-origin`), so nothing in it can
 * read the saved workspace. Messages are accepted only from this frame and only when they are plain objects.
 */
import { h } from '../core/dom.js';

/** Location of the runner page, resolved relative to this module. */
export const RUNNER_URL = new URL('../../runner/index.html', import.meta.url).href;
export const START_TIMEOUT_MS = 15000;

export class PythonFrame {
  /**
   * @param {HTMLElement} host where the iframe is placed
   * @param {{ title: string, onMessage: (data: any) => void, onFailure?: (message: string) => void, hidden?: boolean }} options
   */
  constructor(host, { title, onMessage, onFailure = () => {}, hidden = false, offscreen = false, url = RUNNER_URL }) {
    this.host = host;
    this.title = title;
    this.onMessage = onMessage;
    this.onFailure = onFailure;
    this.hidden = hidden;
    this.offscreen = offscreen;
    this.url = url;
    this.frame = null;
    this.ready = false;
    this.queue = [];
    this.timer = 0;
    this.listener = (event) => {
      if (!this.frame || event.source !== this.frame.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type === 'ready') {
        clearTimeout(this.timer);
        this.ready = true;
        for (const message of this.queue.splice(0)) this.frame.contentWindow.postMessage(message, '*');
        return;
      }
      this.onMessage(data);
    };
    window.addEventListener('message', this.listener);
  }

  /** True while a frame exists, whether or not it has finished loading. */
  get alive() {
    return this.frame !== null;
  }

  /** Create the frame if there is none. Messages posted before it is ready are sent once it is. */
  start() {
    if (this.frame) return;
    this.ready = false;
    this.frame = h('iframe', {
      class: this.offscreen ? 'py-frame py-frame-offscreen' : this.hidden ? 'py-frame py-frame-hidden' : 'py-frame',
      title: this.title,
      sandbox: 'allow-scripts',
      referrerpolicy: 'no-referrer',
      src: this.url,
      hidden: this.hidden,
      tabindex: this.hidden || this.offscreen ? '-1' : null,
      'aria-hidden': this.hidden || this.offscreen ? 'true' : null,
    });
    this.host.append(this.frame);
    this.timer = setTimeout(() => {
      if (!this.ready) this.onFailure('The runner did not start. Check your connection, then reload the page.');
    }, START_TIMEOUT_MS);
  }

  post(message) {
    if (!this.frame) this.start();
    if (this.ready) this.frame.contentWindow.postMessage(message, '*');
    else this.queue.push(message);
  }

  /** Remove the frame. This stops anything it is running and forgets its variables. */
  stop() {
    clearTimeout(this.timer);
    this.queue.length = 0;
    this.ready = false;
    if (this.frame) {
      this.frame.remove();
      this.frame = null;
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener('message', this.listener);
  }
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** True for a PNG data URL of a sensible size. Anything else from a frame is ignored. */
export const isPngDataUrl = (value) =>
  typeof value === 'string' && value.length < 8_000_000 && PNG_DATA_URL.test(value);
