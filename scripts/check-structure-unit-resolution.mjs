import assert from "node:assert/strict";

function resolveOwnStructureUnit(chart, isOwner) {
  const root = chart.root;
  const belowRoot = root ? chart.units.filter((u) => u.id !== root.id) : chart.units;
  if (isOwner) return root ?? belowRoot[0] ?? null;
  if (chart.scope === "unit") return belowRoot[0] ?? null;
  return belowRoot.find((u) => u.unitType === "lsg") ?? belowRoot[0] ?? root ?? null;
}

function run(name, fn) { fn(); console.log(`PASS ${name}`); }

run("unit-scope non-owner resolves to non-root LSG unit", () => {
  const chart = { scope: "unit", root: { id: "usg", name: "USG", unitType: "usg" }, units: [
    { id: "usg", name: "USG", unitType: "usg", parentId: null, seats: [] },
    { id: "lsg", name: "College LSG", unitType: "college", parentId: "usg", seats: [] },
  ] };
  assert.equal(resolveOwnStructureUnit(chart, false)?.id, "lsg");
});

run("unit-scope non-owner never falls back to root", () => {
  const chart = { scope: "unit", root: { id: "usg", name: "USG", unitType: "usg" }, units: [
    { id: "usg", name: "USG", unitType: "usg", parentId: null, seats: [] },
  ] };
  assert.equal(resolveOwnStructureUnit(chart, false), null);
});

run("owner resolves to root", () => {
  const chart = { scope: "organization", root: { id: "usg", name: "USG", unitType: "usg" }, units: [
    { id: "usg", name: "USG", unitType: "usg", parentId: null, seats: [] },
    { id: "lsg", name: "College LSG", unitType: "lsg", parentId: "usg", seats: [] },
  ] };
  assert.equal(resolveOwnStructureUnit(chart, true)?.id, "usg");
});

console.log("structure unit resolution checks passed");
