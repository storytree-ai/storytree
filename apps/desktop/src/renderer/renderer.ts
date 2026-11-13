/**
 * Capability 2 · Storytree projects. The page's mounting: it mounts each story's surface, joined to the main process through the
 * preload's functions, and hands them to the app's page (@storytree/app/page), which decides what is on show, when it is drawn
 * again and what the page says about itself (`data-state`, `data-drew`, `data-fresh`, `data-selected`, `data-start`), all of which
 * the smoke check and the lag run read. Nothing here decides: each decision is the page's, tested there.
 */
import { openProjectPage, type ProjectPage } from "@storytree/app/page";
import { mountAppMenu } from "@storytree/app/view";
import { mountAddProject, mountDeleteProject, mountFactory, mountProjectSentence, mountRemoveProject, mountSetupHelp } from "@storytree/app-setup/view";
import { joinedReads, keptWorkStates, pageKeptReading, pageReading } from "@storytree/arc-surface";
import { mountArcSurface } from "@storytree/arc-surface/view";
import { forestReading, keptDrawing, keptTree } from "@storytree/forest";
import { mountJourneyConsent, mountJourneySettings } from "@storytree/app-setup/journey-events/view";
import { journal } from "@storytree/teaching-cards";
import { mountJournal, mountTeaching } from "@storytree/teaching-cards/view";
import { mountLagRecorder } from "@storytree/app/lag/view";
import { mountFeedbackCorner } from "@storytree/surface-feedback/view";
import { mountCiTimes } from "@storytree/ci-health/view";
import { outageSaidOnce } from "@storytree/library/connection-error";

import type { StorytreeBridge } from "../bridge.js";
import { mountPluginViews } from "./plugin-views.js";
import { createKnowledgeCore } from "@storytree/knowledge-core/view";

import { panelFolds } from "@storytree/forest/view/panel-folds";
import { openForestView, mountLibraryPanel, renderStorePanel, renderStoryPanel, mountSessionsList, type GlobeLocator, type GlobeOpening } from "@storytree/forest/view";

declare global {
  interface Window {
    readonly storytree: StorytreeBridge;
  }
}

const content = element("content");
/** The cards seen, kept for this user on this machine, so a kind is taught once across projects (Learning as you build). */
const seenCards = journal(window.localStorage);
/** The story panel's folds, which keep the kinds the user opened across picks and projects until the app restarts (ADR-1284 D1). */
const folds = panelFolds();
let page: ProjectPage | undefined;
const appMenu = mountAppMenu(element("app-menu-host"), {
  background: content,
  checkForUpdates: (action) => window.storytree.checkForUpdates(action),
  signIn: { read: () => window.storytree.readSignIn(), set: (on) => window.storytree.setSignIn(on) },
  installChoice: { read: () => window.storytree.readInstallChoice(), set: (choice) => window.storytree.setInstallChoice(choice) },
  releaseChannel: { read: () => window.storytree.readReleaseChannel(), set: (channel) => window.storytree.setReleaseChannel(channel) },
  chooseProject: async (name) => { await window.storytree.chooseProject(name); },
  onChosen: () => page?.refresh(),
  onSurfacesChanged: () => void page?.surfacesChanged(),
  onError: (error) => page?.choiceFailed(error),
  mountJourney: (host) => mountJourneySettings(host, window.storytree),
  // Help holds the setup guide and, below it, the journal of teaching cards seen.
  mountHelp: (host, returnFocus, onOpen) => {
    const setup = mountSetupHelp(host, window.storytree, { returnFocus, embedded: true, onOpen });
    const learned = mountJournal(host, { journal: seenCards, library: () => page?.libraryOn() });
    return {
      open() { setup.open(); learned.open(); },
      close() { setup.close(); learned.close(); },
      stop() { setup.stop(); learned.stop(); },
    };
  },
  mountAddProject: (host, onAdded) => mountAddProject(host, window.storytree, { onAdded }),
  mountProjectSentence: (host, current) => mountProjectSentence(host, window.storytree, { current }),
  mountRemoveProject: (host, current, onRemoved) => mountRemoveProject(host, window.storytree, { current, onRemoved }),
  mountDeleteProject: (host, onDeleted) => mountDeleteProject(host, window.storytree, { onDeleted }),
  mountFactory: (host) => mountFactory(host, window.storytree),
});
const consentHost = document.createElement("div");
document.body.append(consentHost);
const consent = mountJourneyConsent(consentHost, window.storytree);
const lagRecorder = mountLagRecorder(window.storytree);
// The feedback corner, above every canvas; a note records the project on show and the story node or note selected.
const corner = mountFeedbackCorner(document, window.storytree, {
  shown: () => ({ project: document.body.dataset.project, selection: document.body.dataset.selected ?? document.body.dataset.note }),
});
/** The page's failures, an unreachable library said once per outage, however many polls fail meanwhile (8.11). */
const outage = outageSaidOnce((line, ...error) => console.error(`desktop renderer: ${line}`, ...error));

