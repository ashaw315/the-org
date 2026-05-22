import { sql } from "./db.mjs";

const SURNAMES = [
  "Alvarez", "Chen", "Park", "Whitfield", "Okonkwo", "Nguyen", "Patel",
  "Rossi", "Muller", "Sato", "Costa", "Haddad", "Kowalski", "Brandt",
  "Owusu", "Lindqvist", "Delgado", "Yamamoto", "Ibrahim", "Novak",
  "Reyes", "Schaffer", "Bauer", "Mensah", "Petrov", "Fontaine",
];

const COMPANIES = [
  "a Series B logistics platform", "a leading fintech",
  "a category-defining SaaS company", "a stealth AI startup",
  "a top-tier consumer app", "a hypergrowth marketplace",
  "an enterprise data company", "a well-funded productivity startup",
  "a vertically integrated commerce platform",
];

const SENIORITY = [
  "",
  "Senior ",
  "Senior Principal ",
  "Senior Principal Staff ",
  "Distinguished Senior Principal Staff ",
  "Distinguished Senior Principal Staff Lead ",
];

const CORES = [
  "Product Manager",
  "Product Manager of Product",
  "PM of Product (Product)",
];

const NUMERALS = ["", " II", " III", " IV"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Titles inflate with the org's age. A title at `level` is at least as
// inflated as everything before it. Higher = longer, more impressive, emptier.
function inflateTitle(level) {
  const s = SENIORITY[Math.min(level, SENIORITY.length - 1)];
  const c = CORES[Math.min(Math.floor(level / 2), CORES.length - 1)];
  const numIdx = Math.max(0, Math.min(level - SENIORITY.length + 1, NUMERALS.length - 1));
  return (s + c + NUMERALS[numIdx]).trim();
}

function newName(existing) {
  for (let i = 0; i < 50; i++) {
    const initial = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    // occasionally hyphenate two surnames — the org loves a compound
    const surname = Math.random() < 0.18
      ? `${pick(SURNAMES)}-${pick(SURNAMES)}`
      : pick(SURNAMES);
    const name = `${initial}. ${surname}`;
    if (!existing.has(name)) return name;
  }
  return `${String.fromCharCode(65 + Math.floor(Math.random() * 26))}. ${pick(SURNAMES)}-${pick(SURNAMES)}`;
}

const bio = () => `previously at ${pick(COMPANIES)}, passionate about user outcomes`;

// Choose this sprint's PM of record.
// 70% a new hire, 30% a returning name whose title inflates further.
export async function pickPM(sprintNumber) {
  const prior = await sql`
    select pm_name,
           (array_agg(pm_title order by number desc))[1] as latest_title,
           count(*)::int as appearances
    from sprints
    where number > 0 and pm_name is not null
    group by pm_name
  `;
  const names = new Set(prior.map((r) => r.pm_name));
  const recur = prior.length > 0 && Math.random() < 0.3;

  if (recur) {
    const r = pick(prior);
    // a returning PM's title inflates by one level past the org's current floor
    const level = Math.min(sprintNumber, SENIORITY.length + NUMERALS.length - 1);
    return { name: r.pm_name, title: inflateTitle(level), bio: bio() };
  }

  const name = newName(names);
  const level = Math.min(Math.floor(sprintNumber * 0.6), SENIORITY.length + NUMERALS.length - 1);
  return { name, title: inflateTitle(level), bio: bio() };
}
