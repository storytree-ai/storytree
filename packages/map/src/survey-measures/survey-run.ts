// Capability 10 · Survey run time and memory measured
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import type { AnnotatedTree } from "@storytree/library";

import { codeSurveyReader } from "../code-survey/read-survey.js";

const [folder, treeFile] = process.argv.slice(2) as [string, string];
const tree = JSON.parse(readFileSync(treeFile, "utf8")) as AnnotatedTree;
const reader = codeSurveyReader({ checkout: "current" });
const cpuBefore = process.cpuUsage();
const started = performance.now();
const survey = await reader.read(folder, tree);
const wall = performance.now() - started;
const cpuUsed = process.cpuUsage(cpuBefore);
const cpu = (cpuUsed.user + cpuUsed.system) / 1000;
const peak = process.resourceUsage().maxRSS / 1024;
process.stdout.write(`${JSON.stringify({ stories: Object.keys(survey).length, wall, cpu, peak })}\n`);
