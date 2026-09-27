/**
 * The knowledge core's drawing (the knowledge core story, capability 4 · Look inside and inspect a note): the
 * project's notes drawn inside the globe at @storytree/knowledge-core's positions, and the panel
 * beside it that pins a note, chooses a session to replay and says what size counts.
 *
 * Inside the globe: each shelf's entrance at its island's place, named; each note a ball, grey
 * when the selected session never reached it, pale when it did, and in its agent's colour once the
 * replay lights it. A ghost is see-through, beside the decision that replaced it. A loop is circled
 * in red and labelled a refused shape. Only the pinned note's links are drawn, as solid white
 * lines with an arrowhead at the note they point to; a replay's moves are dashed in the agent's
 * colour, and never along a link, since the record names no source note (T1).
 */
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import React, { useEffect, useMemo } from "react";
import { Quaternion, Raycaster, Vector2, Vector3, type Object3D } from "three";

import type { Card, CoreScene, DrawnNote, LegendEntry, Link, Point, ReplayFrame, SizeBy } from "../look-inside/look-inside.js";

/** Grey for a note the session never reached, pale for one it did (ADR-0647 V1, the prototype's version 4 greys). */
const GREY = "#3a3d46";
const REACHED = "#cfd6e4";
const LOOP = "#ff5a4f";
const ENTRANCE = "#eadcae";

export function CoreInside({ scene, radius, pinned, links, frame, legend, selected, onPin }: {
  scene: CoreScene;
  radius: number;
  pinned: string | undefined;
  links: readonly Link[];
  frame: ReplayFrame | undefined;
  legend: readonly LegendEntry[];
  /** The selected story, whose capabilities' entrances are named too. */
  selected: string | undefined;
  onPin: (note: string | undefined) => void;
}) {
  const colours = useMemo(() => new Map(legend.map(({ agent, colour }) => [agent, colour])), [legend]);
  const byId = useMemo(() => new Map(scene.notes.map((note) => [note.id, note])), [scene]);
  const ball = radius * 0.011;
  const named = useMemo(() => {
    const home = pinned === undefined ? undefined : scene.entrances.find(({ node }) => node === pinned);
    return new Set([...scene.entrances.filter(({ node, story }) => node === story || story === selected).map(({ node }) => node), home?.node]);
  }, [scene, pinned, selected]);
  return <group name="core">
    <mesh>
      <sphereGeometry args={[radius, 48, 32]} />
      <meshBasicMaterial color="#6d7784" wireframe transparent opacity={0.06} depthWrite={false} />
    </mesh>
    {scene.entrances.map((entrance) => <group key={entrance.node} position={vector(entrance.at)}>
      <mesh>
        <sphereGeometry args={[entrance.node === entrance.story ? ball * 1.6 : ball, 12, 8]} />
        <meshBasicMaterial color={ENTRANCE} />
      </mesh>
      {named.has(entrance.node) && <Html center zIndexRange={[20, 20]} style={{ pointerEvents: "none" }}>
        <span className={entrance.node === entrance.story ? "core-entrance core-entrance-story" : "core-entrance"}>{entrance.title}</span>
      </Html>}
    </group>)}
    {scene.notes.map((note) => <Note key={note.id} note={note} ball={ball} pinned={note.id === pinned}
      colour={note.tone === "lit" ? colours.get(note.agent ?? "") ?? REACHED : note.tone === "reached" ? REACHED : GREY} />)}
    {links.map(({ from, to }) => {
      const a = byId.get(from), b = byId.get(to);
      return a === undefined || b === undefined ? null : <Arrow key={`${from}>${to}`} from={a.at} to={b.at} size={ball * 1.4} />;
    })}
    {frame?.jumps.filter(({ from }) => from !== undefined).map((jump) => {
      const a = byId.get(jump.from!), b = byId.get(jump.to);
      return a === undefined || b === undefined ? null : <Line key={`${jump.agent} ${jump.seq}`} points={arc(a.at, b.at)}
        color={colours.get(jump.agent) ?? REACHED} lineWidth={2} dashed dashSize={radius * 0.02} gapSize={radius * 0.015} />;
    })}
    <PickNote onPin={onPin} />
  </group>;
}

