import { createHash, randomUUID } from 'node:crypto';
import type { Workspace, JobDocument } from '../src/workspaces/types.ts';

type Payload = Record<string, any>;
type Result = Record<string, any>;
interface LocalRequest { id: string; revision: number; updatedAt: string; workspaceId?: string }
class LocalApiError extends Error {
  constructor(readonly code: string, message: string, readonly currentRevision?: number) { super(message); }
}
function fail(code: string, message: string, revision?: number): never { throw new LocalApiError(code, message, revision); }
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const identifier = (value: unknown, label: string): string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : fail('VALIDATION', `A valid ${label} identifier is required.`);
function mutation(body: Payload) {
  identifier(body.mutationId, 'mutation');
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) fail('VALIDATION', 'A valid expected revision is required.');
}
function money(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40) fail('VALIDATION', 'Enter a decimal dollar amount.');
  const text = value.trim(); if (!text) return '';
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(text)) fail('VALIDATION', 'Dollar amounts must have at most two decimal places.');
  const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
  const normalized = whole.replace(/^0+(?=\d)/, ''); const cents = fraction.padEnd(2, '0');
  if (normalized.length > 13) fail('VALIDATION', 'Dollar amount is too large.');
  return `${text.startsWith('-') && (normalized !== '0' || cents !== '00') ? '-' : ''}${normalized}.${cents}`;
}
function workspaceShape(input: Payload): Workspace {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'A workspace is required.');
  identifier(input.id, 'workspace');
  const sections = ['branch', 'customer', 'insurance', 'financials', 'team', 'mortgage', 'changeOrder', 'productionNotes', 'checklist'];
  const roots = ['id', 'recordId', 'dateCreated', 'updatedAt', 'schemaVersion'];
  if (!input.record || typeof input.record !== 'object' || Array.isArray(input.record)) fail('VALIDATION', 'A job record is required.');
  for (const key of Object.keys(input.record)) if (!sections.includes(key) && !roots.includes(key)) fail('VALIDATION', `Unknown job record section: ${key}`);
  for (const section of sections) {
    const values = input.record[section];
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 200) fail('VALIDATION', `Invalid job ${section} section.`);
    for (const [key, value] of Object.entries(values)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 100 || !(value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 100000 || typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e13)) fail('VALIDATION', `Invalid value in job ${section}.`);
    }
  }
  const workspace = { id: input.id, revision: 0, updatedAt: '', record: structuredClone(input.record), originalContract: money(input.originalContract), previousChanges: money(input.previousChanges), ...(input.sourceRecordId === undefined ? {} : { sourceRecordId: input.sourceRecordId }), ...(input.migration === undefined ? {} : { migration: structuredClone(input.migration) }) } as Workspace;
  if (Buffer.byteLength(JSON.stringify(workspace)) > 1000000) fail('VALIDATION', 'This job record exceeds the supported 1 MB size.');
  return workspace;
}

/** Explicit local /__api__ fixture only. Never imported by the browser application.
 * State is isolated per Vite server and resets on restart; no live services are called.
 */
