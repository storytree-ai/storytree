/**
 * Capability 4 · Look inside and inspect an artifact. SPIKE (spike/glass-sheet, never merged): the knowledge graph hung under
 * a glass sheet. Each shelf's notes hang under their shelf, at the depth capability 1 computes for them (`underShelves`):
 * a story's own shelf under its island's middle, a capability's under its territory. Notes no shelf reaches lie in a pool of
 * their own. Unlike the globe's core (ADR-0658 chose no threads), the links between notes are drawn, as a graph: the
 * owner asked for a "knowledge graph" under the sheet. The host gives positions in the sheet's frame: x east, y north,
 * the top face toward +z, so the underside is -z.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, MeshBasicMaterial, Group, Quaternion, Vector3 } from "three";

import { knowledge, linksOf } from "../ghosts/ghosts.js";
import { dotColour } from "../kinds/kinds.js";
import { underShelves } from "../shelves/shelves.js";
import { isStoryText } from "../shelves/story-text.js";
import { useCoreHistory, type KnowledgeCore } from "./surface.js";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface SheetUndersideProps {
  core: KnowledgeCore;
  /** Where a shelf (a story or capability id) stands on the sheet, or undefined for one not drawn. */
  shelfAt: (node: string) => { x: number; y: number } | undefined;
  /** The story a shelf belongs to. */
  storyOf: (node: string) => string | undefined;
  /** The pool's rectangle on the sheet, for notes no shelf reaches. */
  pool: { x: number; y: number; width: number; height: number };
  /** How far apart, under the glass, one depth hangs from the next, in ground units. */
  depthStep: number;
  /** The selected story: its notes and their links are lit, the rest dimmed. */
  selected: string | undefined;
}

/** A note's spot under the sheet, and the story whose shelf holds it. */
export interface HungNote { id: string; x: number; y: number; z: number; story: string | undefined; depth: number | undefined; kind: string | undefined }

/** Where every drawn note hangs (pure, for the capture's measurements too). */
export function hangNotes(history: Parameters<typeof knowledge>[0], hidden: ReadonlySet<string>, { shelfAt, storyOf, pool, depthStep }: Omit<SheetUndersideProps, "core" | "selected">) {
  const known = knowledge(history);
  const core = underShelves(history, known);
  const drawn = (id: string) => {
    const record = known.notes.get(id);
    return record !== undefined && !isStoryText(record) && !hidden.has(record.type);
  };
  const notes: HungNote[] = [];
  const siblings = new Map<string, number>();
  for (const placement of [...core.placed.values()].sort((a, b) => (a.note < b.note ? -1 : 1))) {
    if (!drawn(placement.note)) continue;
    const anchor = shelfAt(placement.home);
    if (anchor === undefined) continue;
    const key = `${placement.home} ${placement.depth}`, index = siblings.get(key) ?? 0;
    siblings.set(key, index + 1);
    // A sunflower under the shelf, one per depth, so a deep shelf reads as a column hanging from its land.
    const r = 6 * Math.sqrt(index), a = index * GOLDEN;
    notes.push({ id: placement.note, x: anchor.x + r * Math.cos(a), y: anchor.y + r * Math.sin(a), z: -(6 + placement.depth * depthStep),
      story: storyOf(placement.home), depth: placement.depth, kind: known.notes.get(placement.note)?.type });
  }
  const loose = core.outside.filter(drawn).sort();
  const columns = Math.max(1, Math.ceil(Math.sqrt(loose.length * pool.width / Math.max(pool.height, 1))));
  const rows = Math.max(1, Math.ceil(loose.length / columns));
  loose.forEach((id, i) => {
    const column = i % columns, row = Math.floor(i / columns);
    notes.push({ id, x: pool.x + (column + 0.5) * pool.width / columns, y: pool.y + pool.height - (row + 0.5) * pool.height / rows, z: -6,
      story: undefined, depth: undefined, kind: known.notes.get(id)?.type });
  });
  const index = new Map(notes.map((note, i) => [note.id, i]));
  const links: [number, number][] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    const record = known.notes.get(note.id)!;
    const supersedes = Array.isArray(record.fields.supersedes) ? record.fields.supersedes.filter((v): v is string => typeof v === "string") : [];
    for (const to of [...linksOf(record), ...supersedes]) {
      const j = index.get(to), i = index.get(note.id)!;
      if (j === undefined || j === i) continue;
      const key = i < j ? `${i} ${j}` : `${j} ${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([i, j]);
    }
  }
  return { notes, links, shelved: notes.length - loose.length, loose: loose.length };
}

export function SheetUnderside({ core, selected, ...props }: SheetUndersideProps) {
  const { history, hidden } = useCoreHistory(core);
  const hung = useMemo(() => hangNotes(history, hidden, props), [history, hidden, props.shelfAt, props.storyOf, props.pool, props.depthStep]);
  const drawn = useMemo(() => {
    const group = new Group();
    group.name = "sheet-underside";
    group.userData = { notes: hung.notes.length, shelved: hung.shelved, loose: hung.loose, links: hung.links.length };
    const { notes, links } = hung;
    const dots = new InstancedMesh(new IcosahedronGeometry(4, 1), new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), Math.max(1, notes.length));
    dots.name = "sheet-notes";
    dots.count = notes.length;
    const matrix = new Matrix4(), colour = new Color(), dim = new Color("#101418");
    notes.forEach((note, i) => {
      const lit = selected === undefined || note.story === selected;
      matrix.makeScale(lit && selected !== undefined ? 1.5 : 1, lit && selected !== undefined ? 1.5 : 1, lit && selected !== undefined ? 1.5 : 1).setPosition(note.x, note.y, note.z);
      dots.setMatrixAt(i, matrix);
      colour.set(dotColour(note.kind, undefined));
      if (!lit) colour.lerp(dim, 0.7);
      dots.setColorAt(i, colour);
    });
    dots.raycast = () => {};
    const line = (pairs: [number, number][], colour: string, opacity: number) => {
      const position: number[] = [];
      for (const [i, j] of pairs) position.push(notes[i]!.x, notes[i]!.y, notes[i]!.z, notes[j]!.x, notes[j]!.y, notes[j]!.z);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
      const segments = new LineSegments(geometry, new LineBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false }));
      segments.raycast = () => {};
      return segments;
    };
    const touches = (pair: [number, number]) => selected !== undefined && (notes[pair[0]]!.story === selected || notes[pair[1]]!.story === selected);
    const quiet = line(links.filter(pair => !touches(pair)), "#8fb7c9", selected === undefined ? 0.16 : 0.07);
    quiet.name = "sheet-links";
    const lit = line(links.filter(touches), "#e9f4fa", 0.55);
    lit.name = "sheet-links-selected";
    group.add(quiet, lit, dots);
    return group;
  }, [hung, selected]);
  useEffect(() => () => drawn.traverse(object => {
    const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }), [drawn]);
  // The glass (the world's sheet.tsx) draws at -1 seen from above and 20 from below: the graph just before it from above,
  // so the glass dims it, and just after it from below, over the islands seen faintly through it.
  useFrame(({ camera }) => {
    const up = new Vector3(0, 0, 1).applyQuaternion(drawn.getWorldQuaternion(new Quaternion()));
    const order = up.dot(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)) < 0 ? 21 : -2;
    for (const child of drawn.children) child.renderOrder = order;
  });
  return <primitive object={drawn} />;
}
