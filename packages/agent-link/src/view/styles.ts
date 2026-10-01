// The forest controls' existing palette, including its warm selection accent.
export const settingsStyles = `
.settings-panel { box-sizing: border-box; width: min(760px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: 28px; border: 1px solid #485159; border-radius: 12px; background: #101418; color: #eceae3; color-scheme: dark; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; box-shadow: 0 8px 30px rgb(0 0 0 / .25); }
.settings-panel::backdrop { background: rgb(0 0 0 / .25); }
.settings-panel * { box-sizing: border-box; }
.settings-panel header { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.settings-panel h2 { margin: 0; font-size: 22px; font-weight: 600; }
.settings-panel header p { margin: 4px 0 12px; color: #a9b0ba; }
.settings-panel button, .settings-panel input, .settings-panel select { border: 1px solid #485159; border-radius: 6px; padding: 7px 10px; background: #101418; color: #eceae3; font: inherit; }
.settings-panel button { cursor: pointer; }
.settings-panel button:hover { background: #262a2f; }
.settings-panel button:disabled { opacity: .5; cursor: default; }
.settings-panel :focus-visible { outline: 2px solid #a9b0ba; outline-offset: 3px; }
.settings-panel h2:focus { outline: none; }
.settings-row { display: grid; grid-template-columns: minmax(0, 1fr) 205px; gap: 12px 28px; padding: 22px 0 18px; border-top: 1px solid #485159; }
.settings-description > label { font-size: 15px; font-weight: 600; }
.settings-description p { margin: 6px 0 0; color: #a9b0ba; overflow-wrap: anywhere; }
.settings-panel code { font: inherit; color: inherit; background: transparent; border: 0; padding: 0; }
.settings-value { min-width: 0; text-align: right; }
.settings-value select, .settings-number { width: 100%; }
.settings-number { display: flex; align-items: center; gap: 8px; }
.settings-number input { width: 100%; min-width: 0; text-align: right; font-variant-numeric: tabular-nums; }
.settings-number span { font-size: 12px; color: #a9b0ba; }
.settings-source { display: block; margin-top: 5px; font-size: 12px; color: #a9b0ba; }
.settings-source[data-source="set"] { color: #eadcae; }
.settings-cloud { grid-column: 1 / -1; display: grid; gap: 12px; }
.settings-cloud[hidden] { display: none; }
.settings-cloud label { display: grid; gap: 5px; color: #a9b0ba; }
.settings-cloud input { width: 100%; min-width: 0; }
.settings-cloud p { margin: 0; color: #a9b0ba; font-size: 12px; }
.settings-save { grid-column: 1 / -1; display: flex; align-items: center; justify-content: end; gap: 12px; }
.settings-error { flex: 1; margin: 0; color: #ff8a80; overflow-wrap: anywhere; }
.settings-error:empty, .settings-saved:empty { display: none; }
.settings-saved { color: #a9b0ba; font-size: 12px; }
.settings-panel [data-read-error] { color: #ff8a80; overflow-wrap: anywhere; }
@media (max-width: 560px) { .settings-panel { padding: 20px; } .settings-row { grid-template-columns: minmax(0, 1fr); gap: 12px; } .settings-value { width: min(100%, 240px); justify-self: end; } }
.settings-panel.settings-panel-embedded { width: 100%; max-height: none; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
`;

// Who decides what: read-only, in the settings panel's palette, below the Sessions tab's settings.
export const decisionRightsStyles = `
.decision-rights-panel { color: #eceae3; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
.decision-rights-panel[hidden] { display: none; }
.decision-rights { margin-top: 8px; padding-top: 22px; border-top: 1px solid #485159; }
.decision-rights h3 { margin: 0; font-size: 17px; font-weight: 600; }
.decision-rights h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #a9b0ba; text-transform: uppercase; letter-spacing: .04em; }
.decision-rights p { margin: 6px 0 0; color: #a9b0ba; overflow-wrap: anywhere; }
.decision-rights .decision-rights-override { margin-top: 14px; padding: 10px 12px; border-left: 3px solid #eadcae; background: #171c21; color: #eceae3; }
.decision-rights-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px 24px; margin-top: 18px; }
.decision-rights-group ul { margin: 0; padding-left: 18px; }
.decision-rights-group li { margin: 3px 0; }
.decision-rights .decision-rights-delegations { margin-top: 16px; }
.decision-rights-register { margin-top: 18px; padding-top: 16px; border-top: 1px solid #2c333a; }
.decision-rights-register .decision-rights-source { margin: 0 0 8px; font-size: 12px; }
.decision-rights .decision-rights-text { white-space: pre-line; color: #eceae3; }
`;
