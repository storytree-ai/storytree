/** `pnpm --filter @storytree/mark icons`: regenerates every fixed-colour file from the master drawing. */
import { writeIcons } from "./icons.js";

for (const file of writeIcons()) console.log(file);
