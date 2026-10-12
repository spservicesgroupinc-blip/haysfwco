export type RequestStatus =
  | "submitted"
  | "in_review"
  | "needs_information"
  | "completed";
export type AttachmentKind = "estimate" | "quote" | "photo" | "document";
export interface RequestedChange {
  id: string;
  room: string;
  action: "add" | "revise" | "remove";
  description: string;
  reason: string;
  measurements: string;
  materials: string;
  scheduleImpact: string;
}
export interface RequestAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  driveFileId: string;
}
export interface ChangeRequest {
  schemaVersion: 2;
  requestType?: "change_order" | "insurance_supplement";
  customerCredits?: boolean;
  /** Signed estimate line references, e.g. +12, -34; kept as submitted text. */
  lineNumbers?: string;
  finalChangeOrder?: { scope: string; amount: string };
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  estimatorName: string;
  submittedAt: string | null;
  informationQuestion: string;
  job: JobDetails;
  requestedChanges: RequestedChange[];
  attachments: RequestAttachment[];
  // Job directory row this request's job number was matched to, so the
  // original contract amount can be traced back to the uploaded report.
  jobDirectoryId?: string;
}
export interface RequestSummary {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  estimatorName: string;
  changesCount: number;
  attachmentsCount: number;
  job: Pick<
    JobDetails,
    "customer" | "jobNumber" | "projectManager" | "orderNumber" | "address"
  >;
}
export interface JobDetails {
  customer: string;
  customerPhone?: string;
  customerEmail?: string;
  address: string;
  jobNumber: string;
  projectManager: string;
  branchName: string;
  branchAddress: string;
  branchPhone: string;
  branchContact: string;
  carrier: string;
  claim: string;
  orderNumber: string;
  date: string;
  insuranceRelated: boolean;
  originalContract: string;
  previousChanges: string;
  addedDays: string;
}
// A row in the job directory, imported from the Dash JobSummaryReport on the
// Jobs page and read from the Jobs sheet. The PM picks one to autofill the
// request's job details.
export interface JobEntry {
  id: string;
  jobNumber: string;
  customer: string;
  address: string;
  projectManager: string;
  estimator: string;
  status: string;
  customerPhone: string;
  customerEmail: string;
  // Original contract amount from the report, normalized to the app's
  // canonical decimal string (e.g. "167045.81"); "" when the export carries no
  // amount for the job.
  contractAmount: string;
  active: boolean;
  updatedAt: string;
}
export const newId = () => crypto.randomUUID();
export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
