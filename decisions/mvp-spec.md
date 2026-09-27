# The 0.3 MVP one-page spec

- **Front cover of:** none
- **Full record:** ADR-0625 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0625`)

Storytree 0.3 sits beside a vibecoder's own Claude Code or Codex and shows, as a forest, what it builds.

The MVP is for one person starting a brand-new project, who may run several projects, each its own
forest in the same app. The app is tied to no project. Storytree never runs the user's agent and
never calls an AI model itself: the user's own agent writes every plain-language description as it
plans. Everything stays on the user's computer, apart from feedback the user chooses to send.

The first ten minutes: one command installs storytree and connects its tool server to Claude Code or
Codex. At the first session start storytree asks whether to set the folder up as a project, and the
agent fires a test of each hook; the connection shows as verified only when every one arrives. The
agent then plans an arc and its stories, claims a part, works red then green, reports each step, and
reports the part landed. Health shows what the agent reported, labelled as the agent's. Clicking a
tree shows the story and each part in two plain sentences, a small diagram, and each part's shelf of
decisions. Edits made without a claim show as unplanned activity, and a second folder gives a second
forest.

The order: the agent link first; then the arc surface, the forest and this project's own library in
parallel; then cutover, when storytree's own development moves onto 0.3 and 0.2 becomes read-only;
then install and first run; then first users. The forest is wanted before cutover but does not
block it. Verified health was dropped from the MVP by a later decision the same day. Sessions may
re-order within the dependencies, telling the owner rather than asking.

Out of the MVP: mapping an existing codebase, 0.2's build machinery as a product feature, the
terminal, the view of where agents go in the knowledge (its read record is in), a screen for
browsing artifacts, acceptance walkthroughs, mutation testing and test-quality judging, anything hosted,
art research, showing 0.2's forest, and any paid tier.

The owner reviews each story's capability tree before any code, and answers the reviews one at a
time. There are no separate increments inside 0.3: an arc is a list of stories, and landing is
reported per capability.

Windows first, on x64 and arm64. The code stays cross-platform and CI also runs on macOS, so Mac
support later is packaging rather than porting; Mac packaging and signing wait for a first user who
needs them.
