/** The story panel beside the island: the story, a legend of what is drawn, and whatever was last clicked on the island. */
import { WRENCH, type GateInfo, type LinkInfo, type Picked } from "./castle.js";

type Contract = { id: string; title: string };
type Dep = { id: string; title: string; story: string; storyId: string; contracts?: Contract[] };
type Capability = { id: string; title: string; description: string; word: string; parked: boolean; lines: number; files: number; dependsOn: Dep[]; contracts: Contract[] };
type Work = { arc: string; arcTitle: string; increment: string; title: string; status: string; capabilities: string[] };
type Data = { story: { id: string; title: string }; measuredAt: string; capabilities: Capability[]; openWork: Work[] };

/** Made-up work, shown only while its box is ticked, so a wrench listing more than one arc can be seen. Not in the library. */
export const SAMPLE = {
  capability: "10 · Work in flight",
  work: [
    { arc: "sample-arc-1", arcTitle: "Board shows what each lane is waiting on", increment: "sample-increment-1", title: "A wait names the increment it waits on", status: "proposal" },
    { arc: "sample-arc-1", arcTitle: "Board shows what each lane is waiting on", increment: "sample-increment-2", title: "Work in flight lists its waits in rank order", status: "proposal" },
    { arc: "sample-arc-2", arcTitle: "Sessions hand work over across machines", increment: "sample-increment-3", title: "Work in flight survives a machine change", status: "proposal" },
  ],
} as const;

