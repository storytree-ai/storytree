// Mounted with the view so callers need no asset-copy or CSS-loader configuration.
export const appMenuStyles = `
/* Use the forest's existing controls palette; leave the rest of the top edge free. */
.app-menu-mount {
  position: fixed;
  z-index: 7;
  top: 12px;
  right: 12px;
}
.app-gear {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #485159;
  border-radius: 8px;
  background: #101418;
  color: #eceae3;
  cursor: pointer;
}
.app-gear:hover, .app-gear[aria-expanded="true"] { background: #262a2f; }
.app-gear:focus-visible, .app-menu :focus-visible { outline: 2px solid #a9b0ba; outline-offset: 2px; }
.app-menu {
  position: fixed;
  inset: 56px 12px auto auto;
  width: min(256px, calc(100vw - 24px));
  max-height: calc(100dvh - 68px);
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid #485159;
  border-radius: 10px;
  background: #101418;
  color: #eceae3;
  color-scheme: dark;
  font: 14px/1.5 "Segoe UI", system-ui, sans-serif;
  box-shadow: 0 8px 30px rgb(0 0 0 / .25);
}
.app-menu::backdrop { background: transparent; pointer-events: none; }
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
.app-menu-actions { margin-top: 12px; padding-top: 6px; border-top: 1px solid #485159; }
.app-menu-actions button {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #eceae3;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.app-menu-actions button:hover { background: #262a2f; }
.app-menu-actions button:disabled { color: #a9b0ba; opacity: .6; cursor: default; background: transparent; }
.app-no-projects { margin: 0; color: #a9b0ba; }
.app-update-status { margin: 0 10px 8px; font-size: 12px; overflow-wrap: anywhere; }
.app-update-status strong, .app-update-status span { display: block; }
.app-update-status strong { font-weight: 600; color: #eceae3; }
.app-update-status span { margin-top: 3px; color: #a9b0ba; }
`;
