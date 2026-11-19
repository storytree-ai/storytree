// Capability 8 · Storytree's own test and gate entries.
export const unchained = (node) => node?.type === "ChainExpression" ? node.expression : node;

export function children(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || value === null || typeof value !== "object") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child !== null && typeof child === "object" && typeof child.type === "string") out.push(child);
    }
  }
  return out;
}

export function literal(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

export function regexOf(node) {
  if (node?.type === "Literal" && node.regex) return { source: node.regex.pattern, flags: node.regex.flags };
  if ((node?.type === "NewExpression" || node?.type === "CallExpression") && node.callee.type === "Identifier" && node.callee.name === "RegExp") {
    const [source, flags] = node.arguments.map(literal);
    if (source === undefined) return undefined;
    return { source, flags: node.arguments.length > 1 ? flags ?? "" : "" };
  }
  return undefined;
}

export function methodOf(call) {
  const callee = unchained(call.callee);
  if (callee?.type !== "MemberExpression") return undefined;
  return callee.computed ? literal(callee.property) : callee.property.name;
}

export const isReplace = (call) => {
  const method = methodOf(call);
  return method === "replace" || method === "replaceAll";
};

export const shownRegex = ({ source, flags }) => `/${source}/${flags}`;

export const shorten = (shown) => shown.length > 40 ? `${shown.slice(0, 37)}...` : shown;

const CLASS_ESCAPES = /^[dDwWsSbBpPkcxuv0-9]$/;

export function characters(source) {
  const inner = /^\((?:\?:)?(.*)\)$/s.exec(source)?.[1] ?? source;
  if (/^\\.$/s.test(inner)) return inner[1] === "\\" ? "matches" : CLASS_ESCAPES.test(inner[1]) ? undefined : "misses";
  if (/^[^\\[\](){}|.*+?^$]$/.test(inner)) return "misses";
  const [, negated, body] = /^\[(\^?)(.+)\]$/s.exec(inner) ?? [];
  if (body === undefined) return undefined;
  const chars = [];
  let matches = false;
  for (let at = 0; at < body.length; at++) {
    if (body[at] === "]") return undefined;
    if (body[at] !== "\\") chars.push(body[at]);
    else if (/[WDS]/.test(body[++at] ?? "")) matches = true;
    else chars.push(/[dws]/.test(body[at]) ? undefined : body[at]);
  }
  matches ||= chars.includes("\\") || chars.some((char, at) => chars[at + 1] === "-" && char !== undefined && chars[at + 2] !== undefined && char <= "\\" && "\\" <= chars[at + 2]);
  return matches !== (negated === "^") ? "matches" : "misses";
}

export function escapedBy(node) {
  const regex = regexOf(node);
  if (regex !== undefined) return { regex: true, shown: shownRegex(regex), backslash: characters(regex.source) };
  const text = literal(node);
  if (text?.length !== 1) return undefined;
  return { regex: false, shown: JSON.stringify(text), backslash: text === "\\" ? "matches" : "misses" };
}

function escapesBackslashFirst(node) {
  for (let call = unchained(node); call?.type === "CallExpression"; call = unchained(unchained(call.callee).object)) {
    if (!isReplace(call)) return false;
    if (literal(call.arguments[1])?.startsWith("\\") && escapedBy(call.arguments[0])?.backslash === "matches") return true;
  }
  return false;
}

export function partialEscape(call) {
  if (!isReplace(call)) return undefined;
  const [pattern, replacement] = call.arguments;
  const escaped = escapedBy(pattern);
  if (escaped === undefined || !literal(replacement)?.startsWith("\\") || escaped.backslash !== "misses") return undefined;
  return escapesBackslashFirst(unchained(call.callee).object) ? undefined : escaped;
}
