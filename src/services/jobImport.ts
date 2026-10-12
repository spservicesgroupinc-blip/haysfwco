import { newId, type JobEntry } from "../types";

export interface JobImportResult {
  jobs: JobEntry[];
  warnings: string[];
  totalRows: number;
}

/** Parses standard CSV with support for quoted strings and commas within quotes. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      currentRow.push(currentField.trim());
      currentField = "";
      if (currentRow.some((f) => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function cleanMoney(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? "" : num.toFixed(2);
}

export function parseJobReport(csvText: string): JobImportResult {
  const warnings: string[] = [];
  const rows = parseCsvRows(csvText);

  if (rows.length === 0) {
    return { jobs: [], warnings: ["The CSV file is empty."], totalRows: 0 };
  }

  const headerRow = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const headerMap: Record<string, number> = {};
  headerRow.forEach((col, idx) => {
    headerMap[col] = idx;
  });

  const getCol = (aliases: string[]): number => {
    for (const alias of aliases) {
      const key = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (headerMap[key] !== undefined) return headerMap[key];
    }
    return -1;
  };

  const colJobNumber = getCol(["jobnumber", "job", "jobnum", "jobno", "filenumber"]);
  const colCustomer = getCol(["customer", "customername", "insured", "name"]);
  const colAddress = getCol(["jobaddress", "address", "lossaddress", "propertyaddress"]);
  const colCity = getCol(["losscity", "city"]);
  const colState = getCol(["lossstate", "state"]);
  const colZip = getCol(["losszip", "zip", "postalcode"]);
  const colPM = getCol(["foreperson", "projectmanager", "pm", "foreman"]);
  const colEstimator = getCol(["estimator"]);
  const colStatus = getCol(["status", "jobstatus"]);
  const colPhone = getCol(["customerphone", "phone", "contactphone"]);
  const colEmail = getCol(["customeremail", "email", "contactemail"]);
  const colAmount = getCol(["estimateamount", "contractamount", "amount", "price"]);

  if (colJobNumber === -1 && colCustomer === -1) {
    warnings.push("Could not find Job Number or Customer columns in CSV header.");
  }

  const jobs: JobEntry[] = [];
  const now = new Date().toISOString();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const getVal = (idx: number) => (idx >= 0 && idx < row.length ? row[idx].trim() : "");

    const jobNumber = getVal(colJobNumber);
    const customer = getVal(colCustomer);

    if (!jobNumber && !customer) {
      continue;
    }

    const street = getVal(colAddress);
    const city = getVal(colCity);
    const state = getVal(colState);
    const zip = getVal(colZip);

    let address = street;
    const cityStateZip = [city, state, zip].filter(Boolean).join(" ");
    if (cityStateZip) {
      address = address ? `${address}, ${cityStateZip}` : cityStateZip;
    }

    const status = getVal(colStatus) || "Active";
    const statusLower = status.toLowerCase();
    const active = !["closed", "cancelled", "canceled", "inactive", "archived"].includes(statusLower);

    jobs.push({
      id: newId(),
      jobNumber,
      customer,
      address,
      projectManager: getVal(colPM),
      estimator: getVal(colEstimator),
      status,
      customerPhone: getVal(colPhone),
      customerEmail: getVal(colEmail),
      contractAmount: cleanMoney(getVal(colAmount)),
      active,
      updatedAt: now,
    });
  }

  return {
    jobs,
    warnings,
    totalRows: rows.length - 1,
  };
}
