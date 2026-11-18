// Capability 3 · Story node render
import React from "react";
import { CONCEPTS } from "@storytree/shown-words";
import type { LanesNotice } from "@storytree/forest-world/planet";
import { LayoutProgress, type LaidIsland } from "./layout-progress.js";
import type { sheetFaces, SheetFace } from "./globe-switches.js";

export const COMPASS_ROOM = 84;

const TILT_TITLE = "Tilt the sheet: R and F, or right-drag up and down";
const LOOK_TITLE: Record<SheetFace, string> = {
  stories: `Smoked glass and solid islands; the view stays where it is. ${TILT_TITLE}`,
  library: `Clear glass and outlined islands, so the notes beneath show; the view stays where it is. ${TILT_TITLE}`,
};

const counted = (n: number, what: { one: string; many: string }): string => n === 0 ? `no ${what.one}` : `${n} ${n === 1 ? what.one : what.many}`;
const LINK = { one: "link", many: "links" };

export function ForestTop({ layers, onTurn, islands, notice, aside, rings }: {
  layers: Pick<ReturnType<typeof sheetFaces>, "offered" | "pressed">; onTurn: (face: SheetFace) => void;
  islands: readonly LaidIsland[]; notice: LanesNotice | undefined;
  aside: number;
  rings?: { parts: number; links: number } | undefined;
}) {
  return <div className="forest-top" style={{ right: aside + COMPASS_ROOM }}>
    <div className="forest-views" role="group" aria-label="Sheet faces">
      {layers.offered.map(which => <button key={which} type="button"
        data-globe-switch={which} aria-pressed={layers.pressed[which]} title={layers.offered.length > 1 ? LOOK_TITLE[which] : TILT_TITLE} onClick={() => onTurn(which)}>
        {which === "stories" ? "Stories" : "Library"}
      </button>)}
    </div>
    <LayoutProgress islands={islands} />
    {rings !== undefined && <div className="forest-open-work">{`The arc's open work rings ${counted(rings.parts, CONCEPTS.capability)} and ${counted(rings.links, LINK)}.`}</div>}
    {notice !== undefined && <div className="forest-lanes-notice" role="alert" title={notice.issue}>{notice.text}</div>}
  </div>;
}
