# Robot Workshop

Thirty missions teach direct wires, NOT (opposite), AND (both), OR (either), XOR
(exactly one), branching and multiple outputs. Every mission checks every input
combination. Any equivalent circuit passes, including extra working gates.
Machine previews respond immediately to switches; passing jobs sends the robot
down the delivery belt. Completion and efficient solutions earn separate praise.

Connect by tapping an output dot and then an input dot, or drag between them.
One output can branch. Tap a connected input without a selected output to remove
its wire. Add gates with the palette, drag their names to move them, or focus a
gate name and use arrow keys. Delete removes that gate. Undo (also Ctrl/Cmd+Z)
keeps twelve edits, including across saves. A phone bench scrolls horizontally;
Switches and Machines buttons jump to each end. The page scrolls vertically.

Endless orders use a seeded, engine-independent generator with three difficulty
levels, exhaustive reference-circuit checks and nonconstant goals depending on
every switch. Beginner logic has a finite set of truth functions, with different
settings and signal combinations. Larger jobs combine more gates and machines.
Free workshop has no win condition and all four gates.

Hints first demonstrate a failing switch combination, then point out unwired
inputs or gate behavior, then describe a build in steps. The job card shows all
required input/output cases. There are no moral scores or timed penalties.

Version 1 save checkpoints retain circuit, switches, gate selection, twelve-step
undo, mission/mode/seed/difficulty, earned progress, hint stage, success and menu/
job-card visibility. An unfinished wire gesture is cancelled on restore. Save
validation runs before any live state changes. Shared play uses the existing
single-controller adapter and private backup restoration. Observers never run
an independent logic simulation; their restored circuit renders from its data.
The robot animation pauses in menus, hidden pages and observer mode.

Run model tests with `node --test robot-workshop/engine.test.mjs`. Run focused
browser tests with `node tools/test-robot-workshop-browser.mjs`.