export function Panel({ data, picked, onPick, sample, onSample, fills, links = new Map(), gates = new Map() }: {
  data: Data; picked: Picked | undefined; onPick: (kind: string, id: string) => void; sample: boolean; onSample: (on: boolean) => void;
  fills: { word: string; colour: string }[]; links?: Map<string, LinkInfo>; gates?: Map<string, GateInfo>;
}) {
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const total = data.capabilities.reduce((s, c) => s + c.lines, 0);
  const link = (kind: string, id: string, text: string) => <button type="button" className="mock-link" onClick={() => onPick(kind, id)}>{text}</button>;
  const contracts = (list: readonly Contract[] | undefined) => list && list.length
    ? <ul className="mock-contracts">{list.map(k => <li key={k.id}>{k.title}</li>)}</ul> : <p className="mock-muted">No contracts recorded.</p>;
  const workOn = (id: string): Work[] => [...data.openWork.filter(w => w.capabilities.includes(id)),
    ...(sample && byId.get(id)?.title === SAMPLE.capability ? SAMPLE.work.map(w => ({ ...w, capabilities: [id], sample: true })) : [])];
  const arcs = (work: (Work & { sample?: boolean })[]) => {
    const grouped = new Map<string, (Work & { sample?: boolean })[]>();
    for (const w of work) grouped.set(w.arc, [...(grouped.get(w.arc) ?? []), w]);
    return <ul className="mock-arcs">{[...grouped.values()].map(ws => <li key={ws[0]!.arc}>
      <strong>{ws[0]!.arcTitle}</strong>{ws[0]!.sample && <span className="mock-sample">sample</span>}<span className="mock-id">{ws[0]!.sample ? "" : ws[0]!.arc}</span>
      <ul>{ws.map(w => <li key={w.increment}>{w.title} <span className="mock-id">{w.sample ? "made up" : `${w.increment} · ${w.status}`}</span></li>)}</ul>
    </li>)}</ul>;
  };
  const linkLine = (key: string) => { const l = links.get(key); return l ? <li key={key}>{link("link", key, `${l.fromStory === data.story.title ? "" : `${l.fromStory} · `}${l.fromTitle} calls ${l.toStory === data.story.title ? "" : `${l.toStory} · `}${l.toTitle}`)}</li> : null; };
  const calledContracts = (to: string) => byId.get(to)?.contracts ?? data.capabilities.flatMap(c => c.dependsOn).find(d => d.id === to)?.contracts;
  let body: React.ReactNode;
  if (!picked) body = <p className="mock-muted">Click a territory, a road, a gate or a wrench.</p>;
  else if (picked.kind === "territory") {
    const c = byId.get(picked.id)!, work = workOn(c.id);
    const callers = [...links.values()].filter(l => l.to === c.id), calls = [...links.values()].filter(l => l.from === c.id);
    body = <>
      <h3>{c.title}</h3>
      <p className="mock-facts"><span className={`mock-word mock-word-${c.parked ? "parked" : c.word}`}>{c.parked ? `${c.word}, parked` : c.word}</span>
        {` ${c.lines.toLocaleString("en-GB")} lines in ${c.files} files · ${(c.lines / total * 100).toFixed(1)}% of the island`}</p>
      <p>{c.description}</p>
      <h4>Contracts</h4>{contracts(c.contracts)}
      <h4>Calls</h4>{calls.length ? <ul>{calls.map(l => linkLine(l.key))}</ul> : <p className="mock-muted">Nothing.</p>}
      <h4>Called by, each through its own gate</h4>{callers.length ? <ul>{callers.map(l => linkLine(l.key))}</ul> : <p className="mock-muted">Nothing.</p>}
      {work.length > 0 && <><h4>Open work naming it</h4>{link("wrench", c.id, "Its wrench")}</>}
    </>;
  } else if (picked.kind === "link") {
    const l = links.get(picked.id)!;
    body = <>
      <p className="mock-kicker">{l.dock === undefined ? "Road" : "Road between islands"}</p>
      <h3>{l.fromStory === data.story.title ? "" : `${l.fromStory} · `}{l.fromTitle} calls {l.toStory === data.story.title ? "" : `${l.toStory} · `}{l.toTitle}</h3>
      <h4>{l.toTitle}'s contracts</h4>{contracts(calledContracts(l.to))}
      {l.gate && <p>{link("gate", l.gate, `Its gate into ${l.toTitle}`)}</p>}
      {byId.has(l.to) && <p>{link("territory", l.to, `Open ${l.toTitle}`)}</p>}
    </>;
  } else if (picked.kind === "road") {
    body = <>
      <p className="mock-kicker">Shared road</p>
      <h3>{picked.links.length} links along this road</h3>
      <ul>{picked.links.map(linkLine)}</ul>
    </>;
  } else if (picked.kind === "gate") {
    const g = gates.get(picked.id)!, c = byId.get(g.town)!, first = links.get(g.links[0]!)!;
    body = <>
      <p className="mock-kicker">Gate (a gap in the border)</p>
      <h3>Into {c.title}{g.links.length === 1 ? ` from ${first.fromTitle}` : ` from ${first.fromStory === data.story.title ? "this island" : "other islands"}`}</h3>
      <p className="mock-muted">{g.links.length === 1 ? "This link's own gate; its road is lit in gold." : `The road from the coast brings ${g.links.length} links in by this gate; their roads are lit in gold.`}</p>
      <h4>{c.title}'s contracts</h4>{contracts(c.contracts)}
      <h4>{g.links.length === 1 ? "The link" : "The links"}</h4><ul>{g.links.map(linkLine)}</ul>
    </>;
  } else {
    const c = byId.get(picked.capability)!, work = workOn(c.id).filter(w => picked.sample ? "sample" in w : !("sample" in w));
    body = <>
      <p className="mock-kicker">Wrench{picked.sample && <span className="mock-sample">sample</span>}</p>
      <h3>Work wanting {c.title}</h3>
      <p className="mock-muted">{picked.sample ? "Made up for the mock: not in the library." : `Open increments whose capabilities lists name it, read ${data.measuredAt.slice(0, 10)}.`}</p>
      {arcs(work)}
      <p>{link("territory", c.id, `Open ${c.title}`)}</p>
    </>;
  }
  return <aside className="mock-panel" aria-label="Story panel">
    <header><p className="mock-kicker">Story</p><h2>{data.story.title}</h2></header>
    <section className="mock-picked">{body}</section>
    <footer>
      <ul className="mock-legend">
        {fills.map(f => <li key={f.word}><span className="mock-swatch" style={{ background: f.colour }} />{f.word}</li>)}
        {/* Each swatch is a small copy of the mark it names. */}
        <li><svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 6H21" stroke="#f4f7f8" strokeWidth="1.4" strokeDasharray="3.5 2.5" /></svg>border</li>
        <li><svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 7H21" stroke="#6e5236" strokeWidth="3.6" /><path d="M1 7H21" stroke="#c7bba1" strokeWidth="2.4" /></svg>road</li>
        <li><svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><path d="M0 3H6M16 3H22" stroke="#f4f7f8" strokeWidth="1.4" strokeDasharray="3 2" /><path d="M7 0.5V5.5M15 0.5V5.5" stroke="#f4f7f8" strokeWidth="1.6" /><path d="M11 1V12" stroke="#6e5236" strokeWidth="3.6" /><path d="M11 1V12" stroke="#c7bba1" strokeWidth="2.4" /></svg>gate</li>
        <li><svg className="mock-mark" viewBox="-10 -36 20 38" aria-hidden="true"><path d={WRENCH} fill="#1b1814" stroke="#ece4d0" strokeWidth="2" /></svg>wrench</li>
      </ul>
      <label className="mock-check"><input type="checkbox" checked={sample} onChange={e => onSample(e.target.checked)} /> Add sample work (made up, not in the library)</label>
      <p className="mock-muted">Drag to pan · right-drag to turn and tilt · wheel to zoom · Q/E turn · R/F tilt</p>
    </footer>
  </aside>;
}
