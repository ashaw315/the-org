import Anthropic from "@anthropic-ai/sdk";
import { sql } from "./lib/db.mjs";
import { pickPM } from "./lib/pm.mjs";
import { SYSTEM_PROMPT, buildUserMessage } from "./lib/prompt.mjs";

const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// --- read current state ---------------------------------------------------

async function nextSprintNumber() {
  const r = await sql`select coalesce(max(number), -1) + 1 as n from sprints`;
  return r[0].n; // sprint 0 is seeded, so first generated sprint is 1
}

async function getPreviousSprints(limit = 10) {
  const rows = await sql`
    select number, prd, pm_name from sprints
    order by number desc limit ${limit}
  `;
  const out = [];
  for (const row of rows) {
    const tix = await sql`
      select title from tickets where sprint_number = ${row.number} order by id
    `;
    out.push({
      n: row.number,
      vision_statement: row.prd?.vision_statement ?? "",
      pm_of_record: row.pm_name,
      shipped_tickets: tix.map((t) => t.title),
    });
  }
  return out;
}

async function getFeatureManifest() {
  return sql`select name, sprint_number, status from features order by id`;
}

// --- parse the model output -----------------------------------------------

function parseJSON(text) {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model output");
  const obj = JSON.parse(t.slice(start, end + 1));
  if (!obj.prd || !Array.isArray(obj.tickets) || !obj.standup_notes) {
    throw new Error("output missing required fields");
  }
  return obj;
}

// --- persist ---------------------------------------------------------------

async function persist(n, pm, out) {
  await sql`
    insert into sprints (number, pm_name, pm_title, pm_bio, prd, standup_notes, release_notes)
    values (
      ${n}, ${pm.name}, ${pm.title}, ${pm.bio},
      ${JSON.stringify(out.prd)}::jsonb,
      ${out.standup_notes},
      ${out.release_notes_for_previous_sprint ?? null}
    )
  `;
  let i = 0;
  for (const t of out.tickets) {
    i += 1;
    const id = `PM-${n}-${i}`; // namespaced so ids never collide across sprints
    await sql`
      insert into tickets (id, sprint_number, title, description, acceptance_criteria, priority, estimate)
      values (
        ${id}, ${n}, ${t.title}, ${t.description ?? null},
        ${JSON.stringify(t.acceptance_criteria ?? [])}::jsonb,
        ${t.priority ?? "P2"}, ${t.estimate ?? "M"}
      )
    `;
  }
}

// --- run -------------------------------------------------------------------

async function main() {
  const n = await nextSprintNumber();

  const existing = await sql`select 1 from sprints where number = ${n}`;
  if (existing.length && !FORCE) {
    console.error(`Sprint ${n} already exists. Use --force to overwrite logic, or bump.`);
    process.exit(1);
  }

  const [previousSprints, featureManifest, pm] = await Promise.all([
    getPreviousSprints(),
    getFeatureManifest(),
    pickPM(n),
  ]);

  console.log(`\nSprint ${n} — PM of record: ${pm.name}, ${pm.title}`);

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0.9,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildUserMessage({ sprintNumber: n, previousSprints, featureManifest, pm }) },
    ],
  });

  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const out = parseJSON(text);

  console.log(`\nPRD: ${out.prd.title}`);
  console.log(`vision: "${out.prd.vision_statement}"`);
  console.log(`tickets: ${out.tickets.length}`);
  console.log(`\n--- release notes ---\n${out.release_notes_for_previous_sprint}`);
  console.log(`\n--- standup ---\n${out.standup_notes}\n`);

  if (DRY) {
    console.log("[dry run] nothing written. full JSON below:\n");
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  await persist(n, pm, out);
  console.log(`✓ Sprint ${n} written. Reload the live site — the spine reflects it immediately.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
