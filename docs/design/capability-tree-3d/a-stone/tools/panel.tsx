/** The story panel beside the island: the story, a legend of what is drawn, and whatever was last clicked on the island. */
import { WRENCH, type Picked } from "./castle.js";

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

export function Panel({ data, picked, onPick, sample, onSample, fills }: {
  data: Data; picked: Picked | undefined; onPick: (kind: string, id: string) => void; sample: boolean; onSample: (on: boolean) => void;
  fills: { word: string; colour: string }[];
}) {
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const total = data.capabilities.reduce((s, c) => s + c.lines, 0);
  const name = (id: string) => byId.get(id)?.title ?? id;
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
  let body: React.ReactNode;
  if (!picked) body = <p className="mock-muted">Click a territory, a gate, a path, the road off the coast or a wrench.</p>;
  else if (picked.kind === "territory") {
    const c = byId.get(picked.id)!, callers = data.capabilities.filter(o => o.dependsOn.some(d => d.id === c.id)), work = workOn(c.id);
    body = <>
      <h3>{c.title}</h3>
      <p className="mock-facts"><span className={`mock-word mock-word-${c.parked ? "parked" : c.word}`}>{c.parked ? `${c.word}, parked` : c.word}</span>
        {` ${c.lines.toLocaleString("en-GB")} lines in ${c.files} files · ${(c.lines / total * 100).toFixed(1)}% of the island`}</p>
      <p>{c.description}</p>
      <h4>Contracts</h4>{contracts(c.contracts)}
      <h4>Calls</h4>{c.dependsOn.length ? <ul>{c.dependsOn.map(d => <li key={d.id}>{d.storyId === data.story.id ? link("path", `${c.id}->${d.id}`, d.title) : link("road", `${c.id}->${d.id}`, `${d.story} · ${d.title}`)}</li>)}</ul> : <p className="mock-muted">Nothing.</p>}
      <h4>Called by</h4>{callers.length ? <ul>{callers.map(o => <li key={o.id}>{link("path", `${o.id}->${c.id}`, o.title)}</li>)}</ul> : <p className="mock-muted">Nothing in this story.</p>}
      {work.length > 0 && <><h4>Open work naming it</h4>{link("wrench", c.id, "Its wrench")}</>}
    </>;
  } else if (picked.kind === "path" || picked.kind === "road") {
    const from = byId.get(picked.from)!, dep = from.dependsOn.find(d => d.id === picked.to)!;
    const called = byId.get(picked.to);
    body = <>
      <p className="mock-kicker">{picked.kind === "road" ? "Road off the coast" : "Pathway"}</p>
      <h3>{from.title} calls {picked.kind === "road" ? `${dep.story} · ` : ""}{dep.title}</h3>
      <h4>{dep.title}'s contracts</h4>{contracts(called?.contracts ?? dep.contracts)}
      {called && <p>{link("territory", called.id, `Open ${called.title}`)}</p>}
      {picked.kind === "path" && picked.shared && <><h4>This stretch also carries</h4><ul>{picked.shared.map(id => { const [f, t] = id.split("->"); return <li key={id}>{link("path", id, `${name(f!)} calls ${name(t!)}`)}</li>; })}</ul></>}
    </>;
  } else if (picked.kind === "gate") {
    // A gate stands for the links that pass through it: between neighbours, one; at a corridor's end, every way it opens on.
    const calls = (l: { from: string; to: string }) => {
      const from = byId.get(l.from)!, dep = from.dependsOn.find(d => d.id === l.to)!, called = byId.get(l.to);
      return { from, dep, called, text: `${from.title} calls ${called ? "" : `${dep.story} · `}${dep.title}` };
    };
    const [one, ...more] = picked.links.map(calls);
    body = <>
      <p className="mock-kicker">Gate</p>
      <h3>{more.length ? `${picked.links.length} links pass this gate` : one!.text}</h3>
      {picked.links.map(calls).map(c => <section key={c.text}>
        {more.length > 0 && <p><strong>{c.text}</strong></p>}
        <h4>{c.dep.title}'s contracts</h4>{contracts(c.called?.contracts ?? c.dep.contracts)}
        {c.called && <p>{link("territory", c.called.id, `Open ${c.called.title}`)}</p>}
      </section>)}
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
        <li><svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 11V5h3V2h3v3h3V2h3v3h3V2h3v3h1v6Z" fill="#ece4d0" stroke="#1b1814" strokeWidth="1" strokeLinejoin="round" /></svg>wall</li>
        <li><svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 7H21" stroke="#6e5236" strokeWidth="2" strokeDasharray="4 3" /></svg>path</li>
        <li><svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 11V3h2V1h1v2h1V1h1v2h2v8ZM14 11V3h2V1h1v2h1V1h1v2h2v8Z" fill="#ece4d0" stroke="#1b1814" strokeWidth="0.9" strokeLinejoin="round" /></svg>gate</li>
        <li><svg className="mock-mark" viewBox="-10 -36 20 38" aria-hidden="true"><path d={WRENCH} fill="#1b1814" stroke="#ece4d0" strokeWidth="2" /></svg>wrench</li>
      </ul>
      <label className="mock-check"><input type="checkbox" checked={sample} onChange={e => onSample(e.target.checked)} /> Add sample work (made up, not in the library)</label>
      <p className="mock-muted">Drag to pan · right-drag to turn and tilt · wheel to zoom · Q/E turn · R/F tilt</p>
    </footer>
  </aside>;
}
