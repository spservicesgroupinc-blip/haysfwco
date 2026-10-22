import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCustomerCsv } from "../src/documents/services/customerReference";
import { parseJobReport } from "../src/services/jobImport";

const csv = '\uFEFFCustomer Name,Job Number,Contract Price,Property Address,City,State,ZIP Code,Phone,Email,Project Manager,Estimator,Job Status,Insurance Carrier,Claim Number\r\n"Smith, Jane",FW-123,"$1,234.50",10 Main St,Fort Wayne,IN,46802,260-555-0123,jane@example.com,Alex,Sam,Active,Acme,CL-12';

test("both uploads retain contact, assignment, claim, and structured address columns", () => {
  const reference = parseCustomerCsv(csv).customers[0];
  const job = parseJobReport(csv).jobs[0];
  assert.equal(reference.customerPhone, "260-555-0123");
  assert.equal(reference.customerEmail, "jane@example.com");
  assert.equal(reference.projectManager, "Alex");
  assert.equal(reference.estimator, "Sam");
  assert.equal(reference.status, "Active");
  assert.equal(reference.carrier, "Acme");
  assert.equal(reference.claim, "CL-12");
  assert.equal(reference.zip, "46802");
  assert.equal(job.contractAmount, "1234.50");
  assert.equal(job.customerPhone, reference.customerPhone);
  assert.equal(job.carrier, reference.carrier);
  assert.equal(job.claim, reference.claim);
  assert.equal(job.address, "10 Main St, Fort Wayne IN 46802");
  assert.equal(job.jobAddress, "10 Main St");
  assert.equal(job.city, "Fort Wayne");
});

test("customer uploads can supply jobs without a price column and retain zero amounts", () => {
  assert.equal(parseCustomerCsv("Insured,File Number,Address\nJane,FW-1,10 Main St").customers[0].contractPrice, null);
  assert.equal(parseCustomerCsv("Customer,Job Number,Estimate Amount\nJane,FW-1,0").customers[0].contractPrice, 0);
});

test("both uploads reject malformed CSV and invalid currency instead of silently shifting data", () => {
  for (const parse of [parseCustomerCsv, parseJobReport]) {
    assert.throws(() => parse('Customer,Job Number,Contract Price\n"Jane,FW-1,100'), /quoted field/i);
    assert.throws(() => parse('Customer,Job Number,Contract Price\nJane,FW-1,100abc'), /contract price/i);
  }
});

test("shared customer import rejects duplicate job numbers without replacing the list", () => {
  assert.throws(() => parseCustomerCsv("Customer,Job Number\nJane, fw-1 \nJoe,FW-1"), /duplicate job number/i);
});

test("Dash contacts, foreperson, supervisor, and dates fill both shared imports", () => {
  const csv = 'Customer,Job Number,Customer Main Phone,Secondary Email,ForePerson,Supervisor,Date Inspected,Date Started,Date Target Completion\nJane,FW-1,260-555-0123,jane2@example.com,Alex,Sam,12/30/2025 17:03:41,2/6/2026 10:46:54,10/31/2026';
  const reference = parseCustomerCsv(csv).customers[0];
  const job = parseJobReport(csv).jobs[0];
  for (const row of [reference, job]) {
    assert.equal(row.customerPhone, '260-555-0123');
    assert.equal(row.secondaryEmail, 'jane2@example.com');
    assert.equal(row.projectManager, 'Alex');
    assert.equal(row.foreman, 'Alex');
    assert.equal(row.supervisor, 'Sam');
    assert.equal(row.dateInspected, '2025-12-30');
    assert.equal(row.startDate, '2026-02-06');
    assert.equal(row.finishDate, '2026-10-31');
  }
  assert.throws(() => parseCustomerCsv(csv.replace('10/31/2026', '2/30/2026')), /invalid date/);
});