page = openProjectPage({
  document,
  content,
  problem: new URLSearchParams(location.search).get("problem"),
  waiting: new URLSearchParams(location.search).get("waiting"),
  menu: appMenu,
  projectSelection: () => window.storytree.projectSelection(),
  readSurfaces: () => window.storytree.readSurfaces(),
  startMark: (name) => window.storytree.startMark(name),
  failed: (what, error) => outage.failed(what, error),
  answered: () => outage.answered(),
  globe: () => (window as { storytreeGlobe?: GlobeLocator }).storytreeGlobe,
  pluginViews: window.storytree.pluginViews.length,
  project: (name, timed) => {
    // One live reading for every surface on the page, started from the reading kept at the last start (ADR-0836 D3, D4); the
    // surfaces hearing one news share one read of the tree.
    const reads = joinedReads(window.storytree);
    const reading = pageReading({ project: name, reads, kept: timed(pageKeptReading(`storytree.page-reading.v1:${name}`)) });
    const core = createKnowledgeCore(name, { reads: window.storytree });
    return {
      page: reading,
      states: keptWorkStates(),
      kept: keptTree(name),
      drawing: keptDrawing(name),
      arcs: (host, on) => mountArcSurface(host, { project: name, reads, reading, ...on, ciExpected: async () => (await window.storytree.ciTimes?.(name))?.legs }),
      openView: (holder, onSelect, { library, opening }) => openForestView(holder, onSelect, core, { library, opening: opening as GlobeOpening | undefined, openGuide: () => appMenu.openHelp() }),
      sessions: (view, host) => {
        const sessions = mountSessionsList(host, { project: name, reads, reading,
          onHighlight: stories => view.highlight(stories), onWisps: wisps => view.showWisps(wisps),
          onRoster: roster => core.showRoster(roster), onSelect: session => core.select(session) });
        core.onSelect(session => sessions.select(session));
        return sessions;
      },
      // Its in-CI count is the page's live reading's, the same branch states the arc lanes' CI bars and the sessions list read.
      ciTimes: (host) => mountCiTimes(host, { read: async () => window.storytree.ciTimes?.(name), going: () => reading.held().fold.pullsInCi() }),
      take: (changes, lines) => core.take(changes, lines),
      libraryCard: (panel, onClose) => mountLibraryPanel(panel, core, onClose),
      teaching: (locate, reading, islands) => mountTeaching(content, { journal: seenCards, locate, reading, islands }),
      plugins: (on) => mountPluginViews(content, window.storytree.pluginViews, on, { project: name, bridge: window.storytree }),
      reading: (options) => forestReading({ project: name, reads, reading, ...options }),
      renderPanel: (drilled, selected, options) => renderStoryPanel(drilled, selected, options),
      renderStore: (store) => renderStorePanel(store),
      foldPanel: (panel) => folds.draw(panel),
    };
  },
});
window.addEventListener("beforeunload", () => { page?.stop(); appMenu.stop(); consent.stop(); consentHost.remove(); lagRecorder?.stop(); corner.stop(); });

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`the page has no #${id}`);
  return found;
}
