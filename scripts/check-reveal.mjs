/**
 * Guards the scroll-reveal contract.
 *
 * The bug this exists to catch: `.reveal` was authored as `opacity: 0`, so
 * every server component shipped invisible markup that only became legible
 * after hydration and an IntersectionObserver callback. It is a one-line CSS
 * mistake and it degrades the whole page, so it is worth an automated check.
 *
 * The contract:
 *   1. The base `.reveal` rule must be visible.
 *   2. The hidden state may only exist behind the `.has-js` gate.
 *   3. layout.tsx must set that gate inline, before first paint.
 *   4. Inline transition-delay must never exceed Reveal's MAX_DELAY.
 *
 * Run after `next build` to also check the prerendered HTML.
 *   node scripts/check-reveal.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `.pathname` -- the repo path contains a space and would
// otherwise stay percent-encoded.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

let failures = 0;
let checks = 0;

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
const reveal = readFileSync(join(ROOT, "src/components/fx/Reveal.tsx"), "utf8");

// Strip comments first so brace matching cannot be thrown off by prose.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

// Every `selector { body }` block. Deliberately not anchored on `(^|})`:
// a global match consumes the closing brace, so the next rule would have
// nothing to anchor against and would be silently skipped.
function blocksFor(selectorPattern) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(cssNoComments))) {
    const selector = m[1].trim();
    if (selectorPattern.test(selector)) out.push({ selector, body: m[2] });
  }
  return out;
}

const revealBlocks = blocksFor(/\.reveal\b/);
const baseBlock = revealBlocks.find((b) => b.selector === ".reveal");
const gatedBlock = revealBlocks.find((b) => b.selector === ".has-js .reveal");

console.log("\nscroll-reveal contract\n");

// 1. The base rule must not hide anything.
check(
  "base .reveal is visible by default",
  Boolean(baseBlock) && /opacity:\s*1/.test(baseBlock.body),
  baseBlock ? `found: ${baseBlock.selector} { ${baseBlock.body.trim()} }` : "no base .reveal rule found",
);

// 2. No ungated rule may set opacity 0 -- that is the exact original defect.
const ungatedHidden = revealBlocks.filter(
  (b) => !b.selector.includes(".has-js") && /opacity:\s*0\b/.test(b.body),
);
check(
  "no ungated .reveal rule sets opacity: 0",
  ungatedHidden.length === 0,
  ungatedHidden.length
    ? ungatedHidden.map((b) => `${b.selector} { ${b.body.trim()} }`).join("\n        ")
    : "",
);

// 3. The gated hidden state must still exist, or nothing animates.
check(
  "hidden state exists behind .has-js",
  Boolean(gatedBlock) && /opacity:\s*0/.test(gatedBlock.body),
  gatedBlock ? `found: ${gatedBlock.selector}` : "no .has-js .reveal rule found",
);

// 4. The revealed state must promote back to visible.
const shownBlock = revealBlocks.find(
  (b) => b.selector === '.has-js .reveal[data-shown="true"]',
);
check(
  "revealed state restores opacity 1",
  Boolean(shownBlock) && /opacity:\s*1/.test(shownBlock.body),
  shownBlock ? `found: ${shownBlock.selector}` : "no .has-js .reveal[data-shown=true] rule found",
);

// 5. will-change must be demoted once the element settles.
check(
  "will-change is demoted after reveal",
  Boolean(shownBlock) && /will-change:\s*auto/.test(shownBlock.body),
  shownBlock ? `found: ${shownBlock.selector}` : "",
);

// 6. layout.tsx must set the gate inline, before paint.
check(
  "layout.tsx adds has-js via inline script",
  /classList\.add\(\s*["']has-js["']\s*\)/.test(layout),
);
check(
  "has-js script is in <head>, not deferred",
  /<head>[\s\S]*has-js[\s\S]*<\/head>/.test(layout),
);

// 7. The delay clamp must be wired into the rendered inline style.
const maxDelay = reveal.match(/MAX_DELAY\s*=\s*([\d.]+)/);
check("Reveal declares MAX_DELAY", Boolean(maxDelay));
if (maxDelay) {
  check(
    "Reveal clamps the rendered transitionDelay",
    /style=\{\{\s*transitionDelay:\s*`\$\{stagger\}s`\s*\}\}/.test(reveal),
  );
  check(
    "Reveal clamps via Math.min",
    /Math\.min\(\s*Math\.max\(\s*delay/.test(reveal),
  );
}

// 8. Reduced motion must clear the inline delay too, not just the duration.
const reducedBlock = css.slice(css.indexOf("prefers-reduced-motion"));
check(
  "reduced-motion block zeroes transition-delay",
  /transition-delay:\s*0s\s*!important/.test(reducedBlock),
);
check(
  "reduced-motion block overrides the .has-js hidden state",
  /\.has-js \.reveal/.test(reducedBlock),
);

// --- Prerendered HTML, when a build is present -------------------------
const appDir = join(ROOT, ".next/server/app");
if (existsSync(appDir)) {
  const htmlFiles = readdirSync(appDir).filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    console.log("\n  SKIP  no prerendered .html in .next/server/app\n");
  } else {
    console.log("");
    for (const file of htmlFiles) {
      const html = readFileSync(join(appDir, file), "utf8");
      const delays = [...html.matchAll(/transition-delay:([\d.]+)s/g)].map((m) =>
        Number(m[1]),
      );
      const max = delays.length ? Math.max(...delays) : 0;

      // _global-error is Next's own document and replaces the root layout
      // entirely, so it never gets the inline script. That is correct: with no
      // `has-js` class the content is visible, which is the safe direction.
      if (file === "_global-error.html") {
        check(
          `${file}: renders without the gate (content stays visible)`,
          !/classList\.add\(\s*["']has-js["']\s*\)/.test(html) &&
            !/data-shown="false"/.test(html),
        );
        continue;
      }

      check(
        `${file}: inline script sets has-js`,
        /classList\.add\(\s*["']has-js["']\s*\)/.test(html),
      );
      check(
        `${file}: max transition-delay is within clamp (${max}s)`,
        max <= 0.12,
        `found ${delays.length} inline delays, max ${max}s`,
      );
    }
  }
}

console.log(
  failures === 0
    ? `\nall ${checks} checks passed\n`
    : `\n${failures} of ${checks} checks FAILED\n`,
);

process.exit(failures === 0 ? 0 : 1);
