/** Capability 3 · Arc surface. The arc surface story's surface, as the app's Surfaces menu lists it (ADR-0750). Plain data. */
export const arcSurfaces = [
  {
    id: "arcs",
    name: "Arcs",
    description: "The Arcs tab of the left rail, which shows each arc's work and opens what an arc holds under its row on a click. Off, the rail has no Arcs tab.",
    switchable: true,
    settings: [],
  },
] as const;
