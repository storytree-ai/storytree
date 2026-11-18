// Capability 7 · Library API

export const UNPRINTABLE = "�";

export function printable(text: string): string {
  return text.replace(/\r(?!\n)|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, UNPRINTABLE);
}
