/** Capability 1 · Home page. */
import { AGENTS, BANNER, EXIT, FINALE, FOOTNOTE, THINK } from "./opening-copy.js";
import { openingClock } from "./opening-clock.js";
import { escapeHtml } from "./escape-html.js";
import { OPENING_SEED, mulberry32 } from "./opening-seed.js";
import { OPENING_PROMPT, lineClass, lineText } from "./opening-lines.js";

const line = (text: string, extra = "") => {
  const kind = [lineClass(text), extra].filter(Boolean).join(" ");
  return `<p${kind ? ` class="${kind}"` : ""}>${escapeHtml(lineText(text))}</p>`;
};
const demand = (text: string) => `<p class="opening-demand">${escapeHtml(text)} <span class="term-cursor" aria-hidden="true">▌</span></p>`;
const titleBar = (name: string, status: string) => `<header><span class="term-dots" aria-hidden="true">● ● ●</span><span class="term-name">${escapeHtml(name)}</span><span class="term-status">${status}</span></header>`;

export function openingMarkup() {
  // Windows sit on a jittered grid (4 columns on a wide screen, 3 on a tablet); the lead agent takes slot 0.
  const rand = mulberry32(OPENING_SEED);
  const windows = AGENTS.map((agent, i) => {
    const slot = i + 1;
    const place = `--i:${i};--c4:${slot % 4};--r4:${Math.floor(slot / 4)};--c3:${slot % 3};--r3:${Math.floor(slot / 3)};--jx:${Math.round(rand() * 14)}px;--jy:${Math.round(rand() * 10)}px`;
    return `<article class="opening-window opening-agent is-parked${i % 4 === 2 ? " ph-amber" : ""}" data-agent="${i}" style="${place}">${titleBar(agent.n, "waiting on you")}<div class="opening-lines">${agent.l.map(text => line(text)).join("")}${demand(agent.d)}</div></article>`;
  }).join("");
  // The pace is computed here, at build, so the page's own script stays small (contract 2.3).
  const clock = JSON.stringify(openingClock(AGENTS, THINK.length)); // numbers only: safe in single quotes
  return `<section id="opening" data-phase="peak" data-clock='${clock}' aria-label="Chapter 1: the agent swarm">
    <div class="opening-screen">
      <div class="opening-hud"><span class="opening-wordmark">storytree<span class="opening-caret" aria-hidden="true">▌</span></span><p id="opening-count"><span>AGENTS: 12 ▲</span><span class="opening-waiting">WAITING ON YOU: 12</span><span class="opening-answered">ANSWERED: 00</span></p><div class="opening-keys"><button id="opening-sound" type="button" aria-pressed="false" hidden>sound off</button><button id="opening-skip" type="button" hidden>skip intro →</button></div></div>
      <div class="opening-stage">
        <article id="opening-lead" class="opening-window is-parked">${titleBar("swarm", "waiting on you")}<div class="opening-lines">${BANNER.map(text => line(text, "is-banner")).join("")}</div><div class="opening-prompt"><span class="term-ps1">~/shop $</span><span class="term-cmd">${OPENING_PROMPT}</span><span class="term-cursor" aria-hidden="true">▌</span><button id="opening-run" type="button" hidden>Run</button></div></article>
        <div id="opening-agents">${windows}</div>
        <div class="opening-dimmer" aria-hidden="true"></div>
        <article id="opening-finale" class="opening-window is-parked">${titleBar("swarm · a moment of honesty", "waiting on you")}<div class="opening-lines">${FINALE.map(text => line(text.replaceAll("{N}", "12"))).join("")}</div><div class="opening-actions"><button id="opening-better" class="opening-key-primary" type="button" hidden>${escapeHtml(EXIT)} →</button><button id="opening-joke" type="button" hidden>i'll keep babysitting</button><a id="opening-static-exit" class="opening-key-primary" href="#website-forest">${escapeHtml(EXIT)} ↓</a></div></article>
      </div>
      <p class="opening-footnote">${escapeHtml(FOOTNOTE)}</p>
      <canvas class="opening-grain" aria-hidden="true"></canvas>
      <div class="opening-scan" aria-hidden="true"></div>
    </div>
    <div id="opening-crt-line" class="opening-crt-line" aria-hidden="true" hidden></div>
    <div id="opening-crt-dot" class="opening-crt-dot" aria-hidden="true" hidden></div>
  </section>`;
}
