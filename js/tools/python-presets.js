/**
 * Python snippets for the turtle tab. Each program is plain Python 3 for
 * Skulpt and exposes its tunables (DEPTH, SIZE, ...) near the top.
 */

const PREAMBLE = `import turtle

screen = turtle.Screen()
screen.bgcolor("white")
turtle.tracer(0)  # draw off-screen, then show everything with update()

t = turtle.Turtle()
t.hideturtle()
t.speed(0)
t.pensize(1.5)
t.pencolor("#1f5124")
`;

const finish = `
turtle.update()
turtle.done()
`;

const wrap = (body) => `${PREAMBLE}${body}${finish}`;

export const PYTHON_PRESETS = [
  {
    id: 'starter',
    label: 'Starter',
    description: 'A colourful spiral to modify.',
    code: `import turtle

screen = turtle.Screen()
screen.bgcolor("white")
turtle.tracer(0)

t = turtle.Turtle()
t.hideturtle()
t.pensize(2)

colors = ["#1f5124", "#2e7d32", "#55a346", "#8bc34a"]

for i in range(120):
    t.pencolor(colors[i % len(colors)])
    t.forward(3 + i * 2.2)
    t.left(91)

turtle.update()
turtle.done()
`,
  },
  {
    id: 'koch',
    label: 'Koch snowflake',
    description: 'Each edge is replaced by four edges one third as long.',
    code: wrap(`
# Increase DEPTH for finer detail. Segments grow as 3 * 4 ** DEPTH.
DEPTH = 4
SIZE = 400

def koch(length, depth):
    if depth == 0:
        t.forward(length)
        return
    length /= 3
    koch(length, depth - 1)
    t.left(60)
    koch(length, depth - 1)
    t.right(120)
    koch(length, depth - 1)
    t.left(60)
    koch(length, depth - 1)

t.penup()
t.goto(-SIZE / 2, SIZE * 0.28)
t.setheading(0)
t.pendown()
for _ in range(3):
    koch(SIZE, DEPTH)
    t.right(120)
`),
  },
  {
    id: 'sierpinski',
    label: 'Sierpinski triangle',
    description: 'Recursive removal of the central triangle.',
    code: wrap(`
# Triangles drawn grow as 3 ** DEPTH.
DEPTH = 6
SIZE = 460

t.fillcolor("#55a346")

def triangle(x, y, size, depth):
    if depth == 0:
        t.penup()
        t.goto(x, y)
        t.setheading(0)
        t.pendown()
        t.begin_fill()
        for _ in range(3):
            t.forward(size)
            t.left(120)
        t.end_fill()
        return
    half = size / 2
    triangle(x, y, half, depth - 1)
    triangle(x + half, y, half, depth - 1)
    triangle(x + half / 2, y + half * 0.866025, half, depth - 1)

triangle(-SIZE / 2, -SIZE * 0.433, SIZE, DEPTH)
`),
  },
  {
    id: 'dragon',
    label: 'Dragon curve',
    description: 'Paper-folding sequence: fold, then mirror and append.',
    code: wrap(`
# Segments double with each ORDER step.
ORDER = 12
STEP = 5

turns = []
for _ in range(ORDER):
    turns = turns + [1] + [-x for x in reversed(turns)]

t.pencolor("#2e7d32")
t.penup()
t.goto(130, 50)
t.setheading(0)
t.pendown()
t.forward(STEP)
for turn in turns:
    if turn == 1:
        t.right(90)
    else:
        t.left(90)
    t.forward(STEP)
`),
  },
  {
    id: 'tree',
    label: 'Fractal tree',
    description: 'Two shorter branches grow from each branch.',
    code: wrap(`
DEPTH = 9
TRUNK = 125
ANGLE = 24
SHRINK = 0.77

def tree(length, depth):
    if depth == 0:
        return
    t.pensize(max(1, depth * 0.9))
    t.pencolor("#6b4a2b" if depth > 3 else "#3f8f3a")
    t.forward(length)
    t.left(ANGLE)
    tree(length * SHRINK, depth - 1)
    t.right(2 * ANGLE)
    tree(length * SHRINK, depth - 1)
    t.left(ANGLE)
    t.penup()
    t.backward(length)
    t.pendown()

t.penup()
t.goto(0, -290)
t.setheading(90)
t.pendown()
tree(TRUNK, DEPTH)
`),
  },
  {
    id: 'hilbert',
    label: 'Hilbert curve',
    description: 'A space-filling curve visiting every cell of a grid.',
    code: wrap(`
# The curve covers a 2 ** ORDER by 2 ** ORDER grid.
ORDER = 5
SIZE = 500
STEP = SIZE / (2 ** ORDER - 1)

def hilbert(level, angle):
    if level == 0:
        return
    t.right(angle)
    hilbert(level - 1, -angle)
    t.forward(STEP)
    t.left(angle)
    hilbert(level - 1, angle)
    t.forward(STEP)
    hilbert(level - 1, angle)
    t.left(angle)
    t.forward(STEP)
    hilbert(level - 1, -angle)
    t.right(angle)

t.penup()
t.goto(-SIZE / 2, SIZE / 2)
t.setheading(0)
t.pendown()
hilbert(ORDER, 90)
`),
  },
  {
    id: 'levy',
    label: 'Lévy C curve',
    description: 'Each segment becomes two segments at a right angle.',
    code: wrap(`
# Segments double with each DEPTH step.
DEPTH = 12
LENGTH = 220
ROOT2 = 2 ** 0.5

def levy(length, depth):
    if depth == 0:
        t.forward(length)
        return
    t.left(45)
    levy(length / ROOT2, depth - 1)
    t.right(90)
    levy(length / ROOT2, depth - 1)
    t.left(45)

t.pencolor("#2e7d32")
t.penup()
t.goto(-110, -90)
t.setheading(0)
t.pendown()
levy(LENGTH, DEPTH)
`),
  },
  {
    id: 'gosper',
    label: 'Gosper curve',
    description: 'A space-filling hexagonal curve from an L-system.',
    code: wrap(`
# Segments grow as 7 ** DEPTH.
DEPTH = 4
STEP = 8

rules = {
    "A": "A-B--B+A++AA+B-",
    "B": "+A-BB--B-A++A+B",
}

program = "A"
for _ in range(DEPTH):
    program = "".join(rules.get(c, c) for c in program)

t.pencolor("#2e7d32")
t.penup()
t.goto(64, 215)
t.setheading(0)
t.pendown()
for command in program:
    if command == "A" or command == "B":
        t.forward(STEP)
    elif command == "+":
        t.left(60)
    elif command == "-":
        t.right(60)
`),
  },
  {
    id: 'fern',
    label: 'Barnsley fern',
    description: 'An iterated function system plotted point by point.',
    code: wrap(`
import random

POINTS = 8000
SCALE = 55

random.seed(7)
t.penup()
t.pencolor("#2e7d32")
x = 0.0
y = 0.0
for i in range(POINTS):
    r = random.random()
    if r < 0.01:
        x, y = 0.0, 0.16 * y
    elif r < 0.86:
        x, y = 0.85 * x + 0.04 * y, -0.04 * x + 0.85 * y + 1.6
    elif r < 0.93:
        x, y = 0.2 * x - 0.26 * y, 0.23 * x + 0.22 * y + 1.6
    else:
        x, y = -0.15 * x + 0.28 * y, 0.26 * x + 0.24 * y + 0.44
    t.goto(x * SCALE, y * SCALE - 280)
    t.dot(2)
`),
  },
];

export const DEFAULT_PRESET = PYTHON_PRESETS[0];

export function findPreset(id) {
  return PYTHON_PRESETS.find((preset) => preset.id === id) ?? null;
}
