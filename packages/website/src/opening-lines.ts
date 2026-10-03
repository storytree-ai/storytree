export const OPENING_PROMPT = "Build me a shopping website";

/** `!` marks a warning line and `+` a good one in the copy; the marker itself is never shown. */
export function lineClass(text: string) {
  return text.startsWith("!") ? "is-warn" : text.startsWith("+") ? "is-ok" : "";
}
export const lineText = (text: string) => text.replace(/^[!+] /, "");
