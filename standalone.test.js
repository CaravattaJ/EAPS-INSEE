import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");

test("the distributed HTML contains its CSS and JavaScript", () => {
  assert.match(html, /<style>[\s\S]*\.topbar/);
  assert.match(html, /<script>[\s\S]*const API_BASE/);
  assert.doesNotMatch(html, /<link[^>]+styles\.css/);
  assert.doesNotMatch(html, /<script[^>]+src="app\.js"/);
});

test("the standalone application has no unresolved merge markers", () => {
  assert.doesNotMatch(html, /^(<<<<<<<|=======|>>>>>>>)/m);
});
