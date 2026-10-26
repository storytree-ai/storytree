# Wiring your own harness to storytree

**Interface version 1.** This page is for anyone who builds their own coding-agent harness and wants
storytree to watch its sessions. Storytree ships nothing for your harness: you call storytree's hook
script from your own events, with the input described here.

## Connected or watched

- **Connected.** Add storytree's tool server to your harness's MCP client (the setup check, `check_setup`
  or `storytree doctor`, prints the server entry to add). Your agent can then use the plan, claims, the
  library, questions and reviews. Storytree does not see the session's edits or commands.
- **Watched.** Also call the hook script, as described below. Storytree then also sees the session in its
  sessions list, with its edits, commands and turns, and can refuse an edit to a capability another
  session holds. In version 1 it reads no transcript from your harness, so a watched session of yours has
  no context reading and ships no transcript.

The setup check does not yet verify a harness of your own by its hooks: `check_setup` still reports it as
connected. `storytree session list` shows whether your session is watched.

## The command

The hook script is `storytree-hook.mjs`. It sits in the same folder as `storytree-mcp.mjs`, the tool server
in the server entry, and runs with the same Node:

```
<node> <folder>/storytree-hook.mjs <your-harness-name>
```

- **Your harness's name** is how storytree names its sessions. Use letters, digits, `.`, `_` and `-`, starting
  with a letter or digit, up to 64 characters. Prefer the name your MCP client gives itself (`clientInfo.name`).
  The built-in names `claude-code`, `codex`, `cursor` and `pi` are taken, and so is `statusline`.
- **The input** is one JSON object on standard input. Close standard input when you have written it.
- **The exit code** is always 0, whatever happens. The hook never breaks your agent. If storytree is not
  running, or the folder is not a storytree project, the hook writes nothing.
- **Time.** A hook gives up after 5 seconds. You do not need to wait for it, except for the edit gate below.

## The events

Every input carries these three fields:

| field | what it is |
|---|---|
| `session_id` | your session's id, the same on every event of that session |
| `cwd` | the folder the session works in, as an absolute path |
| `hook_event_name` | one of the six events below |

| event | when to send it | extra fields read |
|---|---|---|
| `SessionStart` | the session starts | `source` (optional: `startup`, `resume`, …) |
| `UserPromptSubmit` | the user sends a prompt | none; the prompt's words are not stored |
| `PreToolUse` | just before a tool call (see below) | `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | just after a tool call | `tool_name`, `tool_input`, `tool_use_id` (optional) |
| `Stop` | the agent finishes its turn | none |
| `SessionEnd` | the session ends | `reason` (optional) |

Other fields are ignored, and so are other events.

### Saying what a tool call is

Storytree does not guess from your own tool names. Give each call storytree should see one of these
names in `tool_name`. Leave every other call out, or send it under its own name, which storytree ignores.

| `tool_name` | means | `tool_input` |
|---|---|---|
| `Bash` | a shell command | `command`: the command line, as one string |
| `Edit` | an edit to one file | `file_path`: the file |
| `Write` | a file written whole | `file_path`: the file; `content`: its whole new text |
| `mcp__storytree__<tool>` | a call to one of storytree's tools, such as `mcp__storytree__check_setup` | anything |

- A `Bash` call: send `PreToolUse` with a `tool_use_id` and storytree records that the command started; send
  `PostToolUse` with the same id and it records that it finished. A command that failed is still sent as `PostToolUse`.
- An `Edit` or `Write`: send `PostToolUse` once the file is written. Several files make several events.
- A storytree tool: send `PreToolUse` with a `tool_use_id` just before the call.

To make storytree's tool calls count for the same session as your hooks, give the tool server the
session's id: start it with `STORYTREE_SESSION_ID=<session_id>` in its environment, or send
`_meta.sessionId` with each tool call. Run `storytree` commands in the session's shell with
`STORYTREE_SESSION_ID` set too.

## The edit gate

Before an `Edit` or `Write`, run the hook again with `--edit-gate` and the `PreToolUse` input, and wait for it:

```
<node> <folder>/storytree-hook.mjs <your-harness-name> --edit-gate
```

- Prints nothing: the edit may go ahead.
- Prints one JSON object: the edit is refused. Do not make it, and show `reason` to your agent:

```json
{"decision":"block","reason":"…","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}
```

The exit code is 0 either way. The gate gives up after 3 seconds and lets the edit go ahead.

## A worked example

This shell script sends one short session, as a harness named `my-harness` would. Set `HOOK` to your
`storytree-hook.mjs` and run it in a storytree project's folder.

```sh
#!/bin/sh
HOOK="${HOOK:?set HOOK to the path of storytree-hook.mjs}"
NAME=my-harness
SESSION="my-harness-$(date +%s)"
DIR="$(pwd)"

send() { printf '%s' "$1" | node "$HOOK" "$NAME" "$2"; }

send "{\"session_id\":\"$SESSION\",\"cwd\":\"$DIR\",\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}"
send "{\"session_id\":\"$SESSION\",\"cwd\":\"$DIR\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"try storytree\"}"

# A command, before and after.
send "{\"session_id\":\"$SESSION\",\"cwd\":\"$DIR\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"echo hello\"},\"tool_use_id\":\"call-1\"}"
echo hello
send "{\"session_id\":\"$SESSION\",\"cwd\":\"$DIR\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"echo hello\"},\"tool_use_id\":\"call-1\"}"

# An edit: ask the gate first, then report it.
EDIT="{\"session_id\":\"$SESSION\",\"cwd\":\"$DIR\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$DIR/notes.txt\"},\"tool_use_id\":\"call-2\"}"
REFUSAL="$(send "$EDIT" --edit-gate)"
if [ -n "$REFUSAL" ]; then
  echo "refused: $REFUSAL"
else
  echo "a note" >> notes.txt
  send "{\"session_id\":\"$SESSION\",\"cwd\":\"$DIR\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$DIR/notes.txt\"},\"tool_use_id\":\"call-2\"}"
fi

send "{\"session_id\":\"$SESSION\",\"cwd\":\"$DIR\",\"hook_event_name\":\"Stop\"}"
send "{\"session_id\":\"$SESSION\",\"cwd\":\"$DIR\",\"hook_event_name\":\"SessionEnd\",\"reason\":\"exit\"}"
```

`storytree session list` then shows a session of `my-harness`, watched, with its command and its edit.
Paths with quotes or backslashes need escaping in JSON; a real harness builds the input with a JSON library.

## Versions

This is version 1. Storytree treats this input as a public interface: adding an optional field or event
is not a breaking change, but renaming or removing one, or changing what an answer means, is. A breaking
change would come as a new version that your harness chooses with a flag on the command, so a harness
wired to version 1 keeps working until it changes. It would be announced in the release notes of the
release that ships it, and on this page.
