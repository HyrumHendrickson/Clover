import complex from './complex.js';
import graph from './graph.js';
import matrix from './matrix.js';
import python from './python.js';
import vectorfield from './vectorfield.js';

/** Every tool Clover can open, in launcher order. */
export const TOOL_LIST = [graph, matrix, complex, vectorfield, python];

/** Tools keyed by type, as stored in saved workspaces. */
export const TOOLS = Object.fromEntries(TOOL_LIST.map((tool) => [tool.type, tool]));
