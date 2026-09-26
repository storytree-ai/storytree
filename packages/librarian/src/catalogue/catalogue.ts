import type { Library, Note } from "@storytree/library";

export interface NewNote {
  readonly note: Note;
  readonly lookalikes: Note[];
}
export async function retire(_library: Library, _id: string, _reason: string): Promise<void> {
  throw new Error("not built yet");
}
export async function newNotes(_library: Library, _cursor: number): Promise<NewNote[]> {
  throw new Error("not built yet");
}
