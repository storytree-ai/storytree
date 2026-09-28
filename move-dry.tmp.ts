import pg from "pg";
import { connect } from "@storytree/library";
import { locateStorytree } from "@storytree/agent-link";
const cloudSql = { instance: "storytree-498613:australia-southeast1:storytree-pg", user: "hua.mick@gmail.com" };
const name = "t-movecheck";
// Drop the earlier dry run's copy, borrowing the creator role.
const cloud = await connect({ cloudSql });
const admin = await cloud.ownDatabase("storytree-activity"); // any pool on the instance, for its client
const c = await admin.connect();
await c.query("SET ROLE storytree_creator");
await c.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
c.release();
const local = locateStorytree();
if (!local.running) throw new Error("local app not running");
const here = await connect({ url: local.url });
const snap = await here.snapshot("storytree");
const t1 = Date.now();
await cloud.restore(name, { ...snap, project: name });
console.log("restored", snap.records.length, "records,", snap.history.length, "history in", Date.now() - t1, "ms");
const back = await cloud.snapshot(name);
console.log("cloud copy", back.records.length, back.history.length, "last seq", back.history.at(-1)?.seq, "vs", snap.history.at(-1)?.seq);
await here.close(); await cloud.close();
void pg;
