/**
 * Rules for the cellular automaton tab. Each rule is plain Python:
 *
 *   COLORS    a list of "#rrggbb" colours, one per state (2 to 16 states). State 0 is the first colour.
 *   NAMES     optional names for the states
 *   WRAP      optional; True (the default) joins opposite edges, False treats cells outside the grid as EDGE
 *   def rule(cell, neighbors):   returns the cell's next state
 *
 * `neighbors` lists the eight surrounding states, clockwise from the top: N, NE, E, SE, S, SW, W, NW.
 * A rule may also take x and y: `def rule(cell, neighbors, x, y)`.
 */
import { asciiGrid, randomGrid } from './automata.js';

const GLIDER_GUN = [
  '........................O...........',
  '......................O.O...........',
  '............OO......OO............OO',
  '...........O...O....OO............OO',
  'OO........O.....O...OO..............',
  'OO........O...O.OO....O.O...........',
  '..........O.....O.......O...........',
  '...........O...O....................',
  '............OO......................',
];

const WIRE_LOOP = [
  '.....................',
  '..###############....',
  '..#.............#....',
  '..#.............#....',
  '..#.............#####',
  '..#.............#...#',
  '..#.............#####',
  '..#.............#....',
  '..#.............#....',
  '..tH#############....',
  '.....................',
];

export const AUTOMATA_PRESETS = [
  {
    id: 'life',
    label: "Conway's Game of Life",
    description: 'A live cell survives with two or three live neighbours. A dead cell with three comes alive.',
    width: 48,
    height: 36,
    start: (w, h) => randomGrid(w, h, [7, 3]),
    code: `COLORS = ["#ffffff", "#1b1f1d"]
NAMES = ["Dead", "Alive"]

def rule(cell, neighbors):
    alive = sum(neighbors)          # neighbours that are in state 1
    if cell == 1:
        if alive == 2 or alive == 3:
            return 1                # survives
        return 0                    # dies of loneliness or crowding
    if alive == 3:
        return 1                    # birth
    return 0
`,
  },
  {
    id: 'glider-gun',
    label: 'Glider gun',
    description:
      "Gosper's glider gun fires a glider every 30 generations. Edges are not joined, so gliders leave the grid.",
    width: 60,
    height: 40,
    start: (w, h) => asciiGrid(w, h, GLIDER_GUN, { O: 1 }, { left: 2, top: 2 }),
    code: `COLORS = ["#ffffff", "#1b1f1d"]
NAMES = ["Dead", "Alive"]
WRAP = False        # cells outside the grid count as EDGE (0 by default), so gliders fly off

def rule(cell, neighbors):
    alive = sum(neighbors)
    if cell == 1:
        if alive == 2 or alive == 3:
            return 1
        return 0
    if alive == 3:
        return 1
    return 0
`,
  },
  {
    id: 'forest-fire',
    label: 'Forest fire',
    description:
      'Trees grow, lightning strikes, and fire spreads to neighbouring trees. Click to plant trees or start a fire.',
    width: 64,
    height: 48,
    start: (w, h) => randomGrid(w, h, [4, 6, 0]),
    code: `import random

COLORS = ["#e7dcc6", "#2e7d32", "#e65100"]
NAMES = ["Empty", "Tree", "Fire"]

GROWTH = 0.01        # chance per step that an empty cell grows a tree
LIGHTNING = 0.0003   # chance per step that a tree is struck and starts burning

def rule(cell, neighbors):
    if cell == 2:
        return 0                                    # a fire burns out, leaving bare ground
    if cell == 1:
        # Fire spreads from the four orthogonal neighbours: N, E, S, W.
        if neighbors[0] == 2 or neighbors[2] == 2 or neighbors[4] == 2 or neighbors[6] == 2:
            return 2
        if random.random() < LIGHTNING:
            return 2
        return 1
    if random.random() < GROWTH:
        return 1
    return 0
`,
  },
  {
    id: 'wireworld',
    label: 'Wireworld',
    description: 'Electrons travel along conductors. Click to add wire, or to add an electron head, tail, or gap.',
    width: 30,
    height: 20,
    start: (w, h) => asciiGrid(w, h, WIRE_LOOP, { '#': 3, H: 1, t: 2 }),
    code: `COLORS = ["#161a18", "#3b82f6", "#ef4444", "#facc15"]
NAMES = ["Empty", "Electron head", "Electron tail", "Conductor"]

def rule(cell, neighbors):
    if cell == 1:
        return 2                     # a head becomes a tail
    if cell == 2:
        return 3                     # a tail becomes conductor again
    if cell == 3:
        heads = 0
        for n in neighbors:
            if n == 1:
                heads += 1
        if heads == 1 or heads == 2:
            return 1                 # conductor next to one or two heads becomes a head
        return 3
    return 0
`,
  },
  {
    id: 'brain',
    label: "Brian's Brain",
    description: 'Three states: off, firing, and recovering. Patterns glide and crackle across the grid.',
    width: 56,
    height: 40,
    start: (w, h) => randomGrid(w, h, [9, 1, 0]),
    code: `COLORS = ["#0f1412", "#7dd3fc", "#2563eb"]
NAMES = ["Off", "Firing", "Recovering"]

def rule(cell, neighbors):
    if cell == 1:
        return 2                     # firing cells start to recover
    if cell == 2:
        return 0                     # recovering cells switch off
    firing = 0
    for n in neighbors:
        if n == 1:
            firing += 1
    if firing == 2:
        return 1                     # an off cell with exactly two firing neighbours fires
    return 0
`,
  },
  {
    id: 'cyclic',
    label: 'Rock, paper, scissors',
    description: 'Each colour is eaten by the next. Spirals form out of random noise.',
    width: 64,
    height: 48,
    start: (w, h) => randomGrid(w, h, [1, 1, 1, 1]),
    code: `COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6"]
NAMES = ["Red", "Yellow", "Green", "Blue"]

THRESHOLD = 3   # neighbours of the next colour needed to be eaten (1 to 8)

def rule(cell, neighbors):
    nxt = (cell + 1) % 4
    count = 0
    for n in neighbors:
        if n == nxt:
            count += 1
    if count >= THRESHOLD:
        return nxt
    return cell
`,
  },
  {
    id: 'blank',
    label: 'Your own rule',
    description: 'A template with four colours that counts neighbours and uses x and y. Edit it and press Apply rule.',
    width: 40,
    height: 30,
    start: (w, h) => randomGrid(w, h, [1, 1, 1, 1]),
    code: `# Colours are "#rrggbb". The number of colours is the number of states.
COLORS = ["#ffffff", "#f59e0b", "#10b981", "#6366f1"]
NAMES = ["White", "Amber", "Green", "Indigo"]

# WRAP = False   # uncomment to stop the edges joining up
# EDGE = 0       # the state assumed outside the grid when WRAP is False

# cell       the cell's current state (0, 1, 2, ...)
# neighbors  the eight states around it, clockwise from the top:
#            [N, NE, E, SE, S, SW, W, NW]
# x, y       the cell's column and row
# Return the cell's next state, a whole number from 0 to len(COLORS) - 1.
def rule(cell, neighbors, x, y):
    same = 0
    for n in neighbors:
        if n == cell:
            same += 1
    if same < 2:
        return (cell + 1) % 4       # lonely cells change colour
    return cell
`,
  },
];

export const DEFAULT_AUTOMATON = AUTOMATA_PRESETS[0];

export const findAutomaton = (id) => AUTOMATA_PRESETS.find((p) => p.id === id) ?? null;
