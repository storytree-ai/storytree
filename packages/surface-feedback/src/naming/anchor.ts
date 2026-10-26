/**
 * Capability 2 · Surface naming. The element the owner points at, read from the page as he clicks it (ADR-1151, the
 * owner's answer to question_c8c6697b2d3d): what a building agent needs to find it in the code without guessing from a
 * picture. Only HTML is picked: a drawn canvas, the globe's included, is one element with nothing inside to name, so it
 * is never picked (feedback on the map is a surface of its own).
 */
import type { FeedbackAnchor } from "../record/bridge.js";

/** At most this much of the element's markup is kept. */
export const HTML_LIMIT = 2048;
const TEXT_LIMIT = 200;
const COMPONENT_LIMIT = 6;
/** The computed styles an agent changing a look reads first. */
const STYLES = ["display", "position", "width", "height", "margin", "padding", "border", "border-radius", "color", "background-color", "font-family", "font-size", "font-weight", "line-height", "opacity", "gap"] as const;
/** The attributes kept in the markup; any other (a value, a style, an event handler) is dropped. */
const KEPT = /^(id|class|type|name|role|href|src|alt|title|placeholder|for|disabled|checked|hidden|popover|tabindex|open|aria-[\w-]+|data-[\w-]+)$/;
/** An attribute named like a secret, or a value shaped like one (a token, a key, a signed URL's part). */
const SECRET_NAME = /token|secret|password|passwd|api-?key|auth|session|cookie|credential/i;
const SECRET_VALUE = /(eyJ[\w-]+\.[\w-]+\.[\w-]+)|([A-Za-z0-9_\-+/=]{32,})|((sk|pk|ghp|gho|xox[bp])[-_][\w-]{10,})/;

const IMPLICIT_ROLE: Readonly<Record<string, string>> = {
  button: "button", select: "combobox", textarea: "textbox", img: "img", nav: "navigation", main: "main", dialog: "dialog",
  ul: "list", ol: "list", li: "listitem", table: "table", form: "form", aside: "complementary", header: "banner", footer: "contentinfo",
  h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", progress: "progressbar", option: "option",
};
const INPUT_ROLE: Readonly<Record<string, string>> = { checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button", search: "searchbox" };

/**
 * The element drawn at `x`, `y` that a note may point at: the top-most one that is not inside `corner` (the feedback
 * corner's own) and is not a drawn canvas, an svg's shape standing for the HTML element holding it; none where a canvas
 * or the corner is all there is.
 */
export function pickableAt(document: Document, x: number, y: number, corner: Element): Element | undefined {
  for (const element of document.elementsFromPoint(x, y)) {
    if (corner.contains(element)) continue;
    if (element.tagName === "CANVAS") return undefined;
    // An icon's drawing is picked as the control it draws: the HTML element holding the svg.
    let html: Element = element;
    while (html instanceof document.defaultView!.SVGElement && html.parentElement !== null) html = html.parentElement;
    return html;
  }
  return undefined;
}

/** The declared surface `element` is drawn in: the nearest it or an ancestor marks. */
export function surfaceOf(element: Element): string | undefined {
  const marked = element.closest<HTMLElement>("[data-surface-id]");
  return marked?.dataset.surfaceId === "" ? undefined : marked?.dataset.surfaceId;
}

/** What a note records of `element`. */
export function anchorOf(element: Element): FeedbackAnchor {
  const view = element.ownerDocument.defaultView!;
  const box = element.getBoundingClientRect();
  const computed = view.getComputedStyle(element);
  const role = roleOf(element);
  const name = nameOf(element);
  const text = squeeze(element instanceof view.HTMLElement ? element.innerText : element.textContent ?? "");
  return {
    selector: selectorOf(element),
    tag: element.tagName.toLowerCase(),
    ...(role === undefined ? {} : { role }),
    ...(name === undefined ? {} : { name }),
    ...(text === "" ? {} : { text }),
    marks: marksOf(element),
    components: componentsOf(element),
    box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
    styles: Object.fromEntries(STYLES.map((style) => [style, computed.getPropertyValue(style)]).filter(([, value]) => value !== "")),
    html: htmlOf(element),
  };
}

const squeeze = (text: string): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > TEXT_LIMIT ? `${one.slice(0, TEXT_LIMIT - 1)}…` : one;
};

