import { chromium } from "playwright";
import { put } from "@vercel/blob";
import { sql } from "./lib/db.mjs";

// The live product. Override with CAPTURE_BASE_URL in .env.
const BASE = process.env.CAPTURE_BASE_URL || "https://the-product-red.vercel.app";

// The full set: the surface, then every spine index page.
const ROUTES = ["/", "/changelog", "/roadmap", "/research", "/org", "/status", "/specs"];

const VIEWPORT = { width: 1280, height: 900 };

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error("BLOB_READ_WRITE_TOKEN is not set");
}

async function currentSprint() {
  const r = await sql`select coalesce(max(number), 0)::int as n from sprints`;
  return r[0].n;
}

// Storage: Vercel Blob. Uploads the PNG and returns a public URL.
// Stable key per sprint+page, overwritten on re-run.
async function store(key, buffer) {
  const { url } = await put(key, buffer, {
    access: "public",
    contentType: "image/png",
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return url;
}

async function main() {
  const n = await currentSprint();
  console.log(`Capturing sprint ${n} from ${BASE}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });

  for (const route of ROUTES) {
    const url = BASE + route;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(900); // let the entrance animation settle
      const buffer = await page.screenshot({ fullPage: true });
      const slug = route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "_");
      const key = `captures/sprint-${n}/${slug}.png`;
      const imageUrl = await store(key, buffer);
      // idempotent: replace any prior capture of this page for this sprint
      await sql`delete from captures where sprint_number = ${n} and page = ${route}`;
      await sql`
        insert into captures (sprint_number, page, image_url)
        values (${n}, ${route}, ${imageUrl})
      `;
      console.log(`  ✓ ${route} -> ${imageUrl}`);
    } catch (e) {
      console.error(`  ✗ ${route} failed: ${e.message}`);
    }
  }

  await browser.close();
  console.log(`Done. Captured sprint ${n}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
