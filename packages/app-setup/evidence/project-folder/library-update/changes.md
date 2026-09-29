# Contract text (library fields, not repository files)

## Agent link · capability 8 · Setup check

**8.12** (`contract_4235a285f886`), title becomes:
> 8.12 · At the start of a session in a folder that isn't a storytree project, no hook adds anything to the agent's context, for Claude Code and for Codex, an older install's asking start hook included; nothing is set up (ADR-0752 D3).

**8.4** (`contract_9b9f96ef9ac4`), first sentence and last sentence become:
> 8.4 · In a folder that is not a project, check_setup says the folder is not a storytree project and that the user can add it (Add project in the app, `storytree doctor --set-up <name>`, or asking their agent), without telling the agent to offer setup (ADR-0752 D3), and nothing is created until the user asks. … The setup tools' input and output shapes remain the same (ADR-0657 D3).

(The middle sentences, on recording the project choice after a successful set-up and restoring the marker when that fails, are unchanged.)

**8.6** (`contract_d4824c7d28c5`), suggested wording where it says the sessions "set storytree up when answered yes":
> … each in a new empty folder set up as a project by the installer's folder step (or `storytree doctor --set-up`) …

## The app setup · capability 1 · Get storytree

**1.3** (`contract_d6bc20be3fdd`), title becomes:
> 1.3 · Repeating the command in the same or a second folder reuses the installation without replacing user settings or touching 0.2's installation or data; run from a folder that is already a project, its folder step says so and creates nothing.

**1.7** (new, capability `capability_790ee7f22546`):
> 1.7 · After connecting the agents, the one-line command asks for the project folder: Enter takes the folder it was run from (from the home folder or a drive root, Enter skips instead), a typed path is created if missing, and S skips, saying how to add a project later. The suggested name is the folder's and editable; a refused name is asked again. The chosen folder becomes a project exactly as the setup check's yes makes one (marker, library project, the app's project choice), and the app shows it (ADR-0752 D1).
