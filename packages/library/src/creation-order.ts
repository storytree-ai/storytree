/**
 * Capability 4 · Work model. Creation order, which capabilities 4 and 6 hand records back in: oldest first by `createdAt`,
 * and by id between records created in the same millisecond, so the order is the same every time
 * and on both backends. (`list` orders by id alone, which says nothing about when a record came.)
 */
export function byCreation(
  a: { readonly createdAt: string; readonly id: string },
  b: { readonly createdAt: string; readonly id: string },
): number {
  // createdAt is always an ISO 8601 UTC timestamp of one fixed shape, so text order is time order.
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
