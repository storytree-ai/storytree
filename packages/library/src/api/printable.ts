/**
 * Capability 7 · Library API. Library text as a terminal may show it (contract 7.20): every control
 * character a terminal would act on becomes a placeholder, so a title or a file name read from the
 * library can only ever print as text. Line breaks and tabs stay, and so does a carriage return that
 * ends a line (`\r\n`); every other C0 character, DEL and every C1 character is replaced.
 *
 * It imports nothing, so the command line's door may load it statically and stay light (contract 1.3).
 */

/** What a control character prints as. */
export const UNPRINTABLE = "�";

/** `text` with every control character but `\n`, `\t` and a line-ending `\r` replaced by UNPRINTABLE. */
export function printable(text: string): string {
  return text.replace(/\r(?!\n)|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, UNPRINTABLE);
}
