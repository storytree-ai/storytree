// Capability 8 · Storytree's own test and gate entries.
import { unchained } from "./nodes.mjs";

const FAMILY = new Set(["equal", "notEqual", "strictEqual", "notStrictEqual", "deepEqual", "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "partialDeepStrictEqual"]);
const QUERIES = new Set([
  "querySelector", "querySelectorAll", "getElementById", "getElementsByClassName", "getElementsByTagName", "getElementsByTagNameNS",
  "getElementsByName", "closest", "createElement", "createElementNS", "createTextNode", "createComment", "createDocumentFragment",
  "elementFromPoint", "elementsFromPoint", "cloneNode", "importNode", "adoptNode", "attachShadow", "getRootNode", "appendChild",
  "insertBefore", "replaceChild", "removeChild",
]);
const NODE_PROPS = new Set([
  "activeElement", "documentElement", "firstChild", "firstElementChild", "lastChild", "lastElementChild", "parentElement", "parentNode",
  "nextSibling", "nextElementSibling", "previousSibling", "previousElementSibling", "childNodes", "ownerDocument", "shadowRoot",
  "selectedOptions", "contentDocument", "contentWindow", "defaultView", "offsetParent", "ownerElement", "assignedSlot",
  "scrollingElement", "fullscreenElement", "pointerLockElement", "srcElement",
]);
const HELD_PROPS = new Set([
  "body", "head", "document", "window", "children", "target", "currentTarget", "relatedTarget", "form", "options", "elements",
  "host", "labels", "style", "classList", "attributes", "content", "control", "list", "cells", "rows", "tBodies", "sheet",
]);
const KEEPS = new Set(["filter", "find", "findLast", "at", "slice", "sort", "toSorted", "reverse", "toReversed", "concat", "flat", "item", "values", "pop", "shift"]);
const VISITS = new Set(["forEach", "map", "filter", "find", "findLast", "findIndex", "findLastIndex", "some", "every", "flatMap"]);
const DOM_TYPE = /^(?:Node|Element|HTML\w*Element|SVG\w*Element|Document|DocumentFragment|ShadowRoot|Window|BrowserWindow|NodeList|NodeListOf|HTMLCollection|HTMLCollectionOf|Text|Comment|Attr|EventTarget|\w*Event|CSSStyleDeclaration|DOMTokenList|NamedNodeMap)$/;
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const WRAPPERS = new Set(["ChainExpression", "TSNonNullExpression", "TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion"]);
const SKIP_KEYS = new Set(["parent", "loc", "range", "tokens", "comments", "leadingComments", "trailingComments"]);
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const HAPPY_DOM = /^(?:happy-dom|@happy-dom\/[\w-]+)(?:\/|$)/;

function walk(node, parent, { parents, nodes, keys }) {
  parents.set(node, parent);
  nodes.push(node);
  for (const key of keys[node.type] ?? Object.keys(node).filter((name) => !SKIP_KEYS.has(name))) {
    const value = node[key];
    if (value === null || typeof value !== "object") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child !== null && typeof child === "object" && typeof child.type === "string") walk(child, node, { parents, nodes, keys });
    }
  }
}

function importsOf(program) {
  const imports = new Map();
  const importedNames = new Map();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      imports.set(specifier.local.name, statement.source.value);
      if (specifier.type === "ImportSpecifier") importedNames.set(specifier.local.name, specifier.imported.name ?? specifier.imported.value);
    }
  }
  return { imports, importedNames };
}

const isAssertModule = (source) => source === "assert" || source === "assert/strict" || source === "node:assert" || source === "node:assert/strict";

function isAssertion(callee, imports, importedNames) {
  if (callee.type === "Identifier") return FAMILY.has(importedNames.get(callee.name) ?? "") && isAssertModule(imports.get(callee.name) ?? "");
  if (callee.type !== "MemberExpression" || callee.computed || !FAMILY.has(callee.property.name)) return false;
  const object = callee.object;
  if (object.type === "Identifier") return object.name === "assert" || isAssertModule(imports.get(object.name) ?? "");
  return object.type === "MemberExpression" && !object.computed && object.property.name === "assert";
}

function propertyName(member) {
  if (!member.computed) return member.property.type === "Identifier" ? member.property.name : undefined;
  return member.property.type === "Literal" && typeof member.property.value === "string" ? member.property.value : undefined;
}

const keyName = (property) => property.key.name ?? property.key.value;