export function createWorkspaceDevApi<T extends LocalRequest>(requests: T[]) {
  const workspaces = new Map<string, { workspace: Workspace; mutations: Map<string, string> }>();
  const documents = new Map<string, { document: JobDocument; data: string; mutationId: string; hash: string }>();
  const links = new Map<string, Map<string, string>>();
  let reference: Payload = { customers: [], fileName: '', updatedAt: '', updatedBy: '', version: '' };
  const requireWorkspace = (id: unknown) => {
    const found = workspaces.get(identifier(id, 'workspace'));
    if (!found) fail('NOT_FOUND', 'Job workspace not found.');
    return found;
  };
  const respond = (action: string, body: Payload): Result | undefined => {
    if (action === 'listWorkspaces') return { ok: true, workspaces: [...workspaces.values()].map(item => item.workspace).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    if (action === 'openWorkspace') return { ok: true, workspace: requireWorkspace(body.workspaceId).workspace };
    if (action === 'saveWorkspace') {
      mutation(body);
      const workspace = workspaceShape(body.workspace);
      const hash = digest([body.expectedRevision, workspace]); const current = workspaces.get(workspace.id);
      if (current?.mutations.has(body.mutationId)) {
        if (current.mutations.get(body.mutationId) !== hash) fail('MUTATION_MISMATCH', 'This save identifier was already used for different job data.');
        return { ok: true, workspace: current.workspace, mutation: { id: body.mutationId, revision: body.expectedRevision + 1 } };
      }
      const revision = current?.workspace.revision || 0;
      if (body.expectedRevision !== revision) fail('CONFLICT', 'This job changed in another window. Reload it before saving your edits.', revision);
      workspace.revision = revision + 1; workspace.updatedAt = new Date().toISOString();
      const mutations = new Map(current?.mutations); mutations.set(body.mutationId, hash);
      workspaces.set(workspace.id, { workspace, mutations }); return { ok: true, workspace, mutation: { id: body.mutationId, revision: body.expectedRevision + 1 } };
    }
    if (action === 'listJobDocuments') {
      requireWorkspace(body.workspaceId);
      return { ok: true, documents: [...documents.values()].filter(item => item.document.workspaceId === body.workspaceId).map(item => item.document).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    }
    if (action === 'saveJobDocument') {
      requireWorkspace(body.workspaceId); identifier(body.documentId, 'document'); identifier(body.mutationId, 'mutation');
      const file = body.file;
      if (typeof body.kind !== 'string' || !body.kind.trim() || body.kind.length > 100 || typeof body.inputFingerprint !== 'string' || !body.inputFingerprint || body.inputFingerprint.length > 200 || !Number.isInteger(body.templateVersion) || body.templateVersion < 1 || !file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 300 || file.mimeType !== 'application/pdf' || !Number.isInteger(file.size) || file.size <= 0 || file.size > 15 * 1024 * 1024 || typeof file.data !== 'string' || file.data.length > 21 * 1024 * 1024 || file.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) fail('VALIDATION', 'Choose a PDF up to 15 MB and provide its document details.');
      const bytes = Buffer.from(file.data, 'base64');
      if (bytes.length !== file.size || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') fail('VALIDATION', 'The file size or content does not match the selected PDF.');
      const name = file.name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
      if (!name) fail('VALIDATION', 'A PDF filename is required.');
      const hash = digest([body.workspaceId, body.documentId, body.kind, body.inputFingerprint, body.templateVersion, name, file.mimeType, bytes.length, bytes.toString('base64')]);
      const existing = [...documents.values()].find(item => item.document.workspaceId === body.workspaceId && (item.document.id === body.documentId || item.mutationId === body.mutationId));
      if (existing) {
        if (existing.mutationId !== body.mutationId || existing.hash !== hash) fail('MUTATION_MISMATCH', 'This PDF identifier was already used for different content.');
        return { ok: true, document: existing.document };
      }
      const document: JobDocument = { id: body.documentId, workspaceId: body.workspaceId, name, kind: body.kind, driveFileId: `local-${randomUUID()}`, inputFingerprint: body.inputFingerprint, templateVersion: body.templateVersion, createdAt: new Date().toISOString() };
      documents.set(`${body.workspaceId}:${body.documentId}`, { document, data: bytes.toString('base64'), mutationId: body.mutationId, hash });
      return { ok: true, document };
    }
    if (action === 'fetchJobDocument') {
      requireWorkspace(body.workspaceId); identifier(body.documentId, 'document');
      const found = documents.get(`${body.workspaceId}:${body.documentId}`);
      if (!found) fail('NOT_FOUND', 'PDF not found for this job.');
      return { ok: true, name: found.document.name, mimeType: 'application/pdf', data: found.data };
    }
    if (action === 'linkRequestWorkspace') {
      mutation(body); requireWorkspace(body.workspaceId);
      const request = requests.find(item => item.id === body.id);
      if (!request) fail('NOT_FOUND', 'Request not found.');
      const mutations = links.get(request.id) || new Map<string, string>();
      if (mutations.has(body.mutationId)) {
        if (mutations.get(body.mutationId) !== body.workspaceId || request.workspaceId !== body.workspaceId) fail('CONFLICT', 'This retry refers to a different job.');
        return { ok: true, request };
      }
      if (request.revision !== body.expectedRevision) fail('CONFLICT', 'This request changed in another window. Reopen it before applying your edits.', request.revision);
      request.workspaceId = body.workspaceId; request.revision += 1; request.updatedAt = new Date().toISOString();
      mutations.set(body.mutationId, body.workspaceId); links.set(request.id, mutations);
      return { ok: true, request };
    }
    if (action === 'getCustomerReference') return { ok: true, reference };
    if (action === 'replaceCustomerReference') {
      if (!Array.isArray(body.customers) || body.customers.length < 1 || body.customers.length > 5000 || typeof body.fileName !== 'string' || !body.fileName.trim() || body.fileName.length > 300) fail('bad_request', 'Upload between 1 and 5000 customer records and provide a CSV filename.');
      const seen = new Set<string>();
      const customers = body.customers.map((item: Payload) => {
        if (!item || typeof item.customerName !== 'string' || !item.customerName.trim() || item.customerName.length > 300 || typeof item.jobNumber !== 'string' || !item.jobNumber.trim() || item.jobNumber.length > 100) fail('bad_request', 'Customer name and job number are required.');
        const price = item.contractPrice;
        if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e12 || Math.abs(price * 100 - Math.round(price * 100)) > 0.01)) fail('bad_request', 'Invalid contract price.');
        const key = item.jobNumber.trim().toUpperCase();
        if (seen.has(key)) fail('bad_request', `Duplicate job number: ${item.jobNumber}`); seen.add(key);
        const customer: Payload = { customerName: item.customerName.trim(), jobNumber: item.jobNumber.trim(), contractPrice: price };
        for (const [field, limit] of Object.entries({ jobAddress: 500, city: 100, state: 100, zip: 20 })) {
          if (item[field] !== undefined && typeof item[field] !== 'string') fail('bad_request', 'Invalid address field.');
          customer[field] = (item[field] || '').trim(); if (customer[field].length > limit) fail('bad_request', 'Address field is too long.');
        }
        return customer;
      });
      reference = { customers, fileName: body.fileName.trim(), updatedAt: new Date().toISOString(), updatedBy: 'local-preview', version: randomUUID() };
      return { ok: true, reference };
    }
    if (action === 'analyzeIntake') return { ok: false, code: 'AI_NOT_CONFIGURED', error: 'AI analysis is unavailable in the local preview. Connect the configured Apps Script backend to use DeepSeek; no AI call was made.' };
    return undefined;
  };
  return (action: string, body: Payload): Result | undefined => {
    try { const result = respond(action, body); return result === undefined ? undefined : structuredClone(result); }
    catch (error) {
      if (error instanceof LocalApiError) return { ok: false, code: error.code, error: error.message, ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) };
      throw error;
    }
  };
}
