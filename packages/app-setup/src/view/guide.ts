/** One offline guide; the README and installation point here. Projects are added from Projects, not here. */
export const guide = `
  <h3>Start your first project</h3>
  <ol>
    <li><strong>Open your chosen agent in your project folder.</strong> The installer set up the folder you chose as your first project. Start a new Claude Code or Codex session there. Storytree does not run the agent for you.</li>
    <li><strong>Let the connection check finish.</strong> Review any approval prompt from your agent for storytree tools, a small check-file edit or a command. Approve the check if you want to continue. Ask the agent to run <code>check_setup</code> again until it reports hooks verified: session start, tool call, file edit and command have reached storytree. Registered hooks alone are not verification. <strong>Using Codex?</strong> Codex runs storytree's hooks only once you trust them: the first time it starts it asks you to review them (“Hooks need review”), or type <code>/hooks</code> in Codex. Until then storytree cannot see Codex's work.</li>
    <li><strong>Give the agent a small piece of work.</strong> Your project is on show in the app. Its forest can start empty; a story and its capabilities appear as the agent plans them, with activity and health as work proceeds.</li>
  </ol>
  <h3>Add a project</h3>
  <p>Storytree sets a folder up only when you ask. Sessions in other folders work as usual, and storytree stays out of them. To add a folder, use any of these:</p>
  <ul>
    <li><strong>In the app:</strong> Projects → <strong>Add project…</strong>, then choose the folder.</li>
    <li><strong>In a terminal:</strong> in the folder, run <code>storytree doctor --set-up &lt;name&gt;</code>, with a name of lower-case letters, digits and hyphens.</li>
    <li><strong>Through your agent:</strong> in a session in the folder, ask it to set storytree up here.</li>
  </ul>
  <p>The new project appears in the app. Use the project picker to switch between forests.</p>
  <details><summary>Windows asks whether to trust the installer</summary>
    <p>This release is unsigned, so Windows may show an unknown-publisher or SmartScreen warning. Check that you obtained it from storytree-ai/storytree. If you choose to trust that download, use More info → Run anyway when offered. If your organisation blocks it, ask its administrator; do not disable Windows protection.</p>
  </details>
  <p>Connection incomplete? Check a folder below for setup diagnostics. This folder check does not register hooks or install the command; those checks will say “skipped”. Use <strong>Copy request for your agent</strong> to complete setup and verify hook receipt in your agent session.</p>
`;

export const recoveryRequest = "Run storytree's check_setup in this folder, follow its recovery instructions and verify the hooks. Ask me before creating a project; do not create one without my yes.";
