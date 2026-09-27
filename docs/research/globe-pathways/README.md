# Pathways on a wider globe — throwaway look

Increment `0-3-planet-pathways-look`, ADR-0655 D3 and ADR-0169. This branch is a
picture experiment, never a pull request or an approved product implementation.

The instrument in `apps/desktop/globe-pathways` borrows `spike/globe-land`'s
capture path: the actual desktop page and forest engine, with Electron's reads
answered by an isolated fresh seed through `pageReads`. Product source stays
unchanged; explicit build substitutions provide the experimental pathways.

The finished evidence will compare the current globe with V1 (surface trails)
and V2 (slightly raised, faintly lit trails), front-on and a quarter turn. Radius,
coast clearance, capacity, routing limitations and renderer will be measured.
