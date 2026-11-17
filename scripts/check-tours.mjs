import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const APP = path.join(SRC, "app");
const TOUR_PAGES = path.join(SRC, "lib", "tours", "pages");

const REDIRECT_ONLY = new Set([
  "/dashboard",
  "/dashboard/*",
  "/usg/survey",
  "/usg/personal-requests",
  "/lsg/survey",
  "/lsg/personal-requests",
]);

const REQUIRED_SHELL_ANCHORS = [
  "workspace-rail",
  "workspace-nav",
  "workspace-topbar",
  "workspace-main",
  "workspace-help",
];

let checks = 0;
let failures = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  return false;
}

function walk(dir) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function read(relativePath) {
  try {
    return readFileSync(path.join(ROOT, relativePath), "utf8");
  } catch {
    return "";
  }
}

function pageRoute(file) {
  const rel = path.relative(APP, file).replace(/\\/g, "/");
  if (!rel.endsWith("/page.tsx")) return null;
  let route = rel.slice(0, -"/page.tsx".length);
  route = route.replace(/\/\([^/]+\)/g, "");
  route = route.replace(/\[\.\.\.[^\]]+\]/g, "*");
  route = route.replace(/\[[^\]]+\]/g, "*");
  if (!route) return "/";
  return `/${route.replace(/\/$/, "")}`;
}

function routePattern(pattern) {
  return pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
}

function matches(route, pattern) {
  return new RegExp(`^${routePattern(pattern)}$`).test(route);
}

const pageFiles = walk(APP).filter((file) => file.endsWith("page.tsx"));
const routes = pageFiles
  .map(pageRoute)
  .filter((route) => route && !REDIRECT_ONLY.has(route));

const sourceFiles = walk(SRC).filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"));
const sourceText = sourceFiles
  .filter((file) => !file.startsWith(TOUR_PAGES))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

let tourFiles = [];
try {
  tourFiles = readdirSync(TOUR_PAGES).filter((file) => file.endsWith(".ts")).sort();
} catch {
  check("tour registry directory exists", false, `Missing ${path.relative(ROOT, TOUR_PAGES)}.`);
}

const tours = [];
for (const file of tourFiles) {
  const text = readFileSync(path.join(TOUR_PAGES, file), "utf8");
  const route = text.match(/route:\s*["']([^"']+)["']/)?.[1] ?? "";
  const targets = [...text.matchAll(/target:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const title = text.match(/title:\s*["']([^"']+)["']/)?.[1] ?? "";
  const body = text.match(/body:\s*["']([^"']+)["']/)?.[1] ?? "";
  const relative = path.relative(ROOT, path.join(TOUR_PAGES, file)).replace(/\\/g, "/");
  check(`${relative} declares a route`, Boolean(route), route ? "" : "Missing route: \"...\".");
  check(`${relative} declares at least one step`, targets.length > 0, "No target: \"...\" found.");
  check(`${relative} has step copy`, Boolean(title && body), "Every tour needs title and body copy.");
  if (route) tours.push({ file: relative, route, targets });
}

const duplicateRoutes = tours
  .map((tour) => tour.route)
  .filter((route, index, all) => all.indexOf(route) !== index);
check("tour registry has no duplicate route patterns", duplicateRoutes.length === 0, duplicateRoutes.join(", "));

const registryText = read("src/lib/tours/registry.ts");
for (const tour of tours) {
  const moduleName = path.basename(tour.file, ".ts");
  check(`registry exports ${moduleName}`, registryText.includes(`./pages/${moduleName}`), `Missing import for ./pages/${moduleName}.`);
}

for (const route of routes) {
  const matched = tours
    .filter((tour) => matches(route, tour.route))
    .sort((a, b) => b.route.length - a.route.length);
  check(`${route} has a registered tour`, matched.length > 0, "No route pattern matched.");
  if (matched.length === 0) continue;

  const targets = [...new Set(matched[0].targets)];
  for (const target of targets) {
    const anchor = new RegExp(`data-tour=["']${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    check(`${route} target "${target}" exists in JSX`, anchor.test(sourceText), `No data-tour="${target}" found.`);
  }
}

const rootLayout = read("src/app/layout.tsx");
check("root layout mounts TourProvider", /<TourProvider\b/.test(rootLayout), "Add <TourProvider> around {children}.");

const appShell = read("src/components/dashboard/AppShell.tsx");
for (const anchor of REQUIRED_SHELL_ANCHORS) {
  check(`AppShell has data-tour="${anchor}"`, appShell.includes(`data-tour="${anchor}"`), `Missing anchor ${anchor}.`);
}

console.log(`\n${checks - failures}/${checks} tour checks passed.`);
if (failures > 0) process.exitCode = 1;
