/** The story panel beside the island: the story, a legend of what is drawn, and whatever was last clicked on the island. */
import { PALETTE, WRENCH, type LineInfo, type LinkInfo, type Picked } from "./overlay.js";

type Contract = { id: string; title: string };
type Dep = { id: string; title: string; story: string; storyId: string; contracts?: Contract[] };
type Capability = { id: string; title: string; description: string; word: string; parked: boolean; lines: number; files: number; dependsOn: Dep[]; contracts: Contract[] };
type Work = { arc: string; arcTitle: string; increment: string; title: string; status: string; capabilities: string[] };
type Data = { story: { id: string; title: string }; measuredAt: string; capabilities: Capability[]; openWork: Work[] };

export function Panel({ data, picked, onPick, fills, links = new Map(), lines = new Map() }: {
  data: Data; picked: Picked | undefined; onPick: (kind: string, id: string) => void;
  fills: { word: string; colour: string }[]; links?: Map<string, LinkInfo>; lines?: Map<string, LineInfo>;
}) {
  const byId = new Map(data.capabilities.map(c => [c.id, c]));
  const total = data.capabilities.reduce((s, c) => s + c.lines, 0);
  const here = data.story.title;
  const button = (kind: string, id: string, text: string) => <button type="button" className="mock-link" onClick={() => onPick(kind, id)}>{text}</button>;
  const contracts = (list: readonly Contract[] | undefined) => list && list.length
    ? <ul className="mock-contracts">{list.map(k => <li key={k.id}>{k.title}</li>)}</ul> : <p className="mock-muted">No contracts recorded.</p>;
  const named = (story: string, title: string) => story === here ? title : `${story} · ${title}`;
  const lineOf = (key: string) => [...lines.values()].find(l => l.links.includes(key));
  const linkItem = (key: string) => {
    const l = links.get(key), line = lineOf(key);
    if (!l) return null;
    const text = `${named(l.fromStory, l.fromTitle)} calls ${named(l.toStory, l.toTitle)}`;
    return <li key={key}>{line ? button("line", line.id, text) : text}</li>;
  };
  const calledContracts = (to: string) => byId.get(to)?.contracts ?? data.capabilities.flatMap(c => c.dependsOn).find(d => d.id === to)?.contracts;
  let body: React.ReactNode;
  if (!picked) body = <p className="mock-muted">Click a line, a territory or a wrench.</p>;
  else if (picked.kind === "territory") {
    const c = byId.get(picked.id)!, work = data.openWork.filter(w => w.capabilities.includes(c.id));
    const callers = [...links.values()].filter(l => l.to === c.id), calls = [...links.values()].filter(l => l.from === c.id);
    body = <>
      <h3>{c.title}</h3>
      <p className="mock-facts"><span className="mock-word">{c.parked ? `${c.word}, parked` : c.word}</span>
        {` ${c.lines.toLocaleString("en-GB")} lines in ${c.files} files · ${(c.lines / total * 100).toFixed(1)}% of the island`}</p>
      <p>{c.description}</p>
      <h4>Contracts</h4>{contracts(c.contracts)}
      <h4>Calls</h4>{calls.length ? <ul>{calls.map(l => linkItem(l.key))}</ul> : <p className="mock-muted">Nothing.</p>}
      <h4>Called by</h4>{callers.length ? <ul>{callers.map(l => linkItem(l.key))}</ul> : <p className="mock-muted">Nothing.</p>}
      {work.length > 0 && <><h4>Open work naming it</h4>{button("wrench", c.id, "Its wrench")}</>}
    </>;
  } else if (picked.kind === "line") {
    const line = lines.get(picked.id)!, carried = line.links.map(k => links.get(k)!);
    const first = carried[0]!;
    body = <>
      <p className="mock-kicker">{line.kind === "inside" ? "Link" : line.kind === "out" ? "Link to another story" : carried.length > 1 ? "Links from other stories" : "Link from another story"}</p>
      <h3>{carried.length === 1 ? `${named(first.fromStory, first.fromTitle)} calls ${named(first.toStory, first.toTitle)}` : `${carried.length} links into ${line.toTitle}`}</h3>
      {carried.length > 1 && <ul>{carried.map(l => <li key={l.key}>{named(l.fromStory, l.fromTitle)} calls it</li>)}</ul>}
      <h4>{named(line.toStory, line.toTitle)}'s contracts</h4>{contracts(calledContracts(line.to))}
      {byId.has(line.to) && <p>{button("territory", line.to, `Open ${line.toTitle}`)}</p>}
    </>;
  } else {
    const c = byId.get(picked.id)!, work = data.openWork.filter(w => w.capabilities.includes(c.id));
    const grouped = new Map<string, Work[]>();
    for (const w of work) grouped.set(w.arc, [...(grouped.get(w.arc) ?? []), w]);
    body = <>
      <p className="mock-kicker">Wrench</p>
      <h3>Work wanting {c.title}</h3>
      <p className="mock-muted">{`Open increments whose capabilities lists name it, read ${data.measuredAt.slice(0, 10)}.`}</p>
      <ul className="mock-arcs">{[...grouped.values()].map(ws => <li key={ws[0]!.arc}>
        <strong>{ws[0]!.arcTitle}</strong><span className="mock-id">{ws[0]!.arc}</span>
        <ul>{ws.map(w => <li key={w.increment}>{w.title} <span className="mock-id">{`${w.increment} · ${w.status}`}</span></li>)}</ul>
      </li>)}</ul>
      <p>{button("territory", c.id, `Open ${c.title}`)}</p>
    </>;
  }
  const thread = (colour: string) => <svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 6H21" stroke={PALETTE.casing} strokeWidth="4.2" /><path d="M1 6H21" stroke={colour} strokeWidth="2.6" /></svg>;
  return <aside className="mock-panel" aria-label="Story panel">
    <header><p className="mock-kicker">Story</p><h2>{here}</h2></header>
    <section className="mock-picked">{body}</section>
    <footer>
      <ul className="mock-legend">
        {fills.map(f => <li key={f.word}><span className="mock-swatch" style={{ background: f.colour }} />{f.word}</li>)}
        {/* Each swatch is a small copy of the mark it names. */}
        <li>{thread(PALETTE.inside)}link in the story</li>
        <li>{thread(PALETTE.arrival)}link from another story</li>
        <li>{thread(PALETTE.out)}link out</li>
        <li><svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><circle cx="4" cy="6" r="2.6" fill={PALETTE.inside} stroke={PALETTE.casing} strokeWidth="1" /><path d="M6 6H14" stroke={PALETTE.casing} strokeWidth="4.2" /><path d="M6 6H14" stroke={PALETTE.inside} strokeWidth="2.6" /><path d="M21.5 6L13 1.5V10.5Z" fill={PALETTE.inside} stroke={PALETTE.casing} strokeWidth="1" /></svg>start, entrance</li>
        <li><svg className="mock-mark" viewBox="0 0 22 12" aria-hidden="true"><circle cx="11" cy="6" r="5.4" fill={PALETTE.landing} stroke={PALETTE.landingEdge} strokeWidth="1" /></svg>landing</li>
        <li><svg className="mock-mark" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="10.5" fill={PALETTE.paper} stroke={PALETTE.ink} strokeWidth="1.2" /><g transform="scale(0.625)"><path d={WRENCH} fill={PALETTE.ink} /></g></svg>wrench</li>
      </ul>
      <p className="mock-muted">Drag to pan · right-drag to turn and tilt · wheel to zoom · Q/E turn · R/F tilt</p>
    </footer>
  </aside>;
}
