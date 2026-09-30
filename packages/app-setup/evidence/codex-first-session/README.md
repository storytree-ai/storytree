# Codex's first session, before its hooks are trusted (increment_d911830f4957)

Run 2026-09-30 on the owner's Windows 11 Home x64 laptop (`ssh winlap`), storytree **0.3.337** installed,
Codex CLI **0.158.0** signed in, no Git or Node. The owner's own `~\.codex` (hooks trusted) was only read:
every trial used a **fresh `CODEX_HOME`** under `C:\Users\mickh\st-codexharden\home-<trial>`, holding a copy
of the sign-in and the one-time sandbox setup and **no hook trust** (`prep.ps1` counts `trusted_hash`
entries: 0), and a fresh project folder with a space in its name (`CH First <trial>`), set up as the
installer's folder step does (`storytree doctor --set-up`), then `storytree setup connect --codex`.
Codex ran in the owner's non-elevated desktop session through a one-shot interactive scheduled task
(`harness/lap.sh`, `run-interactive.ps1`; process_81a7122f6849), `codex exec … < $null`, with the prompt a
first user might type: "Make a hello.txt file here that says hi."

## What a first Codex session sees of storytree

Nothing, today. Codex 0.158 always defers MCP tools behind its tool search
(`codex features list`: `tool_search_always_defer_mcp_tools … true`, not switchable), and puts no
server instructions in the model's context: the session record's developer and user messages hold
skills, permissions, collaboration mode, plugins and the environment, and never the word storytree
(`harness/insp.ps1`). Asked to list its storytree tools without searching, the model had none
(`probe-tools.txt`). So the habits card (the tool server's instructions) and check_setup's description
("call it at the start of every session") never reach a Codex session, **trusted hooks or not**, and with
untrusted hooks no start hook runs either. What does reach every session is the `AGENTS.md` in Codex's home.

## The A/B

| Variant | Trials | check_setup before the first change | User told the trust step | Plain folder: storytree named or called |
|---|---|---|---|---|
| A: as released (no section) | `trial-A1…3` | **0 of 3** | 0 of 3 | (not run) |
| B: section in `CODEX_HOME\AGENTS.md`, first wording (`harness/agents-B.md`) | `trial-B1…3`, `plain-B1…3` | **3 of 3** | 3 of 3 | 1 of 3 named storytree in its narration ("I'll check for storytree setup"), 0 called it |
| C: B, plus "and do not mention it" for other folders (`harness/agents-C.md`, as shipped) | `trial-C1…3`, `plain-C1…3` | **3 of 3** | 3 of 3 | **0 of 3**: silent, one `hello.txt`, nothing set up |

`summary.txt` is `harness/summarise.sh` over every transcript. In the plain folder the section costs one
directory listing before the task.

## Still rough (not this increment's fix; parked on the arc)

- In every B and C trial the agent also wrote `.storytree-check` and ran `echo storytree-check`, because
  check_setup asks for the edit and command tests even when no hook of the session can be received until
  the user trusts them; the check file is then left behind (6 of 6). The fix is in check_setup's answer
  (capability 8, held by another session during this run).
- check_setup's trust sentence tells a user already inside Codex to "run `codex` in a terminal". Plainer
  words belong with increment_1c5f35121647 (the trust step shown where the user looks).
- In some trials the agent went on to plan a story for `hello.txt` (C1: 16 storytree calls). Over-eager,
  not harmful; worth watching in the first-build test (increment_44bd7a583f32).

## Left on the laptop

`C:\Users\mickh\st-codexharden` (the harness, the fresh homes and raw output) and the folders
`C:\Users\mickh\CH First …` and `CH Plain …`; the projects `ch-first-a1…c3` in storytree. The owner's
`~\.codex` is unchanged. No scheduled tasks left.
