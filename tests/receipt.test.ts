import assert from "node:assert/strict";
import test from "node:test";

import { receiptDigest } from "../src/validation.ts";

test("receipt digests are immutable for equivalent structured content", () => {
  const receipt = Object.freeze({
    id: "trial-a",
    status: "unmeasured",
    cleanup: { status: "completed" },
  });

  assert.equal(
    receiptDigest(receipt),
    receiptDigest(JSON.parse(JSON.stringify(receipt))),
  );
  assert.match(receiptDigest(receipt), /^sha256:[0-9a-f]{64}$/);
});
