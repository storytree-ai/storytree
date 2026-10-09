---
name: grill-me
description: "Grill me: walk the owner through storytree's open questions one at a time, arc by arc, re-onboarding him on each with a diagram and an analogy so he can answer in one line, then record each answer in his own words and send the work it unblocks to the Mint box. Use when he says \"grill me\", \"drip feed me the open questions\", \"arc by arc\", \"reonboard me\", \"walk me through the open questions\", \"talk me through the questions waiting on me\", \"any open questions I need to answer\" or \"next Q\", or asks for diagrams and analogies to help him decide; also for one named question (\"reonboard me on this question\")."
---

<!-- GENERATED from the library's "Grill me: walk the owner through his open questions" process; do not edit by hand. Regenerate with `pnpm build:guidance`; `pnpm check:guidance` fails when this file has drifted from the library. -->

# Grill me: walk the owner through his open questions

The owner answers storytree's open questions in bursts, often after time away and jumping between sessions. Make each answer cheap: check the question still deserves him, re-onboard him just enough, give him a clean choice with your recommendation, record what he says exactly, and turn it into moving work before you show him the next one. Find facts yourself; ask him only for decisions. He sets the pace.

Written from 22 rounds he ran between 2026-08-22 and 2026-10-01 and the corrections that recurred in them (the evidence is on increment_10685cb18bc4). The name and a few techniques (facts found rather than asked, questions taken in dependency order, checks run in the background, a stated end) come from Matt Pocock's grill-me skill (github.com/mattpocock/skills), whose rounds stress-test a plan the user brings; this one works the questions already waiting in the library.

## When to use