function Note({ note, ball, colour, pinned }: { note: DrawnNote; ball: number; colour: string; pinned: boolean }) {
  const size = ball * note.size;
  return <group position={vector(note.at)}>
    <mesh name={`note:${note.id}`}>
      <sphereGeometry args={[size, 16, 12]} />
      <meshBasicMaterial color={colour} transparent={note.ghost} opacity={note.ghost ? 0.28 : 1} depthWrite={!note.ghost} />
    </mesh>
    {note.loop !== undefined && <mesh>
      <sphereGeometry args={[size * 1.7, 12, 8]} />
      <meshBasicMaterial color={LOOP} wireframe />
    </mesh>}
    {pinned && <mesh>
      <sphereGeometry args={[size * 1.5, 16, 12]} />
      <meshBasicMaterial color="#ffffff" wireframe />
    </mesh>}
    {pinned && <Html center zIndexRange={[30, 30]} style={{ pointerEvents: "none" }}>
      <span className="core-pinned-label">{note.title}</span>
    </Html>}
  </group>;
}

/** A stored link, in its stored direction: a solid line with its head at the note it points to. */
function Arrow({ from, to, size }: { from: Point; to: Point; size: number }) {
  const a = vector(from), b = vector(to);
  const along = b.clone().sub(a);
  const head = a.clone().add(along.clone().multiplyScalar(0.82));
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), along.clone().normalize());
  return <>
    <Line points={[a, b]} color="#ffffff" lineWidth={1.5} transparent opacity={0.8} />
    <mesh position={head} quaternion={turn}>
      <coneGeometry args={[size, size * 3, 10]} />
      <meshBasicMaterial color="#ffffff" />
    </mesh>
  </>;
}

/** A click, not a drag, on a note pins it; a click on nothing lets the pin go. */
function PickNote({ onPin }: { onPin: (note: string | undefined) => void }) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    const element = gl.domElement;
    let down: { x: number; y: number } | undefined;
    const onDown = (event: PointerEvent): void => {
      down = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY } : undefined;
    };
    const onUp = (event: PointerEvent): void => {
      const from = down;
      down = undefined;
      if (from === undefined || Math.hypot(event.clientX - from.x, event.clientY - from.y) > 5) return;
      const box = element.getBoundingClientRect();
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(2 * (event.clientX - box.left) / box.width - 1, 1 - 2 * (event.clientY - box.top) / box.height), camera);
      scene.updateMatrixWorld(true);
      onPin(pickNote(ray, scene));
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
    };
  }, [camera, gl, scene, onPin]);
  return null;
}

/** The nearest note ball under the ray, by its mesh's name. */
export function pickNote(ray: Raycaster, scene: Object3D): string | undefined {
  const notes: Object3D[] = [];
  scene.traverse((object) => {
    if (object.name.startsWith("note:")) notes.push(object);
  });
  return ray.intersectObjects(notes, false)[0]?.object.name.slice("note:".length);
}

