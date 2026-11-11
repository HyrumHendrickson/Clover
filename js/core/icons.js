/** Inline SVG icons, built with the DOM API (no innerHTML). */

const SVG_NS = 'http://www.w3.org/2000/svg';

const STROKE = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  upload: 'M12 16V5m0 0L8 9m4-4l4 4M5 20h14',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01',
  reset: 'M4 12a8 8 0 102.3-5.7L4 8.5M4 4v4.5h4.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'tool-desmos': 'M3 20h18M3 20V4M5.5 15.5c3 0 3-9 6.5-9s3.5 9 6.5 9',
  'tool-matrix': 'M8 4H5v16h3M16 4h3v16h-3M10.5 9h.01M13.5 9h.01M10.5 15h.01M13.5 15h.01',
  'tool-complex': 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 12h.01',
  'tool-vector': 'M4 7h7M8.5 4.5L11 7 8.5 9.5M4 17h7M8.5 14.5L11 17l-2.5 2.5M14 12h6M17.5 9.5L20 12l-2.5 2.5',
  'tool-python': 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13',
};

const FILLED = {
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
};

/** Create an icon element. Names are listed in STROKE and FILLED above. */
export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  const path = document.createElementNS(SVG_NS, 'path');
  if (name in FILLED) {
    path.setAttribute('d', FILLED[name]);
    path.setAttribute('fill', 'currentColor');
  } else {
    path.setAttribute('d', STROKE[name] ?? STROKE.help);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(path);
  return svg;
}
