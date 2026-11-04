/** The story panel beside the island: the story, a legend of what is drawn, and whatever was last clicked on the island. */
import { GROUND_HEX, PALETTE, ROAD_HEX, WRENCH, type Layer, type Picked } from "./overlay.js";
import { LANE_HEX } from "./sea.js";
import { GLYPHS, KIND_NAMES, kindOf } from "../kinds.mjs";

type Contract = { id: string; title: string };
type Dep = { id: string; title: string; story: string; storyId: string; contracts?: Contract[] };
type Capability = { id: string; title: string; description: string; word: string; parked: boolean; lines: number; files: number; dependsOn: Dep[]; contracts: Contract[] };
type Work = { arc: string; arcTitle: string; increment: string; title: string; status: string; parked?: string | null; capabilities: string[]; demo?: boolean };
type Data = { story: { id: string; title: string }; measuredAt: string; capabilities: Capability[]; openWork: Work[]; map: { tree: { stories: { title: string; capabilities: { id: string; contracts: Contract[] }[] }[] } } };

export function Panel({ data, picked, onPick, layer }: { data: Data; picked: Picked | undefined; onPick: (kind: string, id: string) => void; layer: Layer | undefined }) {
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const links = layer?.links ?? new Map();
  const total = data.capabilities.reduce((s, c) => s + c.lines, 0);
  const contractsOf = (id: string) => byId.get(id)?.contracts ?? data.map.tree.stories.flatMap(s => s.capabilities).find(c => c.id === id)?.contracts;
  const link = (kind: string, id: string, text: string) => <button type="button" className="mock-link" onClick={() => onPick(kind, id)}>{text}</button>;
  const contracts = (list: readonly Contract[] | undefined) => list && list.length
    ? <ul className="mock-contracts">{list.map(k => <li key={k.id}>{k.title}</li>)}</ul> : <p className="mock-muted">No contracts recorded.</p>;
  const named = (story: string, title: string) => `${story === data.story.title ? "" : `${story} · `}${title}`;
  const linkLine = (key: string) => { const l = links.get(key); return l ? <li key={key}>{link("link", key, `${named(l.fromStory, l.fromTitle)} calls ${named(l.toStory, l.toTitle)}`)}</li> : null; };
  const workOn = (id: string) => data.openWork.filter(w => w.capabilities.includes(id)).sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || String(a.parked ?? "").localeCompare(String(b.parked ?? "")));
  const readAt = ((data as { workReadAt?: string }).workReadAt ?? data.measuredAt).slice(0, 10);
  let body: React.ReactNode;
  if (!picked) body = <p className="mock-muted">Click a territory, a settlement, a gate, a road or a wrench.</p>;
  else if (picked.kind === "territory") {
    const c = byId.get(picked.id)!;
    const callers = [...links.values()].filter(l => l.to === c.id), calls = [...links.values()].filter(l => l.from === c.id);
    body = <>
      <h3>{c.title}</h3>
      <p className="mock-facts"><span className="mock-word">{c.parked ? `${c.word}, parked` : c.word}</span>
        {` ${KIND_NAMES[kindOf(c.title) as keyof typeof KIND_NAMES]} · ${c.lines.toLocaleString("en-GB")} lines in ${c.files} files · ${(c.lines / total * 100).toFixed(1)}% of the island`}</p>
      <p className="mock-facts">{`storytree saw: ${(c as unknown as { verified?: string }).verified ?? "?"} · the agent reports: ${(c as unknown as { reported?: string }).reported ?? "?"}`}</p>
      <p>{c.description}</p>
      <h4>Contracts</h4>{contracts(c.contracts)}
      <h4>Calls</h4>{calls.length ? <ul>{calls.map(l => linkLine(l.key))}</ul> : <p className="mock-muted">Nothing.</p>}
      <h4>Called by, each on its own line</h4>{callers.length ? <ul>{callers.map(l => linkLine(l.key))}</ul> : <p className="mock-muted">Nothing.</p>}
      {workOn(c.id).length > 0 && <><h4>Open work naming it</h4>{link("wrench", c.id, "Its wrench")}</>}
    </>;
  } else if (picked.kind === "link") {
    const l = links.get(picked.id)!;
    body = <>
      <p className="mock-kicker">{l.dir === "inside" ? "Link" : l.dir === "down" ? "Arrival from other stories" : "Link to another story"}</p>
      <h3>{named(l.fromStory, l.fromTitle)} calls {named(l.toStory, l.toTitle)}</h3>
      <h4>{l.toTitle}'s contracts</h4>{contracts(contractsOf(l.to))}
      {byId.has(l.to) && <p>{link("territory", l.to, `Open ${l.toTitle}`)}</p>}
      {l.carries && <><h4>{l.carries.length === 1 ? "The link it carries" : `The ${l.carries.length} links it carries`}</h4><ul>{l.carries.map(k => <li key={`${k.from}>${k.to}`}>{`${named(k.fromStory, k.fromTitle)} calls ${named(k.toStory, k.toTitle)}`}</li>)}</ul></>}
    </>;
  } else if (picked.kind === "road") {
    const carried = layer?.roads.get(picked.id) ?? [], gate = picked.id.startsWith("gate:");
    body = <>
      <p className="mock-kicker">{gate ? "Shared entrance" : "Shared road"}</p>
      <h3>{gate ? `A gate ${carried.length} links enter by` : `A road carrying ${carried.length} links`}</h3>
      <p className="mock-muted">{gate ? "Links into one territory that arrive the same way come in through one gate. Click one to light its whole way." : "Links that go the same way travel one road until they part. Click one to light its whole way."}</p>
      <ul>{carried.map(k => linkLine(k))}</ul>
    </>;
  } else {
    const c = byId.get(picked.id)!, work = workOn(c.id), grouped = new Map<string, Work[]>();
    for (const w of work) grouped.set(w.arc, [...(grouped.get(w.arc) ?? []), w]);
    const via = layer?.wrenches.get(c.id)?.at, line = via ? links.get(via) : undefined;
    body = <>
      <p className="mock-kicker">Wrench</p>
      <h3>Work wanting {c.title}</h3>
      <p className="mock-muted">Open increments whose capabilities lists name it, read {readAt}, lined up beside the wrench: the one being built inked, the rest waiting in paper, in the order they were parked.{line && ` It stands where ${line.to === c.id ? `${named(line.fromStory, line.fromTitle)}'s road enters` : "its own road leaves"}, lit in gold.`}</p>
      <ul className="mock-arcs">{[...grouped.values()].map(ws => <li key={ws[0]!.arc}>
        <strong>{ws[0]!.arcTitle}</strong><span className="mock-id">{ws[0]!.arc}</span>
        <ul>{ws.map(w => <li key={w.increment}>{w.title} <span className="mock-id">{w.demo ? "made up, not in the library" : `${w.increment} · ${w.status === "active" ? "being built" : "waiting"}`}</span></li>)}</ul>
      </li>)}</ul>
      <p>{link("territory", c.id, `Open ${c.title}`)}</p>
    </>;
  }
  return <aside className="mock-panel" aria-label="Story panel">
    <header><p className="mock-kicker">Story</p><h2>{data.story.title}</h2></header>
    <section className="mock-picked">{body}</section>
    <footer>
      <ul className="mock-legend">
        {(layer?.fills ?? []).map(f => <li key={f.word}><span className="mock-swatch" style={{ background: f.colour }} />{f.word}</li>)}
        <li><span className="mock-swatch" style={{ background: GROUND_HEX }} />open land, where the roads come ashore</li>
        <li><svg className="mock-mark" viewBox="0 0 26 12" aria-hidden="true"><path d="M1 6H25" stroke={ROAD_HEX} strokeWidth="2.4" strokeLinecap="round" /></svg>road: links share it while they go the same way; wider where it carries more (click it for what it carries)</li>
        <li><svg className="mock-mark" viewBox="0 0 26 12" aria-hidden="true"><path d="M1 6H19" stroke={LANE_HEX} strokeWidth="2.2" /><rect x="19.5" y="3" width="4" height="6" fill={PALETTE.paper} stroke={PALETTE.post} strokeWidth="1" /></svg>shipping lane: calls to or from another story, wider where lanes merge; it ends at a port</li>
        <li className="mock-kinds">settlement, where a territory's roads meet, drawn as what it is (larger where more roads meet):{Object.entries(KIND_NAMES).map(([kind, name]) => <span key={kind}><svg className="mock-mark" viewBox="-14 -14 28 28" aria-hidden="true">{GLYPHS[kind as keyof typeof GLYPHS].parts.map(d => <path key={d} d={d} fill={PALETTE.paper} stroke={PALETTE.ink} strokeWidth="2.1" strokeLinejoin="round" />)}{GLYPHS[kind as keyof typeof GLYPHS].lines.map(d => <path key={d} d={d} fill="none" stroke={PALETTE.ink} strokeWidth="2.1" strokeLinecap="round" />)}</svg>{name}</span>)}</li>
        <li><svg className="mock-mark" viewBox="0 -2 26 16" aria-hidden="true"><path d="M13 -2V0.5M13 11.5V14" stroke="#f4f7f8" strokeWidth="1" /><path d="M1 6H25" stroke={ROAD_HEX} strokeWidth="2" /><rect x="11.2" y="0.5" width="3.6" height="3.6" fill={PALETTE.paper} stroke={PALETTE.post} strokeWidth="1" /><rect x="11.2" y="7.9" width="3.6" height="3.6" fill={PALETTE.paper} stroke={PALETTE.post} strokeWidth="1" /></svg>gate: where a road crosses a border</li>
        <li><svg className="mock-mark" viewBox="-13 -13 26 26" aria-hidden="true"><circle r="11" fill={PALETTE.paper} stroke={PALETTE.ink} /><g transform="scale(0.66)"><path d={WRENCH} fill={PALETTE.ink} /></g></svg>wrench</li>
      </ul>
      <p className="mock-muted">Drag to pan · right-drag to turn and tilt · wheel to zoom · Q/E turn · R/F tilt</p>
    </footer>
  </aside>;
}
