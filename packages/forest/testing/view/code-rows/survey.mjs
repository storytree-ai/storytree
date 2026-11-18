import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCodeSurvey } from '@storytree/forest/code-survey';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const seed = JSON.parse(gunzipSync(readFileSync(path.join(here, 'seed.json.gz'))).toString('utf8'));
const survey = await readCodeSurvey(root, seed.tree);
writeFileSync(path.join(here, 'survey.json'), JSON.stringify(survey, null, 1) + '\n');
console.log(Object.fromEntries(Object.entries(survey).map(([id, s]) => [id, s.files.length])));
