/**
 * Self-check for the project-data blob. No test framework — run it directly:
 *   node --experimental-strip-types frontend/src/lib/projectData.selfcheck.ts
 */
import assert from "node:assert/strict";
import type { Annotation } from "../components/oct/OctCanvas";
import {
  DEFAULT_FILE_KEY,
  DEFAULT_SCALE,
  parseProjectData,
  serializeProjectData,
} from "./projectData.ts";

const layer = (labelId: string): Annotation => ({
  id: "a",
  labelId,
  type: "layer",
  points: [{ x: 1, y: 2 }],
});

// ── Empty / malformed input is honest, never a crash ────────────────────────
for (const raw of [null, undefined, "", "[]", "not json", "{{"]) {
  const d = parseProjectData(raw as string | null | undefined);
  assert.deepEqual(d.scale, DEFAULT_SCALE, `default scale for ${JSON.stringify(raw)}`);
  assert.deepEqual(d.dims, {});
}

// ── v1 flat maps still load, under the default key ──────────────────────────
{
  const v1 = JSON.stringify({ 0: [layer("ilm")], 3: [layer("rpe")] });
  const d = parseProjectData(v1);
  assert.ok(d.files[DEFAULT_FILE_KEY], "v1 migrates under the default key");
  assert.equal(d.files[DEFAULT_FILE_KEY]![0]!.length, 1);
  assert.deepEqual(d.scale, DEFAULT_SCALE);
}

// ── v2 without scale/dims (blobs written before this feature) ───────────────
{
  const old = JSON.stringify({ __v: 2, files: { "scan.tif": { 0: [layer("ilm")] } } });
  const d = parseProjectData(old);
  assert.ok(d.files["scan.tif"], "files survive");
  assert.deepEqual(d.scale, DEFAULT_SCALE, "missing scale falls back");
  assert.deepEqual(d.dims, {}, "missing dims falls back");
}

// ── THE REGRESSION THIS GUARDS ──────────────────────────────────────────────
// The annotate page autosaves every 2s. If a save rebuilt the blob from `files`
// alone, the user's scale and dims would vanish within seconds. Round-tripping
// through serialize -> parse must preserve everything.
{
  const original = parseProjectData(null);
  original.files["scan.tif"] = { 0: [layer("ilm")] };
  original.scale = { umPerPxLateral: 20, umPerPxAxial: 3, umPerSlice: 55 };
  original.dims["scan.tif"] = { width: 1000, height: 1024, sliceCount: 100 };

  // Simulate an autosave: parse the stored blob, splice one file, re-serialise.
  const stored = serializeProjectData(original);
  const reloaded = parseProjectData(stored);
  reloaded.files["scan.tif"] = { 0: [layer("ilm")], 1: [layer("rpe")] };
  const afterSave = parseProjectData(serializeProjectData(reloaded));

  assert.deepEqual(afterSave.scale, original.scale, "scale survives an autosave");
  assert.deepEqual(afterSave.dims, original.dims, "dims survive an autosave");
  assert.equal(Object.keys(afterSave.files["scan.tif"]!).length, 2, "the edit landed");
}

// ── Sibling files are not clobbered ─────────────────────────────────────────
{
  const d = parseProjectData(null);
  d.files["a.tif"] = { 0: [layer("ilm")] };
  d.files["b.tif"] = { 0: [layer("rpe")] };
  const back = parseProjectData(serializeProjectData(d));
  assert.deepEqual(Object.keys(back.files).sort(), ["a.tif", "b.tif"]);
}

// ── Junk scale/dims values fall back rather than poisoning measurements ─────
{
  const junk = JSON.stringify({
    __v: 2,
    files: {},
    scale: { umPerPxLateral: 0, umPerPxAxial: null, umPerSlice: "18" },
    dims: { "a.tif": { width: 0, height: 10, sliceCount: 5 }, "b.tif": "nope" },
  });
  const d = parseProjectData(junk);
  assert.deepEqual(d.scale, DEFAULT_SCALE, "zero/null/string all fall back");
  assert.deepEqual(d.dims, {}, "dims with a zero dimension are dropped, not kept");
}

console.log("projectData.selfcheck: all assertions passed");