function domReader({ parents, nodes, imports }) {
  const declared = new Set(nodes.flatMap((node) => (/^(?:TSInterfaceDeclaration|TSTypeAliasDeclaration|TSEnumDeclaration|ClassDeclaration)$/.test(node.type) && node.id ? [node.id.name] : [])));
  const fromHappyDom = (name) => HAPPY_DOM.test(imports.get(name) ?? "");
  const domTypeName = (name) => fromHappyDom(name) || (DOM_TYPE.test(name) && !imports.has(name) && !declared.has(name));
  const assignments = nodes.filter((node) => node.type === "AssignmentExpression" && node.left.type === "Identifier");
  const returns = nodes.filter((node) => node.type === "ReturnStatement" && node.argument !== null);
  const seen = new Set();
  const following = new Set();

  function isDomType(type) {
    if (type === null || type === undefined) return false;
    switch (type.type) {
      case "TSTypeAnnotation": return isDomType(type.typeAnnotation);
      case "TSTypeReference":
        return (type.typeName.type === "Identifier" && domTypeName(type.typeName.name)) || (type.typeArguments?.params ?? type.typeParameters?.params ?? []).some(isDomType);
      case "TSArrayType": return isDomType(type.elementType);
      case "TSUnionType": case "TSIntersectionType": return type.types.some(isDomType);
      case "TSTupleType": return type.elementTypes.some((element) => isDomType(element.type === "TSNamedTupleMember" ? element.elementType : element));
      case "TSTypeOperator": case "TSOptionalType": case "TSRestType": return isDomType(type.typeAnnotation);
      case "TSTypeLiteral": return type.members.some((member) => isDomType(member.typeAnnotation));
      default: return false;
    }
  }

  function isDom(node) {
    if (node === null || node === undefined || seen.has(node)) return false;
    seen.add(node);
    try {
      return domExpression(node);
    } finally {
      seen.delete(node);
    }
  }

  function domExpression(node) {
    switch (node.type) {
      case "ChainExpression": case "TSNonNullExpression": case "TSSatisfiesExpression": case "AwaitExpression":
        return isDom(node.expression ?? node.argument);
      case "TSAsExpression": case "TSTypeAssertion":
        return isDomType(node.typeAnnotation) || isDom(node.expression);
      case "NewExpression":
        return (node.callee.type === "Identifier" && (node.callee.name === "Window" || fromHappyDom(node.callee.name))) || (node.callee.type === "MemberExpression" && isDom(node.callee.object));
      case "CallExpression":
        return callIsDom(node);
      case "MemberExpression": {
        const name = propertyName(node);
        if (name !== undefined && NODE_PROPS.has(name)) return true;
        if (name !== undefined && !HELD_PROPS.has(name)) return false;
        return isDom(node.object);
      }
      case "Identifier":
        return identifierIsDom(node);
      case "ArrayExpression":
        return node.elements.some((element) => element !== null && isDom(element.type === "SpreadElement" ? element.argument : element));
      case "ObjectExpression":
        return node.properties.some((property) => (property.type === "SpreadElement" ? isDom(property.argument) : property.type === "Property" && isDom(property.value)));
      case "ConditionalExpression":
        return isDom(node.consequent) || isDom(node.alternate);
      case "LogicalExpression":
        return isDom(node.left) || isDom(node.right);
      case "SequenceExpression":
        return isDom(node.expressions.at(-1));
      case "AssignmentExpression":
        return isDom(node.right);
      default:
        return false;
    }
  }

  function callIsDom(node) {
    const callee = unchained(node.callee);
    if (callee.type === "MemberExpression") {
      const name = propertyName(callee);
      if (name !== undefined && QUERIES.has(name)) return true;
      if (name !== undefined && KEEPS.has(name)) return isDom(callee.object);
      if (name === "from" && callee.object.type === "Identifier" && callee.object.name === "Array") return node.arguments.length === 1 && isDom(node.arguments[0]);
    }
    const fn = functionOf(callee);
    return fn !== undefined && returnsDom(fn);
  }

  function bindingInit(binding) {
    return binding.pattern === binding.id ? binding.declarator.init : readOf(binding.declarator.init, binding.pattern, binding.id);
  }

  function functionOf(node) {
    if (node === null || node === undefined || following.has(node)) return undefined;
    following.add(node);
    try {
      if (FUNCTIONS.has(node.type)) return node;
      if (WRAPPERS.has(node.type)) return functionOf(node.expression);
      if (node.type === "Identifier") {
        const binding = resolve(node);
        if (binding?.kind === "function") return binding.fn;
        return binding?.kind === "var" ? functionOf(bindingInit(binding)) : undefined;
      }
      if (node.type !== "MemberExpression") return undefined;
      const name = propertyName(node);
      return name === undefined ? undefined : functionOf(propertyValue(node.object, name));
    } finally {
      following.delete(node);
    }
  }

  function propertyValue(object, name) {
    if (object === null || object === undefined || following.has(object)) return undefined;
    following.add(object);
    try {
      if (WRAPPERS.has(object.type) || object.type === "AwaitExpression") return propertyValue(object.expression ?? object.argument, name);
      switch (object.type) {
        case "ObjectExpression":
          return object.properties.findLast((candidate) => candidate.type === "Property" && candidate.kind === "init" && !candidate.computed && keyName(candidate) === name)?.value;
        case "Identifier": {
          const binding = resolve(object);
          return binding?.kind === "var" ? propertyValue(bindingInit(binding), name) : undefined;
        }
        case "MemberExpression": {
          const key = propertyName(object);
          return key === undefined ? undefined : propertyValue(propertyValue(object.object, key), name);
        }
        case "CallExpression": {
          const fn = functionOf(object.callee);
          if (fn === undefined) return undefined;
          if (fn.body.type !== "BlockStatement") return propertyValue(fn.body, name);
          for (const node of returns) {
            if (enclosingFunction(node) !== fn) continue;
            const value = propertyValue(node.argument, name);
            if (value !== undefined) return value;
          }
          return undefined;
        }
        default:
          return undefined;
      }
    } finally {
      following.delete(object);
    }
  }

  function returnsDom(fn) {
    if (seen.has(fn)) return false;
    seen.add(fn);
    try {
      if (isDomType(fn.returnType)) return true;
      if (fn.body.type !== "BlockStatement") return isDom(fn.body);
      return returns.some((node) => enclosingFunction(node) === fn && isDom(node.argument));
    } finally {
      seen.delete(fn);
    }
  }

  function enclosingFunction(node) {
    for (let at = parents.get(node); at !== undefined; at = parents.get(at)) if (FUNCTIONS.has(at.type)) return at;
    return undefined;
  }

  function identifierIsDom(node) {
    const binding = resolve(node);
    if (binding === undefined) return node.name === "document" || node.name === "window";
    if (binding.kind === "var") {
      const { declarator, pattern, id } = binding;
      if (isDomType(id.typeAnnotation)) return true;
      if (assignments.some((assignment) => assignment.left.name === node.name && resolve(assignment.left)?.declarator === declarator && isDom(assignment.right))) return true;
      if (pattern === id) return declarator.init !== null && !FUNCTIONS.has(declarator.init?.type) && isDom(declarator.init);
      return destructuredIsDom(declarator.init, pattern, id);
    }
    if (binding.kind === "param") {
      const { fn, pattern, id } = binding;
      if (isDomType(id.typeAnnotation) || (pattern.type === "AssignmentPattern" && isDom(pattern.right))) return true;
      const call = parents.get(fn);
      if (pattern !== fn.params[0] || call?.type !== "CallExpression" || call.arguments[0] !== fn || call.callee.type !== "MemberExpression") return false;
      return VISITS.has(propertyName(call.callee)) && isDom(call.callee.object);
    }
    return binding.kind === "loop" && isDom(binding.right);
  }

  function destructuredIsDom(init, pattern, id) {
    if (init === null || init === undefined) return false;
    if (pattern.type === "ArrayPattern") return isDom(init);
    const step = pattern.type === "ObjectPattern" ? propertyRead(init, pattern, id) : undefined;
    if (step === undefined) return false;
    return step.inner === id ? isDom(step.read) : destructuredIsDom(step.read, step.inner, id);
  }

  function readOf(init, pattern, id) {
    if (init === null || init === undefined || pattern.type !== "ObjectPattern") return undefined;
    const step = propertyRead(init, pattern, id);
    if (step === undefined) return undefined;
    return step.inner === id ? step.read : readOf(step.read, step.inner, id);
  }

  function propertyRead(init, pattern, id) {
    const property = pattern.properties.find((candidate) => candidate.type === "Property" && contains(candidate.value, id));
    if (property === undefined || property.computed) return undefined;
    const read = { type: "MemberExpression", object: init, property: { type: "Identifier", name: keyName(property) }, computed: false };
    return { read, inner: property.value.type === "AssignmentPattern" ? property.value.left : property.value };
  }

  function contains(pattern, id) {
    if (pattern === id) return true;
    switch (pattern?.type) {
      case "ObjectPattern": return pattern.properties.some((property) => contains(property.type === "RestElement" ? property.argument : property.value, id));
      case "ArrayPattern": return pattern.elements.some((element) => element !== null && contains(element, id));
      case "AssignmentPattern": return contains(pattern.left, id);
      case "RestElement": return contains(pattern.argument, id);
      default: return false;
    }
  }

  function resolve(node) {
    for (let at = parents.get(node); at !== undefined; at = parents.get(at)) {
      const found = declaredIn(at, node.name);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function declaredIn(scope, name) {
    if (FUNCTIONS.has(scope.type)) {
      for (const param of scope.params) {
        const id = bound(param, name);
        if (id !== undefined) return { kind: "param", fn: scope, pattern: param, id };
      }
      if (scope.type === "FunctionExpression" && scope.id?.name === name) return { kind: "function", fn: scope };
      return undefined;
    }
    if (scope.type === "ForOfStatement" || scope.type === "ForInStatement") {
      const id = scope.left.type === "VariableDeclaration" ? bound(scope.left.declarations[0].id, name) : undefined;
      if (id === undefined) return undefined;
      return scope.type === "ForOfStatement" && id === scope.left.declarations[0].id ? { kind: "loop", right: scope.right } : { kind: "other" };
    }
    if (scope.type === "ForStatement" && scope.init?.type === "VariableDeclaration") return varIn(scope.init, name);
    if (scope.type === "CatchClause") return scope.param !== null && bound(scope.param, name) !== undefined ? { kind: "other" } : undefined;
    if (scope.type !== "Program" && scope.type !== "BlockStatement" && scope.type !== "StaticBlock") return undefined;
    for (const raw of scope.body) {
      const statement = raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration" ? raw.declaration ?? raw : raw;
      if (statement.type === "VariableDeclaration") {
        const found = varIn(statement, name);
        if (found !== undefined) return found;
      } else if (statement.type === "FunctionDeclaration" && statement.id?.name === name) {
        return { kind: "function", fn: statement };
      } else if ((statement.type === "ClassDeclaration" && statement.id?.name === name) || (statement.type === "ImportDeclaration" && statement.specifiers.some((specifier) => specifier.local.name === name))) {
        return { kind: "other" };
      }
    }
    return undefined;
  }

  function varIn(declaration, name) {
    for (const declarator of declaration.declarations) {
      const id = bound(declarator.id, name);
      if (id !== undefined) return { kind: "var", declarator, pattern: declarator.id, id };
    }
    return undefined;
  }

  function bound(pattern, name) {
    switch (pattern?.type) {
      case "Identifier": return pattern.name === name ? pattern : undefined;
      case "ObjectPattern":
        for (const property of pattern.properties) {
          const id = bound(property.type === "RestElement" ? property.argument : property.value, name);
          if (id !== undefined) return id;
        }
        return undefined;
      case "ArrayPattern":
        for (const element of pattern.elements) {
          const id = element === null ? undefined : bound(element, name);
          if (id !== undefined) return id;
        }
        return undefined;
      case "AssignmentPattern": return bound(pattern.left, name);
      case "RestElement": return bound(pattern.argument, name);
      case "TSParameterProperty": return bound(pattern.parameter, name);
      default: return undefined;
    }
  }

  return { isDom };
}

const shortened = (text) => {
  const shown = text.replace(/\s+/g, " ");
  return shown.length > 60 ? `${shown.slice(0, 57)}...` : shown;
};

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      nodeEqual: "{{callee}} compares {{shown}}, which may be a happy-dom node: a failure makes Node describe it without bound (about 29 GB, friction_edc7a93a10fe); " +
        "compare by identity with assert.ok(a === b, message), or compare a string or number read from it",
    },
  },
  create(context) {
    if (!TEST_FILE.test(context.filename)) return {};
    return {
      Program(program) {
        const { imports, importedNames } = importsOf(program);
        if (![...imports.values()].some((source) => HAPPY_DOM.test(source))) return;
        const parents = new WeakMap();
        const nodes = [];
        walk(program, undefined, { parents, nodes, keys: context.sourceCode.visitorKeys });
        const reader = domReader({ parents, nodes, imports });
        for (const node of nodes) {
          if (node.type !== "CallExpression" || !isAssertion(node.callee, imports, importedNames)) continue;
          const operand = node.arguments.slice(0, 2).find((argument) => reader.isDom(argument));
          if (operand === undefined) continue;
          const { sourceCode } = context;
          context.report({ node, messageId: "nodeEqual", data: { callee: sourceCode.getText(node.callee), shown: shortened(sourceCode.getText(operand)) } });
        }
      },
    };
  },
};
