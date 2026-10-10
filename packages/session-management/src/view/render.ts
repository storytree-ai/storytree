/** Capability 10 · Settings. */
import type { PanelReadings, SettingsResult } from "../settings/bridge.js";
import type { SettingGroup } from "../settings/settings.js";

/** Each group's tab heading and the line beneath it; a setting joins a tab by declaring its group. */
export const SETTING_GROUPS: Readonly<Record<SettingGroup, { readonly title: string; readonly description: string }>> = {
  sessions: { title: "Sessions", description: "How sessions are guided and listed. Yours on this computer, for all projects." },
  library: { title: "Library", description: "Where the library lives. Yours on this computer, for all projects." },
};

/** The rows of one group's settings, or of every setting when no group is given. */
export function renderSettings(readings: PanelReadings, group?: SettingGroup): string {
  return Object.values(readings).filter((reading) => group === undefined || reading.group === group).map((reading, index) => {
    const id = `setting-${group ?? "all"}-${index}`;
    const title = "label" in reading ? reading.label : reading.name.charAt(0).toUpperCase() + reading.name.slice(1).replaceAll("-", " ");
    const library = "location" in reading;
    const control = library
      ? `<select id="${id}" name="value" aria-describedby="${id}-meaning ${id}-source ${id}-error">
          <option value="local"${reading.location === "local" ? " selected" : ""}>On this computer</option>
          <option value="cloudsql"${reading.location === "cloudsql" ? " selected" : ""}>Google Cloud SQL</option>
          <option value="postgres"${reading.location === "postgres" ? " selected" : ""}>Postgres address</option>
        </select>`
      : `<div class="settings-number"><input id="${id}" name="value" type="text" inputmode="${reading.type === "duration" ? "text" : "numeric"}" autocomplete="off" spellcheck="false" value="${escape(String(reading.value))}" aria-describedby="${id}-meaning ${id}-source ${id}-error">${reading.unit ? `<span>${escape(reading.unit)}</span>` : ""}</div>`;
    const fields = library ? `<div class="settings-cloud" data-location="cloudsql"${reading.location === "cloudsql" ? "" : " hidden"}>
      <label>Instance connection name<input name="instance" autocomplete="off" spellcheck="false" placeholder="project:region:instance" value="${escape(reading.location === "cloudsql" ? reading.instance : "")}"></label>
      <label>Google account email<input name="user" type="text" inputmode="email" autocomplete="off" spellcheck="false" placeholder="you@example.com" value="${escape(reading.location === "cloudsql" ? reading.user : "")}"></label>
      <p>Library location takes effect when storytree next opens.</p>
    </div>
    <div class="settings-cloud" data-location="postgres"${reading.location === "postgres" ? "" : " hidden"}>
      <label>Postgres address<input name="address" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="postgres://user@host:5432/postgres" value="${escape(reading.location === "postgres" ? reading.address : "")}"></label>
      <p>No password here: save it once as a key with <code>storytree auth set postgres</code>. Library location takes effect when storytree next opens.</p>
    </div>` : "";
    return `<form class="settings-row" data-setting="${escape(reading.name)}" novalidate>
      <div class="settings-description"><label for="${id}">${escape(title)}</label><p id="${id}-meaning">${escape(reading.meaning).replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>")}</p></div>
      <div class="settings-value">${control}<span id="${id}-source" class="settings-source" data-source="${reading.source}">${reading.source === "set" ? "set by you" : "default"}</span></div>
      ${fields}
      <div class="settings-save"><p id="${id}-error" class="settings-error" role="alert"></p><span class="settings-saved" role="status"></span><button type="submit" disabled>Save</button></div>
    </form>`;
  }).join("");
}

/** A bridge call settled: its result, or a transport failure (a rejection) as a failure with its reason. */
export async function settle<T>(call: Promise<SettingsResult<T>>): Promise<SettingsResult<T>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** What the panel shows once a read settles: the rows, or the failure's reason and Retry, never defaults in their place. */
export function readState(result: SettingsResult<PanelReadings>, group?: SettingGroup): { rows: string; error: string | undefined; retry: boolean } {
  return result.ok ? { rows: renderSettings(result.value, group), error: undefined, retry: false } : { rows: "", error: result.error, retry: true };
}

/** What a row shows once a save settles: saved and set by you, or the failure's reason with Save still available for retry. */
export function saveState(name: string, result: SettingsResult<unknown>): { error: string; status: string; saveAvailable: boolean; set: boolean } {
  if (!result.ok) return { error: result.error, status: "", saveAvailable: true, set: false };
  return { error: "", status: name === "library" ? "Saved · applies when storytree next opens" : "Saved", saveAvailable: false, set: true };
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