/** A selector only `element` matches in its document: its id where that is unique, else a path of tags down to it. */
export function selectorOf(element: Element): string {
  const document = element.ownerDocument;
  const unique = (selector: string): boolean => document.querySelectorAll(selector).length === 1;
  const steps: string[] = [];
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.id !== "" && unique(`#${CSS.escape(node.id)}`)) {
      steps.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const surface = node.getAttribute("data-surface-id");
    let step = surface === null ? tag : `${tag}[data-surface-id="${CSS.escape(surface)}"]`;
    const parent = node.parentElement;
    if (parent !== null && surface === null) {
      const same = [...parent.children].filter((sibling) => sibling.tagName === node!.tagName);
      if (same.length > 1) step += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    steps.unshift(step);
    if (tag === "body" || tag === "html" || unique(steps.join(" > "))) break;
  }
  return steps.join(" > ");
}

function roleOf(element: Element): string | undefined {
  const given = element.getAttribute("role");
  if (given !== null && given !== "") return given;
  const tag = element.tagName.toLowerCase();
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "input") return INPUT_ROLE[(element.getAttribute("type") ?? "text").toLowerCase()] ?? "textbox";
  return IMPLICIT_ROLE[tag];
}

function nameOf(element: Element): string | undefined {
  const document = element.ownerDocument;
  const label = element.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") return squeeze(label);
  const by = element.getAttribute("aria-labelledby");
  if (by !== null) {
    const named = squeeze(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
    if (named !== "") return named;
  }
  const labels = (element as HTMLInputElement).labels;
  if (labels !== undefined && labels !== null && labels.length > 0) {
    const named = squeeze([...labels].map((one) => one.textContent ?? "").join(" "));
    if (named !== "") return named;
  }
  for (const attribute of ["alt", "title", "placeholder"]) {
    const value = element.getAttribute(attribute);
    if (value !== null && value.trim() !== "") return squeeze(value);
  }
  if (/^(button|link|heading|tab|menuitem|option)$/.test(roleOf(element) ?? "")) {
    const named = squeeze(element.textContent ?? "");
    if (named !== "") return named;
  }
  return undefined;
}

/** Each `data-*` mark on the element and its ancestors, nearest first, as a selector part. */
function marksOf(element: Element): string[] {
  const marks: string[] = [];
  for (let node: Element | null = element; node !== null && marks.length < 12; node = node.parentElement) {
    for (const { name, value } of node.attributes) {
      if (!name.startsWith("data-") || name.startsWith("data-corner")) continue;
      marks.push(`${node.tagName.toLowerCase()}[${name}${value === "" ? "" : `="${redacted(name, value).slice(0, 80)}"`}]`);
    }
  }
  return marks;
}

/**
 * The names of the React components that drew `element`, nearest first, up to six: read from the fiber React keeps on
 * the nearest node it rendered, walking up through its owners. None where React drew nothing.
 */
function componentsOf(element: Element): string[] {
  let fiber: Fiber | undefined;
  for (let node: Element | null = element; node !== null && fiber === undefined; node = node.parentElement) {
    const key = Object.keys(node).find((one) => one.startsWith("__reactFiber$"));
    if (key !== undefined) fiber = (node as unknown as Record<string, Fiber>)[key];
  }
  const names: string[] = [];
  for (let at: Fiber | null | undefined = fiber; at !== undefined && at !== null && names.length < COMPONENT_LIMIT; at = at.return) {
    const name = componentName(at.type);
    if (name !== undefined && names.at(-1) !== name) names.push(name);
  }
  return names;
}

interface Fiber {
  readonly type: unknown;
  readonly return: Fiber | null | undefined;
}

function componentName(type: unknown): string | undefined {
  if (typeof type === "function") {
    const { displayName, name } = type as { displayName?: unknown; name?: unknown };
    const named = typeof displayName === "string" && displayName !== "" ? displayName : name;
    return typeof named === "string" && /^[A-Z]/.test(named) ? named : undefined;
  }
  if (typeof type === "object" && type !== null) {
    // memo and forwardRef wrap the component they name.
    const { displayName, render, type: inner } = type as { displayName?: unknown; render?: unknown; type?: unknown };
    if (typeof displayName === "string" && displayName !== "") return displayName;
    return componentName(render ?? inner);
  }
  return undefined;
}

const redacted = (name: string, value: string): string => (SECRET_NAME.test(name) || SECRET_VALUE.test(value) ? "[redacted]" : value);

/** The element's markup with only the kept attributes, secret-looking values redacted, at most HTML_LIMIT long. */
function htmlOf(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const node of [copy, ...copy.querySelectorAll("*")]) {
    if (/^(script|style|template)$/i.test(node.tagName)) {
      node.remove();
      continue;
    }
    for (const { name, value } of [...node.attributes]) {
      if (!KEPT.test(name)) node.removeAttribute(name);
      else node.setAttribute(name, redacted(name, value));
    }
  }
  const html = copy.outerHTML;
  return html.length > HTML_LIMIT ? `${html.slice(0, HTML_LIMIT - 1)}…` : html;
}