He asks to be walked through the open questions (all of them, an arc's, or one named question), to be re-onboarded so he can answer, or to be "grilled". Not for a status report ("where are we?"): answer that directly. Not for interviewing him about a new plan he has not written down yet: that is ordinary conversation, and what comes of it is written up as step 5 says.

## Steps

### 1. Before the first question: a list that deserves him

1. Read `storytree adr list --load-bearing` (once per session), then `storytree question list` and `storytree arc waits` (what waits on him or on an outside event).
2. **Check every question is still live** before it reaches him; stale premises were the commonest correction (13 times). Check the first one or two yourself so he is not kept waiting, and hand the rest to a background subagent that reports back before you reach them. For each question:
   - its arc is **not parked** (ADR-0835). If it is, retire the question and move its substance into the arc's increment body, clearing any increment held on it; list it as "parked, skipped".
   - it was **not already answered**: settled questions and re-steers on the same arc, decisions since it was raised, anything he said in another session that day.
   - it was **not overtaken**: the held increment is still open, and no merged pull request, measurement or other session already answers it (`gh pr list --state merged --search …`, the increment bodies, recent friction). If a measurement changes the question, lead with that fact.
   - it is **above the owner-fork bar** and **not a standing delegation**. A reversible engineering call, a "can a session do this itself?", or a premature "decide later" is decided and recorded by you, not asked.
   - it is **not "does it look right?"** (ADR-0794): a built look lands with its pictures and he raises what looks wrong. Propose retiring these.
3. **Order by dependency.** A question whose framing depends on another open one waits until that one is answered; after each answer, look again at what is now askable. Otherwise go arc by arc.
4. **Open with an overview table**, answer first: "N questions and W waits across M arcs, each checked live." Read `storytree arc waits` as well as the question list, and put every wait in the table alongside the questions, even when there are no questions. Columns: # · Kind (design call / credential only you can create / spend / probably shouldn't exist / owner action / event) · Arc · Question or wait in plain words. Put the ones you would retire in the table with the reason, so one "yes, retire" clears them. Say which are coupled and will be taken together. Then go straight into question 1 in the same message, or, with no questions, the first owner action.
   - An **owner action** wait: its note is the ask. When he says it is done, clear it with `storytree arc increment unwait <increment> --for owner`; never clear it on your own reading.
   - An **event** wait: show its note, arc and check-back day, and flag it **overdue** once that day has passed. An overdue event is a prompt to check, never a reason to clear it: clear it (`--for event`) only when the event has actually happened.

### 2. Each question: one message he can answer in one line

Skip a part only when it truly adds nothing.

- **Heading:** `Question n of N: <the decision in plain words>`.
- **Where it stands, only when the arc changes:** 3 to 6 bullets: what has landed, what is parked, what this answer unblocks. Same arc: say "same arc, no re-orientation".
- **The problem, stakes first:** what broke or is blocked, with the date or incident that raised it; then what is already true or fixed, so he decides only what is left.
- **Terms:** gloss only the machine vocabulary he lacks (tool names, lifecycle states, decision numbers), naming each thing by what it does, id in parentheses at most. He set the project: never re-explain it.
- **Diagram** when the subject is a structure, a flow or a before/after: a small ASCII block in a code fence. Offer it unasked; being asked for one is the failure signal. An HTML mock or artifact only for the most complex cases.
- **Analogy**, one line, then **Where it breaks:** one line.
- **Options**, lettered (coded per question, `N1`/`N2`, when questions share a message): what happens, *For*, *Against*; a table for three or more, or after a reframe. Before sending, challenge your own framing (8 corrections came from here): is an obvious option missing ("the system already does this", "a session does it itself", "both", "the simplest version first")? Are the options really exclusive? Is one overbuilt for what he asked? "Leave it as is" is a valid answer, recorded as decided.
- **My recommendation (non-binding):** the pick, one sentence why, and what would flip it.
- **The ask, last line, bold:** "**A, B or C?**". Coded options let him answer "A for 2, NO for 4".

Keep every option's description in the same message as the ask. When a question is reframed, split by a digression or followed by status updates, re-post all its options in one place before asking again. The available choice picker is fine for a quick pick after the full text, never as the only place the options live; his free text always wins, and if he dismisses the picker, record nothing he did not say.

### 3. Pace

- One question per message; a coupled pair together when it is one problem (say so).
- He drives: "next", "next arc", "next Q". After each answer do the writes (step 4), give a 2 to 4 line receipt (what was recorded, what started), then the next question in the same message.
- When he asks back ("still not following", "what do you mean by…"), answer that first from a new angle: a concrete example, another analogy, a diagram. If his "why is this a question?" is right, say so, decide or retire it, and move on.
- When he proposes his own direction, check it honestly against the facts (measurements, landed work) before agreeing, leading with any fact that changes it. If he directed it, record it without asking again; if he is thinking aloud, confirm in one line ("Go ahead, or anything to change first?").
- Interruptions (status checks, lane crashes, credentials) get short answers, a table for lane status, and end with **"Still with you: Qn, A/B/C?"**
- Re-run `storytree question list` at each arc boundary and before you say "that's all": sessions file new questions during the round (7 corrections came from a stale list).

### 4. After each answer, before the next question

Library edits need no worktree.

1. **Settle with his exact words:** `storytree question settle <q> --answer @answer.txt [--decision <decision>]`, verbatim, with the date. Your interpretation goes in the increment body, not the answer. A question on a parked arc he says to skip is retired, not settled.
2. **Rewrite the held increment's body** (`storytree arc increment edit <inc> --body @body.md`): lead with `OWNER'S ANSWER <date> (<question id>): "<his words>"`, then what it means for the build, so the lane that picks it up needs nothing from this chat. Clear `--held-on` if it still names the question. Close increments his answer made moot (`--disposition withdrawn` with the reason) and park the new ones it creates.
3. **Write the decision** when the answer sets a rule future sessions must follow or narrows a standing one (step 5), with an in-place note in any decision it narrows, in the same pass.
4. **Record a re-steer** (`storytree resteer new … --evidence "<his words>" --disposition defect|taste --judged-by owner`) when he picked neither option, reframed the question, or said it should not have reached him. Your own account goes in `--self-report`.
5. **Retire what should not exist** (`storytree question retire <q> --reason …`), keeping its substance on the arc. Never retire an answered question: settle it.
6. **Dispatch** (step 6). Message any session that was blocked on what he just fixed, once the fix is proven to work.

### 5. Writing up decisions: accepted or proposed

- **Accepted** when he decided: he picked an option, said "record it that way" or "go with your recommendation", or stated a rule. Born accepted (ADR-0829): `storytree adr new --title … --text @adr.md --status accepted --basis owner-directed --owner-said @said.txt`. Never ask him to ratify what he already decided.
- **Proposed** when he is thinking aloud: "I imagine…", "in the future we would…", "not sure yet", a model of how something should work that no increment builds yet (his collaboration model, ADR-0830, is the example). Write it `--status proposed`, say in the text that it is his current thinking recorded while he explores and not a build commitment, list the open points, and link the arc where it would be shaped. Do this unprompted: he expects his thinking kept for future sessions.
- Not every answer needs a decision: a pick among options inside a standing decision lives on the settled question and the increment body.
- His words go verbatim in `ownerSaid`, the answer and re-steer evidence; a paraphrase there is a defect. Keep accepted text free of meeting minutes: the decision, its reasons, what it narrows.
- Read the why of any decision an answer collides with. Decisions are not law: if his answer overturns one, write a new decision that supersedes it, not a workaround.

### 6. Dispatch: keep the Mint box busy

He asks for this in most rounds: send everything safe and ready, not only what his answer unblocked.

1. After each answer, or each arc, have a subagent list ready increments: open, unclaimed, not waiting, needing neither the laptop nor him (`storytree arc list`, `arc show`).
2. Check what already runs on the Mint box and which claims other sessions hold, so two dispatchers never feed it the same increment.
3. Launch each lane with a self-contained brief and a file fence that keeps it out of running lanes' files; queue a lane that overlaps behind the one it collides with.
4. Confirm each lane claimed its increment, then tell him in a short table: lane, work, state. Laptop-only work (Windows app checks, his live attestations) is listed as his, not dispatched.

### 7. Owner-only actions (credentials, applies, spend)

Before asking him to act, find every requirement first (org policy, every permission, the resource owner, expiry limits) and give the complete steps once, with the exact command. Test what he provides before storing it, never print a secret, and switch back off anything you enabled if it fails, so no lane is left stuck. Each extra round trip costs his attention (one credential once took five).

### 8. Ending the round

The round is over when the refreshed question list and `storytree arc waits` hold nothing for him that was not shown, or when he stops it. Re-check both, then a short summary: each question, his answer and what it became (settled, decision number, increment, lane), what is still waiting on him, and what is running. Close out per the session role: friction for what fought you, claims released, `storytree processes` clean, `storytree session close-out --safe yes|no --why …`.


## Surfaces

Both front doors work (ADR-0793). Command line: `storytree question list | settle | retire | check`, `storytree arc list | show | waits`, `storytree arc increment edit | close | new | unwait`, `storytree adr list --load-bearing | new`, `storytree resteer new`, `storytree friction new`, `storytree session close-out`. Agent link: `show_plan`, `settle_question`, `retire_question`, `correct_question`, `raise_question`, `edit_plan`, `clear_wait`, `record_resteer`, `close_out`. The Mint box: `ssh mint` and its lane launcher. Use the available choice picker for a quick pick after the full text. `gh pr list` to check what already landed.

## Failure modes

What he corrected across 22 rounds, most first: a stale premise, already answered, overtaken or measured (13); too little re-onboarding or an unglossed term (12); a question below the owner-fork bar that a session should have decided (10); options missing the obvious one, a false either-or or an overbuilt pick (8); a list not refreshed mid-round (7); "does it look right?" questions (6); options he could not find, or too much reading (3); owner-only steps given incompletely, costing round trips (2 rounds, 5 trips); a question on a parked arc (2); a decision treated as law rather than read for its why (1). Also: two dispatchers feeding the Mint box the same increments (friction_f1d70ab6f779), and an answer paraphrased where his words belonged.

## Verification

Every question he answered is settled with his words and its increment body rewritten; every question that should not have reached him is retired with its substance kept on the arc; the question list, re-run at the end, holds nothing for him that was not shown; each dispatched lane has claimed its increment; and the closing summary lists every question with what it became.

## Stands on

Notes in the library; find one by its title with the agent link's `search_notes`.

- Register follows audience
- Plain language first
- The owner-fork bar: escalate ownership, not uncertainty
- Standing delegation
- Escalate inline, or on a named signal
- A human's words are stored verbatim, or not at all
- A built look lands with its pictures; the owner is not asked whether it looks right
- Agreeing at design time is the ratification: a decision the owner directed is born accepted (0.2's ADR-0110)
- A parked arc raises no questions
- Parallel build-lane fan-out
