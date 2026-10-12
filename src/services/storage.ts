import type {
  AttachmentKind,
  ChangeRequest,
  JobEntry,
  RequestAttachment,
  RequestStatus,
  RequestSummary,
} from "../types";

export class ApiError extends Error {
  constructor(
    message: string,
    public code = "SERVICE_ERROR",
    public currentRevision?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
function apiFailure(
  payload: { error?: string; code?: string; currentRevision?: number } | null,
): never {
  throw new ApiError(
    payload?.error || "The sync service is unavailable.",
    payload?.code,
    payload?.currentRevision,
  );
}

function env(name: string): string | undefined {
  const value = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return value?.[name];
}
const API_URL = env("VITE_APPS_SCRIPT_URL") || "/__api__";
function query(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}
async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The sync service did not respond in time. Try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function get<T>(params: Record<string, string | undefined>): Promise<T> {
  const separator = API_URL.includes("?") ? "&" : "?";
  const payload = await requestJson(
    `${API_URL}${separator}${query(params)}`,
    {},
    20000,
  );
  if (!payload || payload.ok === false) apiFailure(payload);
  return payload as T;
}
async function post<T>(body: Record<string, unknown>): Promise<T> {
  const payload = await requestJson(
    API_URL,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    },
    60000,
  );
  if (!payload || payload.ok === false) apiFailure(payload);
  return payload as T;
}
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/pdf" });
}

export async function listRequests(): Promise<RequestSummary[]> {
  const data = await get<{ requests: RequestSummary[] }>({
    action: "listRequests",
  });
  return data.requests;
}
export async function openRequest(id: string): Promise<ChangeRequest> {
  const data = await get<{ request: ChangeRequest }>({
    action: "openRequest",
    id,
  });
  const request = data?.request;
  // A truncated response used to reach the renderer and blank the whole app.
  // Failing here turns it into the ordinary "could not be opened" screen, which
  // always offers a way back to the request list.
  if (!request || typeof request !== "object" || !request.id || !request.job)
    throw new Error("That change order could not be loaded.");
  return request;
}
export async function saveRequest(
  request: ChangeRequest,
  expectedRevision: number,
  mutationId: string,
): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({
    action: "saveRequest",
    request,
    expectedRevision,
    mutationId,
  });
  return data.request;
}
export async function claimRequest(
  id: string,
  expectedRevision: number,
  estimatorName: string,
  mutationId: string,
): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({
    action: "claimRequest",
    id,
    expectedRevision,
    estimatorName,
    mutationId,
  });
  return data.request;
}
export async function transitionRequest(
  id: string,
  expectedRevision: number,
  status: RequestStatus,
  question: string,
  mutationId: string,
): Promise<ChangeRequest> {
  const data = await post<{ request: ChangeRequest }>({
    action: "transitionRequest",
    id,
    expectedRevision,
    status,
    question,
    mutationId,
  });
  return data.request;
}
export interface AttachmentUpload {
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  data: string;
}
export async function uploadAttachment(
  requestId: string,
  file: AttachmentUpload,
  attachmentId: string,
  mutationId: string,
): Promise<RequestAttachment> {
  const data = await post<{ attachment: RequestAttachment }>({
    action: "uploadAttachment",
    requestId,
    attachmentId,
    mutationId,
    file,
  });
  return data.attachment;
}
export async function fetchAttachment(
  requestId: string,
  attachmentId: string,
): Promise<{ name: string; blob: Blob }> {
  const data = await get<{ name: string; mimeType: string; data: string }>({
    action: "fetchAttachment",
    requestId,
    attachmentId,
  });
  return { name: data.name, blob: base64ToBlob(data.data, data.mimeType) };
}
export async function listJobs(): Promise<JobEntry[]> {
  const data = await get<{ jobs: JobEntry[] }>({ action: "listJobs" });
  return data.jobs;
}
export async function importJobs(jobs: JobEntry[]): Promise<JobEntry[]> {
  const data = await post<{ jobs: JobEntry[] }>({ action: "importJobs", jobs });
  return data.jobs;
}
export async function sendRequestEmail(
  requestId: string,
  recipient: string,
  subject?: string,
  request?: ChangeRequest,
): Promise<{ ok: boolean; message?: string; attachmentCount?: number }> {
  const data = await post<{
    ok: boolean;
    message?: string;
    attachmentCount?: number;
    recipient?: string;
  }>({
    action: "sendEmail",
    requestId,
    recipient,
    subject,
    request,
  });
  return data;
}
export interface DashboardData {
  requests: RequestSummary[];
  jobs: JobEntry[];
}
// Loads everything the home dashboard and job picker need in a single Apps
// Script round-trip (one cold start instead of three). Older deployments that
// predate the combined endpoint fall back to the individual list calls.
export async function loadDashboard(): Promise<DashboardData> {
  try {
    const data = await get<{
      requests: RequestSummary[];
      jobs: JobEntry[];
    }>({ action: "bootstrap" });
    return {
      requests: data.requests ?? [],
      jobs: data.jobs ?? [],
    };
  } catch (error) {
    const [requests] = await Promise.all([listRequests()]);
    let jobs: JobEntry[] = [];
    try {
      jobs = await listJobs();
    } catch {
      // The job directory is optional; the dashboard still loads without it.
    }
    return { requests, jobs };
  }
}
