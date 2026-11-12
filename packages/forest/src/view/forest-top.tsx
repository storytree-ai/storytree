/**
 * Capability 3 · Story node render: the map's top row, the one band the sheet's opening keeps clear of nameplates
 * (`CLEAR_TOP`): the sheet's face switches, the layout mark while islands are laid out (3.96), and the lanes notice when
 * some lanes could not be drawn (3.103), and with an arc selected how many capabilities and links its open work rings (3.108). The row stops short of the compass and of the story panel's width beside it, so
 * the notice wraps inside it, readable whole, covering no nameplate and hidden by no panel.
 */
import React from "react";
import { CONCEPTS } from "@storytree/shown-words";
import type { LanesNotice } from "@storytree/forest-world/planet";
import { LayoutProgress, type LaidIsland } from "./layout-progress.js";
import type { sheetFaces, SheetFace } from "./globe-switches.js";

/** The compass's room at the top right: its 64px, its 0.5rem from the edge and the row's 0.5rem gap, rounded up. */
export const COMPASS_ROOM = 84;

/** What the face buttons say they do: change the look and leave the view where it is, and how to tilt the sheet by hand (ADR-1062 D2, D3). */
const TILT_TITLE = "Tilt the sheet: R and F, or right-drag up and down";
const LOOK_TITLE: Record<SheetFace, string> = {
  stories: `Smoked glass and solid islands; the view stays where it is. ${TILT_TITLE}`,
  library: `Clear glass and outlined islands, so the notes beneath show; the view stays where it is. ${TILT_TITLE}`,
};

/** 3.108: "3 capabilities", "1 link", "no capability", a capability in the shown words' word (ADR-1322 D1). */
const counted = (n: number, what: { one: string; many: string }): string => n === 0 ? `no ${what.one}` : `${n} ${n === 1 ? what.one : what.many}`;
const LINK = { one: "link", many: "links" };

export function ForestTop({ layers, onTurn, islands, notice, aside, rings }: {
  layers: Pick<ReturnType<typeof sheetFaces>, "offered" | "pressed">; onTurn: (face: SheetFace) => void;
  islands: readonly LaidIsland[]; notice: LanesNotice | undefined;
  /** CSS pixels of the page's right the story panel or note card covers (3.40). */
  aside: number;
  /** How many capabilities and links the selected arc's open work rings; undefined with no arc selected (3.108). */
  rings?: { parts: number; links: number } | undefined;
}) {
  return <div className="forest-top" style={{ right: aside + COMPASS_ROOM }}>
    <div className="forest-views" role="group" aria-label="Sheet faces">
      {layers.offered.map(which => <button key={which} type="button"
        data-globe-switch={which} aria-pressed={layers.pressed[which]} title={layers.offered.length > 1 ? LOOK_TITLE[which] : TILT_TITLE} onClick={() => onTurn(which)}>
        {which === "stories" ? "Stories" : "Library"}
      </button>)}
    </div>
    {/* 3.96: beside the switches while any island is still laid out. */}
    <LayoutProgress islands={islands} />
    {/* 3.108: so rings out of sight (a gate off screen, a small settlement) read apart from none. */}
    {rings !== undefined && <div className="forest-open-work">{`The arc's open work rings ${counted(rings.parts, CONCEPTS.capability)} and ${counted(rings.links, LINK)}.`}</div>}
    {notice !== undefined && <div className="forest-lanes-notice" role="alert" title={notice.issue}>{notice.text}</div>}
  </div>;
}
