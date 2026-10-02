# Front door: a word Windows PowerShell 5.1 changed is refused

Capability `capability_7b7421be1a1b` (1 · Front door), with the launcher of `capability_199d7af33d32`
(8 · Setup check). Increment `increment_e95ceec15288`, decision ADR-0856, contract 1.12
(`contract_1efcd0067178`). Measured on the owner's laptop, Windows 11 arm64, 2026-10-02.

## What each caller hands the installed command

`probe.ts` installs the launcher, which passes its raw line on as `STORYTREE_COMMAND_LINE`, in front of a
script that records the words Node read and that line. It then starts it with nine words from three callers:

- Windows PowerShell 5.1, by `-EncodedCommand`;
- Git Bash;
- a program (Node's `spawnSync`, no shell).

`probe.txt` is what each heard.

- Git Bash and Node quote every word by Windows' standard rules: the whole word in quotes, and `\"` for a quote inside it.
- Windows PowerShell 5.1 wraps a word holding a space in quotes and leaves the quotes inside it bare. `'he said "website -> forest -> the rest" ok'` became six words; `'say "hi"'` became `say hi`; `'a"b'` became `ab`; `'C:\a folder\'` swallowed the next word.
- Two of PowerShell 5.1's changes look standard, so nothing can tell them:
  - `'"yes"'` arrives as `yes`.
  - `'--title="a b"'` arrives as `--title=a b`. That is also how a cmd.exe user rightly passes a value with spaces, so it must never be refused.

## The check

`check.ts` runs the front door's `changedByQuoting` (`src/handed.ts`) over every captured line; `check.txt`
is its output.
- **Reading.** For all 27 lines, the door's reading of the line by Windows' rules is exactly the words Node gave the script.
- **Verdicts.** It refuses exactly the five lines PowerShell 5.1 changed (a closing quote with text right after it, or a quote never closed), and acts on all the rest. A line whose reading is not the words that arrived is ignored.

## The command

`answers.ts` builds the command, puts the launcher in front of it, and gives it the same word from both callers. `answers.txt` holds both answers.
- **PowerShell 5.1.** The door refuses before acting, exit 1: `storytree did nothing: word 1 ("he said website") arrived with its double quotes changed, …`, saying to pass the text as `@<file>` or to write each inner quote as `\"`.
- **Git Bash.** The same word reaches the command whole: `storytree has no "he said "website -> forest" ok"`.

Contract 1.12's test (`src/launched.test.ts`) is the same journey on Windows CI.
