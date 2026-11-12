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
  {
    id: 'montyhall',
    label: 'Monty Hall',
    description: 'Simulates the three-door game and compares staying with switching.',
    code: wrap(`
import random

GAMES = 5000        # games played for each strategy
DOORS = 3           # try 5 or 10: switching wins (DOORS - 1) / DOORS of the time

random.seed(11)

def play(switch):
    """One game. Returns True if the contestant wins the car."""
    car = random.randint(0, DOORS - 1)
    pick = random.randint(0, DOORS - 1)
    # The host opens every other door except one, never the car and never the pick.
    if pick == car:
        others = [d for d in range(DOORS) if d != pick]
        kept = random.choice(others)
    else:
        kept = car
    final = kept if switch else pick
    return final == car

stay_wins = 0
switch_wins = 0
for _ in range(GAMES):
    if play(False):
        stay_wins += 1
    if play(True):
        switch_wins += 1

stay = stay_wins / GAMES
switch = switch_wins / GAMES
print("Stay:   " + str(stay_wins) + " wins of " + str(GAMES) + " = " + str(round(stay * 100, 1)) + "%")
print("Switch: " + str(switch_wins) + " wins of " + str(GAMES) + " = " + str(round(switch * 100, 1)) + "%")
print("Theory: stay " + str(round(100 / DOORS, 1)) + "%, switch " + str(round(100 * (DOORS - 1) / DOORS, 1)) + "%")

# Bar chart: 100% is 400 pixels tall.
BASE = -200
HEIGHT = 400
WIDTH = 150

def bar(x, fraction, colour, label):
    t.penup()
    t.goto(x, BASE)
    t.setheading(0)
    t.fillcolor(colour)
    t.pencolor("#333333")
    t.pendown()
    t.begin_fill()
    t.goto(x + WIDTH, BASE)
    t.goto(x + WIDTH, BASE + HEIGHT * fraction)
    t.goto(x, BASE + HEIGHT * fraction)
    t.goto(x, BASE)
    t.end_fill()
    t.penup()
    t.goto(x + WIDTH / 2, BASE + HEIGHT * fraction + 6)
    t.write(str(round(fraction * 100, 1)) + "%", align="center", font=("Arial", 14, "bold"))
    t.goto(x + WIDTH / 2, BASE - 26)
    t.write(label, align="center", font=("Arial", 14, "normal"))

bar(-190, stay, "#d97706", "Stay")
bar(40, switch, "#2e7d32", "Switch")

# Dashed lines mark the theoretical win rates.
def theory(fraction):
    t.pencolor("#555555")
    t.penup()
    t.goto(-230, BASE + HEIGHT * fraction)
    t.setheading(0)
    for _ in range(23):
        t.pendown()
        t.forward(10)
        t.penup()
        t.forward(10)

theory(1 / DOORS)
theory((DOORS - 1) / DOORS)

t.penup()
t.pencolor("#1f5124")
t.goto(0, 250)
t.write("Monty Hall, " + str(DOORS) + " doors, " + str(GAMES) + " games each", align="center", font=("Arial", 16, "bold"))
`),
  },
  {
    id: 'dice',
    label: 'Pairs of dice',
    description: 'Rolls many pairs of six-sided dice and plots how often each total comes up.',
    code: wrap(`
import random

ROLLS = 36000       # pairs of dice to roll
SIDES = 6

random.seed(3)

lowest = 2
highest = 2 * SIDES
counts = {}
for total in range(lowest, highest + 1):
    counts[total] = 0

for _ in range(ROLLS):
    total = random.randint(1, SIDES) + random.randint(1, SIDES)
    counts[total] += 1

# Expected count for a total is ROLLS * ways / SIDES ** 2, where ways is how many pairs add up to it.
def expected(total):
    ways = SIDES - abs(total - (SIDES + 1))
    return ROLLS * ways / (SIDES * SIDES)

peak = max(max(counts.values()), max([expected(k) for k in counts]))
BASE = -220
HEIGHT = 420
BAR = 40
LEFT = -(BAR * (highest - lowest + 1)) / 2

for total in range(lowest, highest + 1):
    x = LEFT + (total - lowest) * BAR
    top = BASE + HEIGHT * counts[total] / peak
    t.penup()
    t.goto(x + 2, BASE)
    t.setheading(0)
    t.fillcolor("#55a346")
    t.pencolor("#1f5124")
    t.pendown()
    t.begin_fill()
    t.goto(x + BAR - 2, BASE)
    t.goto(x + BAR - 2, top)
    t.goto(x + 2, top)
    t.goto(x + 2, BASE)
    t.end_fill()
    t.penup()
    t.goto(x + BAR / 2, top + 4)
    t.write(str(counts[total]), align="center", font=("Arial", 9, "normal"))
    t.goto(x + BAR / 2, BASE - 22)
    t.write(str(total), align="center", font=("Arial", 12, "normal"))

# The orange line joins the expected counts.
t.pencolor("#d97706")
t.pensize(2.5)
t.penup()
for total in range(lowest, highest + 1):
    x = LEFT + (total - lowest) * BAR + BAR / 2
    t.goto(x, BASE + HEIGHT * expected(total) / peak)
    t.pendown()

t.pensize(1.5)
t.pencolor("#1f5124")
t.penup()
t.goto(0, 250)
t.write(str(ROLLS) + " rolls of two dice (orange: expected)", align="center", font=("Arial", 16, "bold"))
t.goto(0, BASE - 50)
t.write("Total of the two dice", align="center", font=("Arial", 12, "normal"))
print("Most common total:", max(counts, key=lambda k: counts[k]))
`),
  },
  {
    id: 'orbit',
    label: 'Two stars in orbit',
    description: 'Newtonian gravity between two stars, integrated with the leapfrog method.',
    code: wrap(`
import math

# Distances are in pixels and times in steps. The trails show each star's path.
G = 5.0
M1 = 1.0            # mass of the blue star
M2 = 0.5            # mass of the orange star
SEPARATION = 200.0  # starting distance between the stars
SPEED = 0.8         # 1.0 is a circular orbit; below 1 gives an ellipse, above 1.41 escapes
STEPS = 8000        # about two orbits
DT = 1.0
SCALE = 1.6

total = M1 + M2
# Start on the x axis, in the centre-of-mass frame, with velocities along y.
x1 = -SEPARATION * M2 / total
x2 = SEPARATION * M1 / total
y1 = 0.0
y2 = 0.0
relative_speed = SPEED * math.sqrt(G * total / SEPARATION)
vx1 = 0.0
vx2 = 0.0
vy1 = -relative_speed * M2 / total
vy2 = relative_speed * M1 / total

def acceleration(ax, ay, bx, by, mass):
    """Acceleration of a body at (ax, ay) due to a mass at (bx, by)."""
    dx = bx - ax
    dy = by - ay
    r2 = dx * dx + dy * dy + 1.0
    r = math.sqrt(r2)
    k = G * mass / (r2 * r)
    return k * dx, k * dy

trail1 = turtle.Turtle()
trail2 = turtle.Turtle()
for trail, colour in [(trail1, "#2563eb"), (trail2, "#d97706")]:
    trail.hideturtle()
    trail.speed(0)
    trail.pensize(1.5)
    trail.pencolor(colour)
    trail.penup()

trail1.goto(x1 * SCALE, y1 * SCALE)
trail2.goto(x2 * SCALE, y2 * SCALE)
trail1.pendown()
trail2.pendown()

# Leapfrog: half kick, drift, half kick.
a1x, a1y = acceleration(x1, y1, x2, y2, M2)
a2x, a2y = acceleration(x2, y2, x1, y1, M1)
for step in range(STEPS):
    vx1 += a1x * DT / 2
    vy1 += a1y * DT / 2
    vx2 += a2x * DT / 2
    vy2 += a2y * DT / 2
    x1 += vx1 * DT
    y1 += vy1 * DT
    x2 += vx2 * DT
    y2 += vy2 * DT
    a1x, a1y = acceleration(x1, y1, x2, y2, M2)
    a2x, a2y = acceleration(x2, y2, x1, y1, M1)
    vx1 += a1x * DT / 2
    vy1 += a1y * DT / 2
    vx2 += a2x * DT / 2
    vy2 += a2y * DT / 2
    if step % 4 == 0:
        trail1.goto(x1 * SCALE, y1 * SCALE)
        trail2.goto(x2 * SCALE, y2 * SCALE)

for x, y, colour, size in [(x1, y1, "#2563eb", 16), (x2, y2, "#d97706", 11)]:
    t.penup()
    t.goto(x * SCALE, y * SCALE)
    t.dot(size, colour)

energy = 0.5 * M1 * (vx1 * vx1 + vy1 * vy1) + 0.5 * M2 * (vx2 * vx2 + vy2 * vy2)
energy -= G * M1 * M2 / math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2 + 1.0)
print("Total energy at the end:", round(energy, 5))
`),
  },
];

export const DEFAULT_PRESET = PYTHON_PRESETS[0];

export function findPreset(id) {
  return PYTHON_PRESETS.find((preset) => preset.id === id) ?? null;
}
