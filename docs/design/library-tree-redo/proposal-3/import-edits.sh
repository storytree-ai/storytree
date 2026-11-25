set -e
S=packages/library/src
sed -i '14,15d' $S/project/index.ts
sed -i '3s#"../project/index.js"#"../project/storytree.js"#' $S/api/library.ts
sed -i '3a import { InheritedRecords } from "../project/index.js";' $S/api/library.ts
sed -i 's#import type { ConnectOptions } from "./storytree.js";#import type { ConnectOptions } from "./server.js";#' $S/project/address.ts $S/project/outside-writer.ts
sed -i '4d' $S/schema/types.ts
sed -i '/schedule.js\|story-survey.js/d' $S/schema/index.ts
sed -i '/import type { VectorDomain } from "..\/knowledge\/index.js";/d' $S/project/record-cache.ts
sed -i '2s#.*#import type { Note, NoteEdit } from "../knowledge/knowledge.js";\nimport type { SchemaRecord, WriteOptions } from "../schema/index.js";#' $S/decisions/supersede.ts
sed -i '2s#.*#import type { SchemaRecord, WriteOptions } from "../schema/index.js";#' $S/decisions/corrections.ts
sed -i '/corrections.js\|supersede.js\|adr.js/d' $S/decisions/index.ts
printf 'export { annotate, correct } from "../decisions/corrections.js";\nexport { DecisionRefusal, editDecision, recordDecision, supersede } from "../decisions/supersede.js";\n' >> $S/knowledge/index.ts
sed -i 's#import { ADR_FAMILY, editDecision, recordDecision } from "../decisions/index.js";#import { ADR_FAMILY } from "../decisions/adr.js";\nimport { editDecision, recordDecision } from "../knowledge/index.js";#' $S/commands/index.ts
