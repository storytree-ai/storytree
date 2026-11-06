# The map pointer's edge marker, and pointing at a gate (3.89, 5.9; question_97c6d6036e47, answered E)

The second step of the pointer (the first is `../agent-pointer`). The real desktop page on storytree's own map (the
code-rows snapshot and its survey), the capability tree arc selected in the stand-in bridge (its open increment names
Running sessions and Story node render, both on The forest), and two working sessions in the agent log:

- **A** points at Running sessions, which the arc names.
- **B** points at the gate between Story node render and Agent capability claims (`point_at` with `gate`, contract 4.44),
  for a question.

What this step draws:

- **An edge marker (3.89).** A pointer whose mark lies past the canvas's edge gets a round marker at the edge nearest it,
  as a failing island's does (3.11): a dark disc ringed in the session's colour, with a ◎ like the pulse it stands for.
  Two that lie the same way are set apart along the edge, so each can be clicked. A click pans to the pointer's island, the
  user's act; nothing the agent does moves the camera, measured across three seconds with both pointers past the edge
  (`cameraBefore` and `commandLine.camera` in `measurements.json`). Once the pointer is in view its marker goes.
- **A gate's pulse (5.9).** A pointer at a gate pulses at the gate's posts, the same rings in the session's colour as a
  capability's pulse at its foot, keyed by its pair (`territory-pointer:<a>|<b>`).

Pictures, 1440 x 960:

- `the-command-line-near.png`: The command line, near, with The forest past the top of the window: A's violet marker and
  B's pink marker side by side at the top edge.
- `the-forest-near.png`: The forest, near: A's pulse at Running sessions and B's pink pulse at the gate between Story node
  render and Agent capability claims; no edge marker for either.

Taken with `node --import tsx packages/forest/testing/view/agent-pointer-edge/capture.mjs --retake`, which also counts every
pointer pulse shown and every pointer edge marker, with its place and colour, into `measurements.json`.
