# Sea lane options: the shared brief

Mick (the owner), on round 11 of the capability-tree map mock (`../h-quiet-roads/`, read its README first):

> This looks really good and makes me think we can actually put the capability tree on the map, removing the need for it
> being in the story panel, it just needs more iterations to deal with the crowding. before we kick off round 12 for this i
> think we need to mock up the sea lane. I like the idea of a sea lane, and so i think we do options for how this is
> represented, gut feel is shipping route feel not a pathway but i'm open to ideas on what analogy we anchor to as well as
> how its represented. atm it looks quite disjointed. from the island.

## What a sea lane is

When a story (an island) is selected, the map draws the links between it and other stories over the sea: purple
(`#6a5fee`, "down") for other stories' capabilities calling this one's, teal (`#0d8fb0`, "up") for this story calling
out. They share stretches and branch toward each island (`packages/forest-world/src/planet/lanes.ts`, the
`pathways:selection-lanes` group; the wide translucent tan band under them is also the map's, find what draws it). For
The library: 196 links from 20 stories arrive on one sea road at the mouth; one link leaves from Connection by address to
Keys. Round 11's overlay (`tools/overlay.ts`) hides the lanes over the land and draws the island's own roads: a faint
sandy track (`#e2d3aa` mixed 70% into the land), plateaus 1.3 above open land, ramps, standing gate posts.

What is wrong now, from `../h-quiet-roads/stills/mouth-close.png` and `resting.png`: the sea lanes are loud purple and
teal against the quiet sandy roads, they stop just short of the shore, and the tan band does not meet the island's
roads, so the sea and the land read as two systems.

## Your job

Make TWO options, each a different analogy, given in your brief below. Each option: how a link between islands is drawn
at sea, and how it joins the island (the landing at the mouth where it meets the sandy trunk, and at Keys' landfall for
the way out). Keep what the lanes mean readable: in versus out (colour or another cue), how much a route carries (width or
another cue), sharing and branching toward each island. Keep it LOW KEY: Mick finds loud styles fail ("prev variations
fail because they all too loud"); he rejected walls and fences as ugly. The island's look (round 11) stays as it is.

## How

Copy `../h-quiet-roads/` (tools, index.template.html, page.css) into your own folder `i-sea-lanes/<your-folder>/` and
point its imports at `../../h-quiet-roads/data.json` and `layout.json` rather than copying those. Fix the paths in
build.mjs and look.mjs comments. Add a `?sea=<key>` choice in your copy's overlay (or your own module beside it) for your
two options; hide or restyle the map's own lanes and tan band and draw yours, reading the lanes' geometry from the map's
lane objects (their userData names each end) so routes go where the map sends them. Build with your copy's build.mjs and
take stills with its look.mjs (wheel, drag and key steps frame a view; `--retake` writes into your stills folder).

For each option take at least: `<key>-rest.png` (the whole island selected, at rest, its neighbours' lanes in view) and
`<key>-mouth.png` (the mouth close up, as round 11's mouth-close.png). Open every still with the Read tool and check it
yourself before you return; fix and retake until it is right.

Work only inside your own folder in this worktree: `C:\code\storytree03\.claude\worktrees\increment-7110371d3553-a663a6`.
Do not commit or push; the session that started you does. Other agents work in sibling folders at the same time.

## Return

A short digest: your stills' absolute paths; per option, the analogy in one line, what it draws (colours, widths, marks,
the landing), and what works and what does not, said plainly. The owner judges the pictures.
