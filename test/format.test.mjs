import { test } from "node:test";
import assert from "node:assert/strict";

import { agoText, dirLabel, sessionsSignature } from "../public/format.js";

const NOW = Date.parse("2026-09-24T17:00:00Z");

test("agoText buckets recent activity", () => {
  assert.equal(agoText(new Date(NOW - 20_000).toISOString(), NOW), "just now");
  assert.equal(agoText(new Date(NOW - 5 * 60_000).toISOString(), NOW), "5m ago");
  assert.equal(agoText(new Date(NOW - 3 * 3600_000).toISOString(), NOW), "3h ago");
  assert.equal(agoText(new Date(NOW - 2 * 86400_000).toISOString(), NOW), "2d ago");
  assert.equal(agoText(new Date(NOW - 40 * 86400_000).toISOString(), NOW), "1mo ago");
  assert.equal(agoText("not a date", NOW), "just now");
});

test("dirLabel shortens long paths on both separators", () => {
  assert.equal(
    dirLabel("/srv/data/state/t3/worktrees/backrooms/t3code-56e57a54"),
    "backrooms/t3code-56e57a54",
  );
  assert.equal(dirLabel("C:\\Users\\me\\project"), "me/project");
  assert.equal(dirLabel("/tmp"), "tmp");
  assert.equal(dirLabel(""), "");
  assert.equal(dirLabel(null), "");
});

test("sessionsSignature tracks sessions, costs and age", () => {
  const session = {
    id: "ses_1",
    updatedAt: new Date(NOW - 5 * 60_000).toISOString(),
    cost: 1,
  };
  assert.equal(sessionsSignature([], NOW), "");
  assert.equal(sessionsSignature([session], NOW), sessionsSignature([session], NOW));
  assert.notEqual(
    sessionsSignature([{ ...session, cost: 2 }], NOW),
    sessionsSignature([session], NOW),
  );
  assert.notEqual(
    sessionsSignature([session, { ...session, id: "ses_2" }], NOW),
    sessionsSignature([session], NOW),
  );
});
