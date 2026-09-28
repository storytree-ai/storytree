/** esbuild embeds models as bytes; no network request is needed to draw a wisp. */
declare module '*.glb' {
  const bytes: Uint8Array;
  export default bytes;
}
