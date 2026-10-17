/**
 * Capability 7 · Master drawing and colour roles. The mark (Website's brand, packages/mark): storytree's mark, one master drawing in four
 * colour roles, its named colourways, and (capability 8) the fixed-colour icon files generated from it. Placing it on a
 * surface belongs to that surface's story.
 */
export { COLOURWAYS, markSvg, type MarkColours, type MarkRoles } from "./drawing.js";
export { renderMark } from "./raster.js";
export { ICNS_TYPES, ICO_SIZES, PNG_SIZES, readIcns, readIco, readPng, writeIcns, writeIco, writePng } from "./files.js";
export { iconPath, writeIcons } from "./icons.js";
