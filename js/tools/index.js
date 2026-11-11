import complex from './complex.js';
import geometry from './geometry.js';
import graph from './graph.js';
import graph3d from './graph3d.js';
import matrix from './matrix.js';
import notebook from './notebook.js';
import python from './python.js';
import { registerTools } from './registry.js';
import vectorfield from './vectorfield.js';

/** Every tool Clover can open, in launcher order. */
export const TOOL_LIST = [graph, graph3d, notebook, matrix, geometry, complex, vectorfield, python];

/** Tools keyed by type, as stored in saved workspaces. */
export const TOOLS = Object.fromEntries(TOOL_LIST.map((tool) => [tool.type, tool]));

registerTools(TOOLS);
