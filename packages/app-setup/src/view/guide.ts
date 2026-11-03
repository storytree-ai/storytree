/** Capability 3 · First-run guide. One offline guide; the README and installation point here. */

import { languageList, SURVEYED_LANGUAGES } from "@storytree/map/languages";

/** The platform the guide's troubleshooting is for (3.15); undefined when the app cannot tell, which gets every platform's. */
export type GuidePlatform = "windows" | "mac" | "linux";

/** The platform named in the app's user agent, as Electron's renderer reports it. */
export function platformOf(userAgent: string): GuidePlatform | undefined {
  if (/Windows NT/.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "mac";
  if (/Linux|X11/.test(userAgent)) return "linux";
  return undefined;
}

const troubleshooting: Record<GuidePlatform, string> = {
  windows: `  <details><summary>Windows asks whether to trust the installer</summary>
    <p>This release is unsigned, so Windows may show an unknown-publisher or SmartScreen warning. Check that you obtained it from storytree-ai/storytree. If you choose to trust that download, use More info → Run anyway when offered. If your organisation blocks it, ask its administrator; do not disable Windows protection to get past an organisation's block.</p>
  </details>
  <details><summary>Windows says Smart App Control blocked storytree</summary>
    <p>If Windows says Smart App Control blocked storytree and offers no Run anyway, that is Windows 11's reputation check: it blocks apps that are unsigned and not yet widely known, and this release is unsigned. To see whether it is on, open Windows Security → App &amp; browser control → Smart App Control settings; it reads On, Evaluation or Off.</p>
    <p>To install storytree you would have to turn it off there. That is your choice, and it has a cost: Smart App Control then stops checking every app on this computer, not just storytree (Microsoft Defender antivirus keeps running). On Windows 11 with the April 2026 update or later you can turn it back on from the same page; before that update, turning it back on needs a reset or reinstall of Windows. If you would rather keep it on, wait for a signed release. If your organisation manages this computer, ask its administrator.</p>
  </details>
  <details><summary>Remove storytree</summary>
    <p>Uninstall <strong>storytree-0.3</strong> from Windows Settings → Apps, or run <code>storytree setup uninstall</code>. It asks whether to keep your library, then removes the app, its command and its connections and hooks in Claude Code and Codex. Your project folders and their files stay as they are. Restart your agents afterwards.</p>
  </details>
`,
  mac: `  <details><summary>macOS says storytree cannot be opened</summary>
    <p>If macOS says storytree “cannot be opened because Apple cannot check it for malicious software” or that it is from an unidentified developer, the copy you have is not notarised by Apple. Check that you obtained it from storytree-ai/storytree. If you choose to trust it, open System Settings → Privacy &amp; Security and choose Open Anyway beside storytree's message, then open it again. If your organisation manages this Mac, ask its administrator.</p>
  </details>
  <details><summary>Remove storytree</summary>
    <p>Run <code>storytree setup uninstall</code>. It asks whether to keep your library, then removes the app, its command and its connections and hooks in Claude Code and Codex. Your project folders and their files stay as they are. Restart your agents afterwards.</p>
  </details>
`,
  linux: `  <details><summary>The app does not start: FUSE</summary>
    <p>The app is an AppImage, which needs FUSE. Where FUSE is missing or not permitted, as in many containers, run the installer again with <code>APPIMAGE_EXTRACT_AND_RUN=1</code> set, so the app runs without it, or install your distribution's FUSE 2 package (libfuse2, or libfuse2t64 on Ubuntu 24.04).</p>
  </details>
  <details><summary>The app does not start: run as root</summary>
    <p>The app and its database refuse to run as root. Install and run storytree as an ordinary user, not as root or with sudo.</p>
  </details>
  <details><summary>The app does not start: no desktop session</summary>
    <p>The app opens a window, so it needs a desktop session: run the installer and the app from one, with DISPLAY or WAYLAND_DISPLAY set. Over ssh, or on a machine with no desktop, it has nowhere to show.</p>
  </details>
  <details><summary>Remove storytree</summary>
    <p>Run <code>storytree setup uninstall</code>. It asks whether to keep your library, then removes the app, its command, its menu entry and its connections and hooks in Claude Code and Codex. Your project folders and their files stay as they are. Restart your agents afterwards.</p>
  </details>
`,
};

/** The guide, with the troubleshooting for `platform`, or every platform's when it is not known. */
export function guideFor(platform: GuidePlatform | undefined): string {
  const steps = platform === undefined ? (["windows", "mac", "linux"] as const).map((each) => troubleshooting[each]).join("") : troubleshooting[platform];
  return `
  <h3>Set up storytree on this computer</h3>
  <p>Both steps are optional, and you can come back to them here from Help.</p>
  <h4>Connect your coding agents</h4>
  <div class="setup-help-connect" data-connect role="status"><p>Looking for the coding agents on this computer…</p></div>
  <h4>Add your first project</h4>
  <p>Choose the folder of something you want to build. Storytree sets it up as a project and shows it. Its map reads ${languageList(SURVEYED_LANGUAGES)} code; a project in another language shows only what its agent plans.</p>
  <div class="setup-help-actions"><button type="button" data-guide-add-project>Add a project…</button></div>
  <p data-guide-add-status role="status"></p>
  <h3>Start your first project</h3>
  <ol>
    <li><strong>Open your chosen agent in your project folder.</strong> Start a new session of the agent you connected, in the folder you added. Storytree does not run the agent for you.</li>
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
${steps}  <p>Connection incomplete? Check a folder below for setup diagnostics. This folder check does not register hooks or install the command; those checks will say “skipped”. Use <strong>Copy request for your agent</strong> to complete setup and verify hook receipt in your agent session.</p>
`;
}

export const recoveryRequest = "Run storytree's check_setup in this folder, follow its recovery instructions and verify the hooks. Ask me before creating a project; do not create one without my yes.";
