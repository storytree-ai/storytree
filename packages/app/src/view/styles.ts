// Mounted with the view; the palette is shared with the existing forest controls.
export const appMenuStyles = `
:root:has(.app-menu-mount) { --app-bar-height: 48px; }
body:has(> .app-menu-mount) > main { margin-top: var(--app-bar-height); }
.app-bar { position: fixed; inset: 0 0 auto; height: var(--app-bar-height); z-index: 7; display: flex; align-items: center; justify-content: end; padding: 0 12px; background: #101418; border-bottom: 1px solid #485159; }
.app-gear { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #eceae3; cursor: pointer; }
.app-gear:hover, .app-gear[aria-expanded="true"] { background: #262a2f; }
.app-gear[data-update-pending] { position: relative; }
.app-gear[data-update-pending]::after { content: ""; position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; border-radius: 50%; background: #e0b252; }
.app-gear:focus-visible, .app-menu :focus-visible { outline: 2px solid #a9b0ba; outline-offset: 2px; }
.app-menu {
  position: fixed; inset: var(--app-bar-height) 0 0; width: 100%; height: calc(100dvh - var(--app-bar-height)); max-width: none; max-height: none; margin: 0; padding: 32px; border: 0;
  background: rgb(0 0 0 / .25); color: #eceae3; color-scheme: dark; font: 14px/1.5 "Segoe UI", system-ui, sans-serif;
  --bg: #101418; --surface: #101418; --text: #eceae3; --muted: #a9b0ba; --line: #485159; --row-hover: #262a2f; --code-bg: #262a2f; --fail-text: #ffaaaa;
}
.app-menu::backdrop { background: transparent; pointer-events: none; }
.app-menu, .app-menu * { box-sizing: border-box; }
.app-menu-window { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; border: 1px solid #485159; border-radius: 12px; background: #101418; box-shadow: 0 8px 30px rgb(0 0 0 / .25); }
.app-menu button { font: inherit; }
[data-app-updates] { border: 1px solid #485159; border-radius: 6px; padding: 7px 12px; background: transparent; color: #eceae3; cursor: pointer; }
.app-menu button:hover { background: #262a2f; }
.app-menu button:disabled { color: #a9b0ba; opacity: .6; cursor: default; background: transparent; }
.app-menu-body { display: flex; flex: 1; min-height: 0; }
.app-menu-sections { display: flex; flex-direction: column; flex: 0 0 200px; gap: 4px; padding: 20px 12px; border-right: 1px solid #485159; overflow: auto; }
.app-menu-sections button { border: 0; border-radius: 6px; padding: 10px 14px; background: transparent; color: #a9b0ba; text-align: left; cursor: pointer; }
.app-menu-sections button[aria-pressed="true"] { color: #eceae3; background: #262a2f; }
/* Close ends the tab row: at the foot of the column, or the far end of the row when narrow. */
.app-menu-sections .app-menu-close { margin-top: auto; }
.app-menu-close span { margin-left: 8px; }
.app-menu-content { flex: 1; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: 28px 32px; }
.app-menu-content > section { max-width: 880px; margin: 0 auto; }
.app-menu-content h2 { margin: 0; font-size: 22px; font-weight: 600; }
.app-menu-content h2:focus { outline: none; }
.app-section-description { color: #a9b0ba; margin: 6px 0 28px; }
.app-project { max-width: 480px; }
.app-project { display: grid; gap: 5px; color: #a9b0ba; font-size: 12px; }
.app-project select {
  width: 100%;
  min-width: 0;
  border: 1px solid #485159;
  border-radius: 6px;
  padding: 7px 10px;
  font: 14px/1.5 "Segoe UI", system-ui, sans-serif;
  color: #eceae3;
  background: #101418;
  cursor: pointer;
  overflow-wrap: anywhere;
}
/* Native keyboard/selection behaviour, with the popup drawn in the same quiet palette. */
.app-project select, .app-project select::picker(select) { appearance: base-select; }
.app-project select::picker(select) {
  border: 1px solid #485159;
  border-radius: 6px;
  padding: 4px;
  background: #101418;
  color: #eceae3;
  max-width: calc(100vw - 24px);
}
.app-project option { padding: 6px; border-radius: 4px; overflow-wrap: anywhere; }
.app-project option:hover, .app-project option:checked { background: #262a2f; }
.app-project-error { max-width: 480px; padding-left: 12px; border-left: 2px solid #a9b0ba; overflow-wrap: anywhere; }
.app-no-projects { margin: 0; color: #a9b0ba; }
.app-update-status { margin: 24px 0 0; overflow-wrap: anywhere; }
.app-update-status strong, .app-update-status span { display: block; }
.app-update-status strong { font-weight: 600; color: #eceae3; }
.app-update-status span { margin-top: 6px; color: #a9b0ba; }
.surfaces code { font: inherit; }
.surfaces-status { min-height: 1.5em; margin: -16px 0 8px; color: #a9b0ba; font-size: 12px; }
.surface { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 10px 28px; padding: 18px 0; border-top: 1px solid #485159; }
.surface h3 { margin: 0; font-size: 15px; font-weight: 600; }
.surface-text p { margin: 4px 0 0; color: #a9b0ba; overflow-wrap: anywhere; }
.surface-state { text-align: right; }
.surface-fixed { color: #a9b0ba; font-size: 12px; }
.surface-toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; }
.surface-toggle input { appearance: none; position: relative; width: 38px; height: 22px; margin: 0; border: 1px solid #485159; border-radius: 11px; background: #262a2f; cursor: pointer; }
.surface-toggle input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #a9b0ba; transition: left .12s; }
.surface-toggle input:checked { background: #3d5a50; border-color: #7dbdab; }
.surface-toggle input:checked::after { left: 19px; background: #eceae3; }
.surface-toggle span { min-width: 2em; color: #a9b0ba; font-size: 12px; text-align: left; }
.surface-setting { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) 205px; gap: 4px 28px; align-items: center; padding: 10px 0 0 16px; border-left: 2px solid #262a2f; }
.surface-setting label { font-weight: 600; }
.surface-setting select { grid-row: 1 / span 2; grid-column: 2; border: 1px solid #485159; border-radius: 6px; padding: 7px 10px; background: #101418; color: #eceae3; font: inherit; }
.surface-setting select:disabled { opacity: .5; }
.surface-setting p { margin: 0; color: #a9b0ba; font-size: 12px; }
.surface-group { border-top: 1px solid #485159; }
.surface-group > .surface:first-child { border-top: 0; }
.surface[data-within] { margin-left: 24px; border-top-style: dashed; }
@media (max-width: 700px) {
  .surface, .surface-setting { grid-template-columns: minmax(0, 1fr); }
  .surface-state { text-align: left; }
  .surface-setting select { grid-row: auto; grid-column: auto; }
  .app-menu { padding: 12px; }
  .app-menu-sections .app-menu-close { margin: 0 0 0 auto; }
  .app-menu-body { flex-direction: column; }
  .app-menu-sections { flex: 0 0 auto; flex-direction: row; flex-wrap: wrap; gap: 2px; padding: 8px; border-right: 0; border-bottom: 1px solid #485159; }
  .app-menu-sections button { padding: 8px 10px; }
  .app-menu-content { padding: 20px 16px; }
}
`;
