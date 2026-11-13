import automata from './automata.js';
import complex from './complex.js';
import finance from './finance.js';
import fractals from './fractals.js';
import geometry from './geometry.js';
import graph from './graph.js';
import graph3d from './graph3d.js';
import latex from './latex.js';
import matrix from './matrix.js';
import maxima from './maxima.js';
import notebook from './notebook.js';
import probability from './probability.js';
import programming from './programming.js';
import python from './python.js';
import { registerTools } from './registry.js';
import stats from './stats.js';
import vectorfield from './vectorfield.js';

/** Every tool Clover can open, in launcher order. */
export const TOOL_LIST = [
  graph,
  graph3d,
  notebook,
  matrix,
  geometry,
  stats,
  probability,
  finance,
  complex,
  fractals,
  vectorfield,
  automata,
  latex,
  maxima,
  python,
  programming,
];

/** Tools keyed by type, as stored in saved workspaces. */
export const TOOLS = Object.fromEntries(TOOL_LIST.map((tool) => [tool.type, tool]));

registerTools(TOOLS);
