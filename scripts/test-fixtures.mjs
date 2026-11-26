import { readFileSync } from "node:fs";

export const TEST_CREDENTIALS =
  "C:/Users/Julius M. Matro/Desktop/sir tonie projects/credentials/smartgov-test-accounts.txt";

const NAME_KEYS = [
  ["pedro", /Pedro Aquino|President Pedro/i],
  ["carlo", /Carlo Mendoza|President Carlo/i],
  ["nicole", /Nicole Ramos/i],
  ["rafael", /Rafael Castillo/i],
  ["sofia", /Sofia Navarro|President Juan/i],
  ["member", /Member Bea/i],
  ["reviewer", /President Juan/i],
];

export function readTestAccounts(path = TEST_CREDENTIALS) {
  const text = readFileSync(path, "utf8");
  const password = text.match(/Password for every account:\s*(\S+)/i)?.[1] ?? "";
  const emails = {};
  const lsgAccounts = [];
  let inLsg = false;

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*LSG\s*-/i.test(line)) {
      inLsg = true;
      continue;
    }
    if (/^\s*USG\s*-/i.test(line)) inLsg = false;
    const email = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
    if (!email) continue;
    if (/^\s*Owner\s*\/\s*Founder/i.test(line)) {
      emails.usg = email;
      emails.owner = email;
    }
    for (const [key, pattern] of NAME_KEYS) {
      if (pattern.test(line)) emails[key] = email;
    }
    if (inLsg) {
      const unitName = line.match(/^\s*(College of [A-Za-z\s]+?)\s{2,}/)?.[1]?.trim();
      lsgAccounts.push({ email, unitName: unitName ?? null });
    }
  }

  emails.lsg = emails.lsg ?? emails.pedro ?? lsgAccounts[0]?.email ?? "";
  emails.lsg2 = emails.lsg2 ?? emails.carlo ?? lsgAccounts[1]?.email ?? "";
  emails.member = emails.member ?? emails.sofia ?? lsgAccounts[4]?.email ?? emails.lsg2;
  emails.reviewer = emails.reviewer ?? emails.rafael ?? lsgAccounts[3]?.email ?? emails.lsg2;
  if (!password || !emails.usg || !emails.lsg) {
    throw new Error("Fixture credentials are missing expected accounts.");
  }
  return { password, emails, lsgAccounts };
}
