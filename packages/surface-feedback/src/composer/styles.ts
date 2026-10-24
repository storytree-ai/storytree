// Capability 1 · Button and composer. Adopted by the document, as the app menu's are, since the page's CSP is style-src 'self'.
// The app bar's dark chrome, so the corner reads the same over the globe, a panel or the gear menu.
export const cornerStyles = `
.feedback-corner { position: fixed; right: 10px; bottom: 10px; z-index: 2147483000; font: 13px/1.45 "Segoe UI", system-ui, sans-serif; color: #eceae3; color-scheme: dark; }
.feedback-corner, .feedback-corner * { box-sizing: border-box; }
.feedback-button { display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid #485159; border-radius: 6px; background: #101418; color: #a9b0ba; cursor: pointer; opacity: .8; }
.feedback-button:hover, .feedback-button[aria-expanded="true"] { color: #eceae3; background: #262a2f; opacity: 1; }
.feedback-corner :focus-visible { outline: 2px solid #a9b0ba; outline-offset: 2px; }
.feedback-composer { position: absolute; right: 0; bottom: 30px; width: 340px; display: grid; gap: 8px; padding: 12px; border: 1px solid #485159; border-radius: 10px; background: #101418; box-shadow: 0 8px 30px rgb(0 0 0 / .35); }
.feedback-composer[hidden] { display: none; }
.feedback-composer h2 { margin: 0; font-size: 13px; font-weight: 600; }
.feedback-composer label { display: grid; gap: 4px; color: #a9b0ba; }
.feedback-composer select, .feedback-composer textarea { width: 100%; font: inherit; color: #eceae3; background: #1a1f24; border: 1px solid #485159; border-radius: 6px; padding: 5px 7px; }
.feedback-composer textarea { min-height: 96px; resize: vertical; }
.feedback-composer .feedback-picture { display: flex; align-items: center; gap: 6px; }
.feedback-status { margin: 0; min-height: 1.45em; color: #a9b0ba; }
.feedback-status[data-failed] { color: #ffaaaa; }
.feedback-actions { display: flex; justify-content: flex-end; gap: 6px; }
.feedback-actions button { font: inherit; border: 1px solid #485159; border-radius: 6px; padding: 4px 10px; background: transparent; color: #eceae3; cursor: pointer; }
.feedback-actions button:hover { background: #262a2f; }
.feedback-actions button:disabled { color: #a9b0ba; opacity: .6; cursor: default; background: transparent; }
.feedback-actions [data-corner-send], .feedback-actions [data-corner-retry] { background: #2c6b41; border-color: #2c6b41; }
.feedback-actions [hidden] { display: none; }
.feedback-anchor { margin: 0; display: flex; align-items: baseline; gap: 6px; color: #eceae3; font-family: ui-monospace, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
.feedback-anchor button { margin-left: auto; font: 12px/1.45 "Segoe UI", system-ui, sans-serif; border: 1px solid #485159; border-radius: 6px; padding: 1px 8px; background: transparent; color: #a9b0ba; cursor: pointer; white-space: nowrap; }
.feedback-anchor button:hover { background: #262a2f; color: #eceae3; }
.feedback-picker { position: fixed; inset: 0; cursor: crosshair; }
.feedback-picker[hidden], .feedback-outline[hidden] { display: none; }
.feedback-outline { position: fixed; pointer-events: none; outline: 2px solid #6fb7ff; outline-offset: 1px; background: rgb(111 183 255 / .12); }
.feedback-outline span { position: absolute; left: -2px; bottom: 100%; margin-bottom: 4px; padding: 1px 6px; border-radius: 4px; background: #101418; color: #eceae3; font: 11px/1.45 ui-monospace, Consolas, monospace; white-space: nowrap; }
.feedback-outline[data-below] span { bottom: auto; top: 100%; margin: 4px 0 0; }
.feedback-outline[data-right] span { left: auto; right: -2px; }
.feedback-hint { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); margin: 0; padding: 4px 10px; border: 1px solid #485159; border-radius: 6px; background: #101418; color: #a9b0ba; pointer-events: none; }
`;
