import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequest } from "../src/services/requests";
import {
  signedMoneyCents,
  finalContractTotal,
  finalDocumentError,
  pricingInputError,
  customerDocumentDraft,
} from "../src/services/changeOrder";
import { formatDashNote } from "../src/services/dashNote";
import { createRequestedChange } from "../src/services/requests";

test("document preparation inherits scope entries and job information, with no submitted price", () => {
  const request = createRequest();
  request.estimatorName = "Jamie Estimator";
  request.job.originalContract = "1000.00";
  request.lineNumbers = "+12, -34";
  request.requestedChanges = [
    {
      ...createRequestedChange(),
      room: "Kitchen",
      description: "Replace insulation",
      measurements: "12 square feet",
      materials: "R-13",
      scheduleImpact: "2 days",
    },
    {
      ...createRequestedChange(),
      action: "remove",
      room: "Bedroom",
      description: "Credit unused trim",
    },
  ];
  const draft = customerDocumentDraft(request);
  assert.equal(draft.finalChangeOrder!.amount, "");
  for (const text of [
    "Change 1 - Kitchen (add)",
    "Replace insulation",
    "12 square feet",
    "R-13",
    "2 days",
    "Change 2 - Bedroom (remove)",
    "Credit unused trim",
  ])
    assert.ok(draft.finalChangeOrder!.scope.includes(text));
  assert.equal(draft.lineNumbers, request.lineNumbers);
  assert.equal(draft.job.branchContact, "Jamie Estimator");
  assert.equal(draft.job.originalContract, "1000.00");
  assert.equal(request.finalChangeOrder, undefined);
  request.requestedChanges = [
    {
      ...createRequestedChange(),
      room: "Kitchen",
      action: "remove",
      description: "Unused trim",
    },
  ];
  assert.ok(
    customerDocumentDraft(request).finalChangeOrder!.scope.includes(
      "Kitchen - remove work",
    ),
  );
});

test("preparation preserves estimator corrections and does not invent a price", () => {
  const request = createRequest();
  request.requestedChanges = [
    { ...createRequestedChange(), description: "Submitted scope" },
  ];
  request.job.branchContact = "Branch Manager";
  request.finalChangeOrder = {
    scope: "Estimator revised scope",
    amount: "0.00",
  };
  const draft = customerDocumentDraft(request);
  assert.deepEqual(draft.finalChangeOrder, request.finalChangeOrder);
  assert.equal(draft.job.branchContact, "Branch Manager");
  request.finalChangeOrder = { scope: "Estimator revised scope", amount: "" };
  assert.deepEqual(customerDocumentDraft(request).finalChangeOrder, {
    scope: "Estimator revised scope",
    amount: "",
  });
});

test("signed changes preserve exact cents, credits, and explicit zero", () => {
  const request = createRequest();
  request.job.originalContract = "1000.01";
  request.job.previousChanges = "20.09";
  request.finalChangeOrder = { scope: "Replace insulation", amount: "+30.10" };
  assert.equal(finalContractTotal(request), "$1,050.20");
  request.finalChangeOrder.amount = "-250.20";
  assert.equal(finalContractTotal(request), "$769.90");
  request.finalChangeOrder.amount = "0";
  assert.equal(finalContractTotal(request), "$1,020.10");
  request.finalChangeOrder.amount = "";
  assert.equal(finalContractTotal(request), "Unavailable");
  for (const value of ["+-12", "--12", "+1.234", "1e3", "$12", "1,000"])
    assert.equal(signedMoneyCents(value), null, value);
});

test("signed line references validate and copy without approving the price", () => {
  const request = createRequest();
  request.lineNumbers = "+12, -34\n+56";
  assert.equal(pricingInputError(request), "");
  const note = formatDashNote(request);
  assert.ok(note.includes("Estimate line numbers: +12, -34\n+56"));
  assert.equal(finalContractTotal(request), "Unavailable");
  for (const value of ["12", "-0", "+1.5", "++12", "+12,"])
    assert.ok(pricingInputError({ lineNumbers: value }), value);
});

test("customer documents require saved scope, explicit final price and valid contract details", () => {
  const request = createRequest();
  assert.ok(finalDocumentError(request));
  Object.assign(request.job, {
    customer: "Customer",
    address: "123 Street",
    jobNumber: "F-1",
    originalContract: "100.01",
    previousChanges: "",
    addedDays: "0",
  });
  request.finalChangeOrder = { scope: "Agreed scope", amount: "0.00" };
  assert.equal(finalDocumentError(request), "");
  request.job.date = "2026-02-30";
  assert.match(finalDocumentError(request), /valid change-order date/);
  request.job.date = "2026-10-11";
  request.job.addedDays = "2.5";
  assert.match(finalDocumentError(request), /whole number/);
});
