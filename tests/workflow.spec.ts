import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist";
import { resolve } from "node:path";

/**
 * The review page is where an estimator receives a quick request: they read
 * the intake, download the photos and files, start work, and mark the order
 * prepare a customer document, and mark the request complete. These tests pin that flow.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

const baseRequest = {
  id: "r1",
  revision: 1,
  createdAt: "",
  updatedAt: "2026-10-01T12:00:00.000Z",
  status: "submitted",
  estimatorName: "",
  submittedAt: "2026-10-01T12:00:00.000Z",
  informationQuestion: "",
  job: {
    customer: "York Ridge Apartments",
    customerPhone: "260-555-0144",
    customerEmail: "dana@example.com",
    address: "1200 York St, Fort Wayne, IN 46802",
    jobNumber: "F-26-0366-P",
    projectManager: "Dana Whitfield",
    branchName: "Hays + Sons Complete Restoration",
    branchAddress: "909 Production Road, Fort Wayne, IN 46808",
    branchPhone: "1-260-471-9110",
    branchContact: "",
    carrier: "",
    claim: "",
    orderNumber: "CO-01",
    date: "2026-10-01",
    insuranceRelated: true,
    originalContract: "167045.81",
    previousChanges: "0.00",
    addedDays: "0",
  },
  requestedChanges: [
    {
      id: "c1",
      room: "",
      action: "add",
      description: "Wet insulation behind the kitchen wall",
      reason: "",
      measurements: "",
      materials: "",
      scheduleImpact: "",
    },
  ],
  attachments: [
    {
      id: "a1",
      kind: "photo",
      name: "photo1.jpg",
      mimeType: "image/jpeg",
      size: 128,
      driveFileId: "drive-a1",
    },
    {
      id: "a2",
      kind: "document",
      name: "note.pdf",
      mimeType: "application/pdf",
      size: 64,
      driveFileId: "drive-a2",
    },
  ],
};

function summarize(r: any) {
  return {
    id: r.id,
    revision: r.revision,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    status: r.status,
    estimatorName: r.estimatorName,
    changesCount: r.requestedChanges.length,
    attachmentsCount: r.attachments.length,
    job: {
      customer: r.job.customer,
      jobNumber: r.job.jobNumber,
      projectManager: r.job.projectManager,
      orderNumber: r.job.orderNumber,
      address: r.job.address,
    },
  };
}

async function installMockApi(
  page: Page,
  overrides: Record<string, any> = {},
  failures: {
    save?: string;
    upload?: boolean;
    afterSave?: boolean;
    download?: boolean;
  } = {},
) {
  const requests = new Map<string, any>();
  const seed = { ...structuredClone(baseRequest), ...overrides };
  requests.set(seed.id, seed);
  const actions: string[] = [];
  const uploads: Record<string, any>[] = [];
  const uploaded = new Map<string, any>();
  const mutations = new Map<string, any>();
  const commit = (next: any) => {
    const previous = requests.get(next.id);
    const updated = {
      ...next,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    requests.set(updated.id, updated);
    return updated;
  };
  await page.route(apiRoute, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let action = url.searchParams.get("action") ?? "";
    let body: Record<string, any> = {};
    if (request.method() === "POST") {
      try {
        body = JSON.parse(request.postData() ?? "{}");
      } catch {
        body = {};
      }
      action = String(body.action ?? action);
    }
    actions.push(action);
    const respond = (obj: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    const id = url.searchParams.get("id") ?? body.id;
    const current = requests.get(id);
    switch (action) {
      case "bootstrap":
      case "listRequests":
        return respond({
          ok: true,
          requests: [...requests.values()].map(summarize),
          jobs: [],
        });
      case "listJobs":
        return respond({ ok: true, jobs: [] });
      case "openRequest":
        return respond({ ok: true, request: current });
      case "saveRequest": {
        if (mutations.has(body.mutationId))
          return respond({ ok: true, request: mutations.get(body.mutationId) });
        if (failures.save) {
          const code = failures.save;
          delete failures.save;
          return respond({
            ok: false,
            code,
            error:
              code === "CONFLICT"
                ? "A newer revision exists."
                : "Save failed. Retry.",
          });
        }
        const saved = commit(body.request);
        mutations.set(body.mutationId, saved);
        if (failures.afterSave) {
          delete failures.afterSave;
          return respond({
            ok: false,
            error: "Save response lost. Retry.",
            code: "SERVICE_ERROR",
          });
        }
        return respond({ ok: true, request: saved });
      }
      case "uploadAttachment": {
        uploads.push(body);
        if (failures.upload) {
          delete failures.upload;
          return respond({
            ok: false,
            code: "UPLOAD_FAILED",
            error: "Upload failed. Retry.",
          });
        }
        if (!uploaded.has(body.attachmentId))
          uploaded.set(body.attachmentId, {
            id: body.attachmentId,
            driveFileId: `drive-${body.attachmentId}`,
            name: body.file.name,
            mimeType: body.file.mimeType,
            size: body.file.size,
            kind: body.file.kind,
          });
        return respond({
          ok: true,
          attachment: uploaded.get(body.attachmentId),
        });
      }
      case "claimRequest":
        return respond({
          ok: true,
          request: commit({
            ...current,
            estimatorName: String(body.estimatorName ?? ""),
            status: "in_review",
          }),
        });
      case "transitionRequest": {
        const target = String(body.status ?? "");
        const status =
          target === "submitted" && current?.estimatorName
            ? "in_review"
            : target;
        return respond({
          ok: true,
          request: commit({
            ...current,
            status,
            informationQuestion:
              target === "needs_information" ? String(body.question ?? "") : "",
          }),
        });
      }
      case "fetchAttachment": {
        if (failures.download) {
          delete failures.download;
          return respond({
            ok: false,
            code: "SERVICE_ERROR",
            error: "File download failed.",
          });
        }
        const current = requests.get(url.searchParams.get("requestId") ?? "");
        const attachment = current?.attachments?.find(
          (item: any) => item.id === url.searchParams.get("attachmentId"),
        );
        const data =
          attachment?.mimeType === "application/pdf" ? "%PDF-1.4\n" : "fakejpg";
        return respond({
          ok: true,
          name: attachment?.name ?? "file",
          mimeType: attachment?.mimeType ?? "application/octet-stream",
          data: Buffer.from(data).toString("base64"),
        });
      }
      default:
        return respond({ ok: true });
    }
  });
  return { requests, actions, uploads, uploaded };
}

test("an estimator reviews, starts work, and marks the request complete", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");

  await expect(
    page.getByRole("heading", { name: "In queue", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Wet insulation behind the kitchen wall"),
  ).toBeVisible();

  await page.getByLabel("Estimator name").fill("Jamie Estimator");
  await page.getByRole("button", { name: "Start work" }).click();

  await expect(
    page.getByRole("heading", { name: "Estimator review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark complete" }).click();

  await expect(
    page.getByText(
      "This change order is finished and kept in the log for reference.",
    ),
  ).toBeVisible();
});

test("an estimator can send a request back for information and the PM responds", async ({
  page,
}) => {
  await installMockApi(page, {
    status: "in_review",
    estimatorName: "Jamie Estimator",
  });
  await page.goto("/#/requests/r1");

  await page.getByRole("button", { name: "Request more information" }).click();
  await page
    .getByLabel("Information request")
    .fill("What is the exact square footage?");
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(
    page.getByRole("heading", { name: "More information needed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("What is the exact square footage?"),
  ).toBeVisible();

  await page
    .getByLabel("Response")
    .fill("The affected area is 120 square feet.");
  await page.getByRole("button", { name: "Send response" }).click();

  // The response lands back with the estimator who asked for it.
  await expect(
    page.getByRole("heading", { name: "Estimator review", exact: true }),
  ).toBeVisible();
});

test("estimator saves final scope and credit, previews and downloads the customer PDF", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    status: "in_review",
    estimatorName: "Jamie Estimator",
    lineNumbers: "+12, -34",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/requests/r1");
  await expect(
    page.getByRole("button", { name: "Download customer PDF", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Finalize customer document", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark complete", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Change-order number", { exact: true }).fill("CO-02");
  await page
    .getByLabel("Change-order date", { exact: true })
    .fill("2026-10-11");
  await page.getByLabel("Added days", { exact: true }).fill("2");
  await expect(
    page.getByLabel("Final customer scope", { exact: true }),
  ).toHaveValue("Wet insulation behind the kitchen wall");
  await expect(
    page.getByLabel("Final change amount", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Known change amount", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Contractor representative", { exact: true }),
  ).toHaveValue("Jamie Estimator");
  await page
    .getByLabel("Final customer scope", { exact: true })
    .fill("Agreed replacement of kitchen insulation.\nCredit for unused trim.");
  const finalDirection = page.getByRole("group", {
    name: "Final change amount direction",
    exact: true,
  });
  await finalDirection
    .getByRole("button", { name: "Credit", exact: true })
    .click();
  await page.getByLabel("Final change amount", { exact: true }).fill("250.10");
  await page
    .getByLabel("Previous authorized changes", { exact: true })
    .fill("25.09");
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `tmp/request-summary/customer-editor-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download customer PDF", exact: true }),
  ).toBeEnabled();
  const saved = api.requests.get("r1");
  expect(saved.estimatorName).toBe("Jamie Estimator");
  expect(saved.status).toBe("in_review");
  expect(saved.finalChangeOrder.amount).toBe("-250.10");
  await page
    .getByRole("button", { name: "Finalize customer document", exact: true })
    .click();
  await expect(
    page.getByLabel("Final customer scope", { exact: true }),
  ).toHaveValue(
    "Agreed replacement of kitchen insulation.\nCredit for unused trim.",
  );
  await expect(
    page.getByLabel("Final change amount", { exact: true }),
  ).toHaveValue("250.10");
  await expect(
    page
      .getByRole("group", {
        name: "Final change amount direction",
        exact: true,
      })
      .getByRole("button", { name: "Credit", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview customer PDF", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "change-order-F-26-0366-P.pdf",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Finalize customer document",
      exact: true,
    }),
  ).toHaveCount(0);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download customer PDF", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("change-order-F-26-0366-P.pdf");
  const pdf = await getDocument({
    data: new Uint8Array(await readFile((await download.path())!)),
    disableFontFace: true,
  }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++)
    text += (await (await pdf.getPage(i)).getTextContent()).items
      .map((item: any) => item.str)
      .join(" ");
  for (const expected of [
    "Hays + Sons",
    "CO-02",
    "2026-10-11",
    "Agreed replacement of kitchen insulation.",
    "Credit for unused trim.",
    "-$250.10",
    "$166,820.80",
    "Owner signature",
    "Contractor signature",
  ])
    expect(text).toContain(expected);
  expect(text).not.toContain("999.00");
  expect(text).not.toContain("photo1.jpg");
  await pdf.destroy();
  expect(errors).toEqual([]);
});

test("estimate line references and submitted scope carry into document preparation, but the final price starts blank", async ({
  page,
}) => {
  await installMockApi(page, {
    status: "in_review",
    estimatorName: "Jamie Estimator",
    lineNumbers: "+12, -34",
  });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Finalize customer document", exact: true })
    .click();
  await expect(
    page.getByLabel("Final customer scope", { exact: true }),
  ).toHaveValue(baseRequest.requestedChanges[0].description);
  // The estimator owns pricing now: the final amount starts blank.
  await expect(
    page.getByLabel("Final change amount", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Estimate line number 1", { exact: true }),
  ).toHaveValue("12");
  await expect(
    page.getByLabel("Estimate line number 2", { exact: true }),
  ).toHaveValue("34");
  await expect(
    page
      .getByRole("group", { name: "Action for estimate line 2", exact: true })
      .getByRole("button", { name: "Remove", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("Contractor representative", { exact: true }),
  ).toHaveValue("Jamie Estimator");
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    baseRequest.job.customer,
  );
});

test("the review page previews a photo and downloads an attachment", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");

  // Preview the photo in the shared modal.
  await page
    .getByRole("button", { name: "Preview photo1.jpg", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "photo1.jpg" })).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();

  // Download the PDF; the browser receives the file under its stored name.
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download note.pdf", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("note.pdf");
});

test("edit details and separate notes, then download the saved summary PDF", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    requestedChanges: [
      ...structuredClone(baseRequest.requestedChanges),
      {
        ...structuredClone(baseRequest.requestedChanges[0]),
        id: "c2",
        room: "Bathroom",
        description: "Second change",
        measurements: "12 square feet",
        reason: "Hidden damage",
      },
    ],
  });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download summary PDF" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start work", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Customer name", { exact: true }).fill("José Customer");
  await page
    .getByLabel("Previous authorized changes", { exact: true })
    .fill("1250.19");
  await page
    .getByLabel("Description 1", { exact: true })
    .fill("Corrected kitchen note\nKeep this paragraph.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toBeVisible();
  expect(api.requests.get("r1").requestedChanges[1].measurements).toBe(
    "12 square feet",
  );
  expect(api.requests.get("r1").status).toBe("submitted");
  await expect(page.getByText("$168,296.00", { exact: true })).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download summary PDF" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("request-summary-F-26-0366-P.pdf");
  const bytes = await readFile((await download.path())!);
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
  }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++)
    text += (await (await pdf.getPage(i)).getTextContent()).items
      .map((item: any) => item.str)
      .join(" ");
  for (const expected of [
    "José Customer",
    "260-555-0144",
    "dana@example.com",
    "$168,296.00",
    "Corrected kitchen note",
    "Keep this paragraph",
    "Second change",
    "12 square feet",
    "photo1.jpg",
    "note.pdf",
  ])
    expect(text).toContain(expected);
  await pdf.destroy();
});

test("failed edits retain text, retry, and completed requests stay read only", async ({
  page,
}) => {
  await installMockApi(
    page,
    { status: "in_review", estimatorName: "Jamie Estimator" },
    { save: "SERVICE_ERROR" },
  );
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page.getByLabel("Description 1", { exact: true }).fill("Keep my edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save failed");
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Keep my edit",
  );
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByText("Keep my edit", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Mark complete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download summary PDF" }),
  ).toBeEnabled();
});

test("unsaved edits warn on Cancel, app navigation, and browser back", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByLabel("Description 1", { exact: true })
    .fill("Unsaved correction");
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Unsaved correction",
  );
  await page
    .getByRole("button", { name: "Back to requests", exact: true })
    .click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Unsaved correction",
  );
  await page.goBack();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Unsaved correction",
  );
  await expect(page).toHaveURL(/#\/requests\/r1$/);
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByText("Wet insulation behind the kitchen wall", { exact: true }),
  ).toBeVisible();
});

test("conflicting edits retain the draft and offer reload without a blind retry", async ({
  page,
}) => {
  await installMockApi(page, {}, { save: "CONFLICT" });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByLabel("Description 1", { exact: true })
    .fill("Conflicting edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Conflicting edit",
  );
  await expect(
    page.getByRole("button", { name: "Reload latest request" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reload latest request" }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue(
    "Conflicting edit",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload latest request" }).click();
  await expect(
    page.getByText("Wet insulation behind the kitchen wall", { exact: true }),
  ).toBeVisible();
});

test("attachment edits retry on stable identities and preserve the information request", async ({
  page,
}) => {
  const api = await installMockApi(
    page,
    {
      status: "needs_information",
      estimatorName: "Jamie Estimator",
      informationQuestion: "Send a photo.",
    },
    { upload: true },
  );
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove note.pdf", exact: true })
    .click();
  await page
    .getByLabel("Add photos or PDFs", { exact: true })
    .setInputFiles([
      resolve("tmp/fixtures/photo-800x600.png"),
      resolve("tmp/fixtures/no-text.pdf"),
    ]);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Upload failed");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toBeVisible();
  const saved = api.requests.get("r1");
  expect(saved.status).toBe("needs_information");
  expect(saved.estimatorName).toBe("Jamie Estimator");
  expect(saved.informationQuestion).toBe("Send a photo.");
  expect(saved.attachments.map((item: any) => item.name)).toEqual([
    "photo1.jpg",
    "photo-800x600.png",
    "no-text.pdf",
  ]);
  expect(api.uploads[0].attachmentId).toBe(api.uploads[1].attachmentId);
  expect(api.uploads[0].mutationId).toBe(api.uploads[1].mutationId);
  expect(api.uploaded.size).toBe(2);
});

test("a lost save response retries the committed revision instead of duplicating it", async ({
  page,
}) => {
  const api = await installMockApi(page, {}, { afterSave: true });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page.getByLabel("Description 1", { exact: true }).fill("Commit once");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save response lost");
  expect(api.requests.get("r1").revision).toBe(2);
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByText("Commit once", { exact: true })).toBeVisible();
  expect(api.requests.get("r1").revision).toBe(2);
});

test("legacy requests show unavailable information and validate money before saving", async ({
  page,
}) => {
  const api = await installMockApi(page, {
    job: {
      ...baseRequest.job,
      customerPhone: undefined,
      customerEmail: undefined,
      originalContract: "",
      previousChanges: "",
    },
    attachments: [],
  });
  await page.goto("/#/requests/r1");
  await expect(page.locator(".receipt-total")).toContainText("Not provided");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page
    .getByLabel("Original contract amount", { exact: true })
    .fill("NaN");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "at most two decimal places",
  );
  expect(api.requests.get("r1").revision).toBe(1);
  await page.getByLabel("Original contract amount", { exact: true }).fill("0");
  await page.getByLabel("Customer phone", { exact: true }).fill("555-0100");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".receipt-total")).toContainText("$0.00");
  expect(api.requests.get("r1").job.customerPhone).toBe("555-0100");
});

test("individual attachment downloads can be retried after a failure", async ({
  page,
}) => {
  await installMockApi(page, {}, { download: true });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Download note.pdf", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("File download failed");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download note.pdf", exact: true })
    .click();
  expect((await pending).suggestedFilename()).toBe("note.pdf");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("review and editor fit narrow and wide screens without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push(message.text());
  });
  await installMockApi(page);
  await page.goto("/#/requests/r1");
  await expect(
    page.getByRole("button", { name: "Download summary PDF" }),
  ).toBeVisible();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "tmp/request-summary/review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: "tmp/request-summary/review-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "tmp/request-summary/editor-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: "tmp/request-summary/editor-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("estimators copy saved answers and text, including after corrections", async ({
  page,
}) => {
  const copied: string[] = [];
  await page.exposeFunction("captureDashCopy", (text: string) =>
    copied.push(text),
  );
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => (window as any).captureDashCopy(text),
      },
    }),
  );
  await installMockApi(page, {
    requestType: "insurance_supplement",
    customerCredits: true,
  });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Copy Dash note", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Copied");
  for (const expected of [
    "Insurance supplement",
    "Customer credits: Yes",
    "Wet insulation behind the kitchen wall",
    "York Ridge Apartments",
    "photo1.jpg",
    "note.pdf",
  ])
    expect(copied[0]).toContain(expected);
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copy Dash note", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Change order", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Yes, customer credits", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit request", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Copy Dash note", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Copied");
  expect(copied[1]).toContain("Request type: Change order");
  expect(copied[1]).toContain("Customer credits: No");
});

test("blocked clipboard access offers selectable note text on completed requests", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Clipboard blocked")),
      },
    }),
  );
  await installMockApi(page, {
    status: "completed",
    requestType: "change_order",
    customerCredits: false,
  });
  await page.goto("/#/requests/r1");
  await page
    .getByRole("button", { name: "Copy Dash note", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Clipboard access is unavailable",
  );
  await expect(page.getByLabel("Dash note to copy manually")).toHaveValue(
    /Wet insulation behind the kitchen wall/,
  );
  await expect(page.getByLabel("Dash note to copy manually")).toHaveValue(
    /Customer credits: No/,
  );
});
