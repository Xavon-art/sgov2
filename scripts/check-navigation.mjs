import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = join(root, "src", "app");
const srcDir = join(root, "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function routeFromPage(file) {
  let route = relative(appDir, file).replace(/\\/g, "/").replace(/(^|\/)page\.tsx$/, "");
  if (route === "" || route === "index") return "/";
  route = `/${route}`;
  // Route groups do not appear in the URL.
  route = route.replace(/\/\([^/]+\)/g, "");
  return route.replace(/\/$/, "") || "/";
}

function routePattern(route) {
  const escaped = route
    .split("/")
    .map((part) => {
      if (/^\[\.\.\.[^\]]+\]$/.test(part) || /^\[[^\]]+\]$/.test(part)) return "[^/]+";
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped || "/"}$`);
}

const routes = walk(appDir)
  .filter((file) => file.endsWith(`${sep}page.tsx`))
  .map(routeFromPage);
const patterns = [...new Set(routes)].map((route) => ({ route, re: routePattern(route) }));

function matchesRoute(path) {
  return patterns.some(({ re }) => re.test(path));
}

function normalizeCandidate(raw) {
  let path = raw.trim();
  if (!path.startsWith("/")) return null;
  path = path.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (!path) path = "/";
  // Static check: template segments stand in for a dynamic route parameter.
  path = path.replace(/\$\{[^}]+\}/g, "*");
  // A glob may only stand in for one or more real segments.
  path = path.replace(/\*/g, "__STAR__");
  return path;
}

function isGlobbed(path) {
  return path.includes("__STAR__");
}

function globMatches(path) {
  const escaped = path
    .split("/")
    .map((part) => (part === "__STAR__" ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  const glob = new RegExp(`^${escaped || "/"}$`);
  return patterns.some(({ re }) => re.test(path.replace(/__STAR__/g, "_")) || glob.test(path));
}

const patternsToCheck = [
  { label: "href", re: /\bhref\s*=\s*(?:"([^"]+)"|\{"([^"]+)"\}|\{`([^`]+)`\})/g },
  { label: "router", re: /\brouter\.(?:push|replace)\(\s*(?:"([^"]+)"|`([^`]+)`)/g },
  { label: "redirect", re: /\bredirect\(\s*(?:"([^"]+)"|`([^`]+)`)/g },
  { label: "location", re: /\bwindow\.location(?:\.href)?\s*=\s*(?:"([^"]+)"|`([^`]+)`)/g },
];

const findings = [];
const unsafeBack = [];
const files = walk(srcDir).filter((file) => /\.(ts|tsx)$/.test(file));

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file).replace(/\\/g, "/");
  if (/\b(?:router|history|window\.history)\.back\s*\(/.test(text)) unsafeBack.push(rel);
  for (const { label, re } of patternsToCheck) {
    for (const match of text.matchAll(re)) {
      const raw = match.slice(1).find((value) => typeof value === "string");
      if (!raw) continue;
      const path = normalizeCandidate(raw);
      if (!path) continue;
      if (isGlobbed(path)) {
        if (!globMatches(path)) findings.push({ file: rel, label, raw, problem: "dynamic path has no matching route" });
      } else if (!matchesRoute(path)) {
        findings.push({ file: rel, label, raw, problem: "no matching page route" });
      }
    }
  }
}

console.log(`navigation audit: ${routes.length} routes, ${files.length} source files`);
if (unsafeBack.length) {
  for (const file of unsafeBack) console.log(`FAIL  ${file} uses history back navigation`);
}
for (const finding of findings) {
  console.log(`FAIL  ${finding.file} [${finding.label}] ${finding.raw}: ${finding.problem}`);
}
const failures = unsafeBack.length + findings.length;
if (failures > 0) {
  console.log(`navigation audit: ${failures} problem(s)`);
  process.exit(1);
}
console.log("navigation audit: all internal links and redirects resolve");
