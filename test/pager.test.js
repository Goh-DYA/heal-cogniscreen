import { test } from "node:test";
import assert from "node:assert/strict";
import { pagerPages } from "../public/report.js";

test("pagerPages returns empty array for zero sections", () => {
  assert.deepEqual(pagerPages(0, 0), []);
});

test("pagerPages shows every page when total is small", () => {
  assert.deepEqual(pagerPages(1, 0), [1]);
  assert.deepEqual(pagerPages(3, 1), [1, 2, 3]);
  assert.deepEqual(pagerPages(7, 3), [1, 2, 3, 4, 5, 6, 7]);
});

test("pagerPages truncates near the start", () => {
  assert.deepEqual(pagerPages(11, 0), [1, 2, 3, 4, 5, "…", 11]);
});

test("pagerPages truncates in the middle", () => {
  assert.deepEqual(pagerPages(11, 5), [1, "…", 5, 6, 7, "…", 11]);
});

test("pagerPages truncates near the end", () => {
  assert.deepEqual(pagerPages(11, 10), [1, "…", 7, 8, 9, 10, 11]);
});

test("pagerPages does not emit an ellipsis for a single skipped page", () => {
  assert.deepEqual(pagerPages(11, 2), [1, 2, 3, 4, 5, "…", 11]);
});

test("pagerPages keeps a fixed seven-slot shape for large page counts", () => {
  for (const current of [0, 2, 5, 10]) {
    assert.equal(pagerPages(11, current).length, 7);
  }
});
