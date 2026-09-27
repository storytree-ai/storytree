/** One offline guide; the README and installation point here. No agent/project setup runs here. */
export const guide = `
  <h3>Start your first project</h3>
  <ol>
    <li><strong>Open your chosen agent in your project folder.</strong> After connecting Claude Code or Codex during installation, start a new session there. Storytree does not run the agent for you.</li>
    <li><strong>Say yes when asked.</strong> The agent checks setup and asks before creating a storytree project. Choose its name. Saying no leaves the folder unconfigured.</li>
    <li><strong>Let the connection check finish.</strong> Review any approval prompt from your agent for storytree tools, a small check-file edit or a command. Approve the check if you want to continue. Ask the agent to run <code>check_setup</code> again until it reports hooks verified: session start, tool call, file edit and command have reached storytree. Registered hooks alone are not verification.</li>
    <li><strong>Give the agent a small piece of work.</strong> Your new project appears in the running app. Its forest can start empty; a story and its capabilities appear as the agent plans them, with activity and health as work proceeds.</li>
  </ol>
  <h3>Add another project</h3>
  <p>Start a new agent session in a second folder and answer its setup question separately. Only a second yes creates a second project. The app refreshes its project list automatically; use the project picker to return to either forest.</p>
  <details><summary>Windows asks whether to trust the installer</summary>
    <p>This release is unsigned, so Windows may show an unknown-publisher or SmartScreen warning. Check that you obtained it from storytree-ai/storytree. If you choose to trust that download, use More info → Run anyway when offered. If your organisation blocks it, ask its administrator; do not disable Windows protection.</p>
  </details>
  <p>Connection incomplete? Check a folder below for setup diagnostics. This folder check does not register hooks or install the command; those checks will say “skipped”. Use <strong>Copy request for your agent</strong> to complete setup and verify hook receipt in your agent session.</p>
`;

export const recoveryRequest = "Run storytree's check_setup in this folder, follow its recovery instructions and verify the hooks. Ask me before creating a project; do not create one without my yes.";
