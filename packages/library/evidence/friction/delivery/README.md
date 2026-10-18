# Delivery stamp evidence

Increment: `increment_43168ad064e7`.

`red.txt` records pushed red `1138d9f`: the domain route and MCP route both accepted tool work without a live increment naming the friction. Tests also cover unrelated/closed increments, a matching live increment, writer attribution, a later trimmed stamp after the remedy closes, preservation and the delivered-work exemption when omitted, blank-reference refusal without a write, and stamping directly through MCP.

Reference: frozen 0.2 `packages/cli/src/friction.ts`: live increments naming friction at 620–668; trimming and blank-reference refusal at 811–813; field-scoped stamp writes at 886–895; delivered-work exemption at 946–969. This port implements those behaviors through 0.3's existing `increment.remedies` and `friction.dischargedBy` fields, with no wholesale code copy or schema migration. No requested reference behavior was left out.

The public `route` function keeps writer options and adds optional `dischargedBy` in `RouteOptions`. The librarian's MCP route tool carries that field on the agent server and permits updating an already-routed report by id. The library field already existed; `editNote` preserves it when omitted.

Library update: `../library-update/delivery.patch` and its checklist. Apply after the recurrence patch so the as-built note retains both changes.