/** The panel beside the core: what is drawn, the session, the size, the replay, the legend and the pinned note's card. */
export function CorePanel({ scene, counts, sessions, session, sizeBy, frame, step, playing, legend, hidden, card, on }: {
  scene: CoreScene;
  counts: { placed: number; outside: number; ghosts: number; loops: number };
  sessions: readonly { id: string; label: string }[];
  session: string | undefined;
  sizeBy: SizeBy;
  frame: ReplayFrame | undefined;
  step: number;
  playing: boolean;
  legend: readonly LegendEntry[];
  hidden: ReadonlySet<string>;
  card: Card | undefined;
  links: readonly Link[];
  titles: ReadonlyMap<string, string>;
  on: {
    session(session: string | undefined): void;
    sizeBy(sizeBy: SizeBy): void;
    play(): void;
    pause(): void;
    restart(): void;
    toggleAgent(agent: string): void;
    unpin(): void;
  };
}) {
  const shownStep = frame === undefined ? 0 : Math.min(step, frame.steps);
  return <aside className="core-panel" aria-label="Inside the globe">
    <h2>Inside the globe</h2>
    <p className="core-counts">
      {counts.placed} artifacts under shelves · {counts.outside} with no shelf route, outside · {counts.ghosts} replaced
      {counts.loops > 0 && <strong className="core-loop-warning"> · {counts.loops} loop{counts.loops === 1 ? "" : "s"}: a refused shape</strong>}
    </p>
    {scene.status !== undefined && <p className="core-status">{scene.status}</p>}
    {sessions.length > 0 && <label className="core-row">Session{" "}
      <select value={session ?? ""} onChange={(event) => on.session(event.target.value === "" ? undefined : event.target.value)}>
        <option value="">none</option>
        {sessions.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>}
    <div className="core-row" role="group" aria-label="Size by">
      Size by{" "}
      {(["visits", "links-in"] as const).map((mode) => <button key={mode} type="button" aria-pressed={sizeBy === mode} onClick={() => on.sizeBy(mode)}>
        {mode === "visits" ? "Visits" : "Links in"}
      </button>)}
    </div>
    <p className="core-note">{scene.sizeLabel}. Size never changes depth.</p>
    {frame !== undefined && <>
      <div className="core-row" role="group" aria-label="Replay">
        {playing
          ? <button type="button" onClick={on.pause}>Pause</button>
          : <button type="button" onClick={on.play}>Play</button>}
        <button type="button" onClick={on.restart}>Restart</button>
        <span className="core-note">step {shownStep} of {frame.steps}</span>
      </div>
      <ul className="core-legend">
        {legend.map(({ agent, label, task, colour }) => <li key={agent}>
          <label>
            <input type="checkbox" aria-label={`Show ${label}`} checked={!hidden.has(agent)} onChange={() => on.toggleAgent(agent)} />
            <span className="core-swatch" style={{ background: colour }} />
            {label}{task === undefined ? "" : ` · ${task}`}
          </label>
        </li>)}
      </ul>
      <p className="core-note">A dashed line is a jump between one agent's full reads, not a link it followed. Reads show reach, never usefulness.</p>
    </>}
    {card !== undefined && <NoteCard card={card} onClose={on.unpin} />}
  </aside>;
}

/** One summary card, shared by the globe's right-hand slot and the inspection panel. */
export function NoteCard({ card, onClose }: { card: Card; onClose: () => void }) {
  return <section className="core-card" aria-label="Pinned artifact">
    <p className="core-card-kind">{card.kind}</p>
    <header>
      <h3>{card.title}</h3>
      <button type="button" className="panel-close" aria-label="Close artifact" onClick={onClose}>×</button>
    </header>
    <p className="core-card-text">{card.summary ?? card.text}</p>
  </section>;
}

function vector({ x, y, z }: Point): Vector3 {
  return new Vector3(x, y, z);
}

/** A jump drawn as an arc bowing away from the centre, so it never lies along a straight link. */
function arc(from: Point, to: Point): Vector3[] {
  const a = vector(from), b = vector(to);
  const middle = a.clone().add(b).multiplyScalar(0.5);
  const outward = middle.lengthSq() === 0 ? new Vector3(0, 1, 0) : middle.clone().normalize();
  const bow = outward.multiplyScalar(a.distanceTo(b) * 0.25);
  const control = middle.add(bow);
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16;
    return a.clone().multiplyScalar((1 - t) ** 2).add(control.clone().multiplyScalar(2 * t * (1 - t))).add(b.clone().multiplyScalar(t * t));
  });
}
