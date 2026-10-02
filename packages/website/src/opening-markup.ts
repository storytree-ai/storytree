import { AGENTS, BANNER, FINALE } from "./opening-copy.js";
import { escapeHtml } from "./install-command.js";

export function openingMarkup() {
  const windows = AGENTS.map((agent, i) => `<article class="opening-window opening-agent" data-agent="${i}" style="--x:${(i * 7 % 4) * 23 + 2}%;--y:${Math.floor(i / 4) * 27 + 4}%;--color:${["#5bb5a2", "#a48be0", "#e0a458", "#6aa7e8"][i % 4]}"><header>${agent.n}<span>waiting on you</span></header><div class="opening-lines">${agent.l.map(line => `<p>${escapeHtml(line)}</p>`).join("")}<p class="opening-demand">${escapeHtml(agent.d)}</p></div></article>`).join("");
  return `<section id="opening" data-phase="peak" aria-label="Chapter 1: the agent swarm">
    <div class="opening-toolbar"><a class="wordmark" href="/">storytree<span>.</span></a><span class="eyebrow">Chapter 1 · Sound familiar?</span><div><button id="opening-sound" type="button" aria-pressed="false" hidden>Sound off</button><button id="opening-skip" type="button" hidden>Skip to the globe</button></div></div>
    <p id="opening-count">12 agents · 12 waiting on you · 0 answered</p>
    <div class="opening-stage">
      <article id="opening-lead" class="opening-window"><header>swarm <span>waiting on you</span></header><div class="opening-lines">${BANNER.map(line => `<p>${escapeHtml(line)}</p>`).join("")}</div><div class="opening-prompt"><span>❯ Build me a shopping website</span><button id="opening-run" type="button" hidden>Run</button></div></article>
      <div id="opening-agents">${windows}</div>
      <article id="opening-finale" class="opening-window"><header>swarm · a moment of honesty <span>waiting on you</span></header><div class="opening-lines">${FINALE.map(line => `<p>${escapeHtml(line.replaceAll("{N}", "12").replace(/^[!+] /, ""))}</p>`).join("")}</div><div class="opening-actions"><button id="opening-better" class="button button-light" type="button" hidden>Show me the better way <span aria-hidden="true">↗</span></button><button id="opening-joke" type="button" hidden>I'll keep babysitting</button><a id="opening-static-exit" class="button button-light" href="#website-forest">Show me the better way ↓</a></div></article>
    </div>
    <p class="opening-footnote">A little fiction about a familiar feeling. <span>Scroll down whenever you like ↓</span></p>
  </section>`;
}
