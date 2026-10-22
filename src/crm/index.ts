import {
  notifyCrm,
  refreshActivitiesForCustomer,
  refreshCustomersFromServer,
  refreshTasksForCustomer,
  stageActivity,
  stageCustomer,
  stageTask,
  startCrmSync,
  subscribeCrm,
} from "./sync";
import * as api from "./api";
import {
  deleteCustomer,
  getLocalCustomer,
  listAllLocalTasks,
  listLocalActivities,
  listLocalCustomers,
  listLocalTasks,
  putCustomer,
  putCustomerSilent,
} from "./store";
import { readWorkspaceRow, readWorkspaceRows } from "../workspaces/localStore";
import { saveWorkspaceLocally } from "../services/workspaces";
import type {
  Activity,
  ActivityDirection,
  ActivityKind,
  Customer,
  CustomerSummary,
  JobStage,
  NewCommunicationInput,
  NewCustomerInput,
  NewTaskInput,
  Task,
  TaskStatus,
} from "./types";

export type {
  Activity,
  ActivityDirection,
  ActivityKind,
  Customer,
  CustomerSummary,
  JobStage,
  NewCommunicationInput,
  NewCustomerInput,
  NewTaskInput,
  Task,
  TaskStatus,
};

export { startCrmSync, subscribeCrm };

export async function listCustomers(): Promise<CustomerSummary[]> {
  await refreshCustomersFromServer().catch(() => undefined);
  const [customers, workspaceRows, tasks] = await Promise.all([
    listLocalCustomers(),
    readWorkspaceRows(),
    listAllLocalTasks(),
  ]);
  return customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    tags: customer.tags,
    updatedAt: customer.updatedAt,
    jobCount: workspaceRows.filter(
      (row) => row.workspace.customerId === customer.id,
    ).length,
    openTaskCount: tasks.filter(
      (task) => task.customerId === customer.id && task.status === "open",
    ).length,
  }));
}

export async function openCustomer(customerId: string): Promise<Customer | null> {
  const local = await getLocalCustomer(customerId);
  try {
    const remote = await api.openCustomer(customerId);
    if (remote) {
      await putCustomerSilent(remote);
      return remote;
    }
  } catch {
    // Offline or backend not yet deployed: serve the device copy.
  }
  return local ?? null;
}

export async function createCustomer(input: NewCustomerInput): Promise<Customer> {
  const now = new Date().toISOString();
  const customer: Customer = {
    id: crypto.randomUUID(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    cityStateZip: input.cityStateZip,
    tags: input.tags,
  };
  await stageCustomer(customer, 0);
  return customer;
}

export async function updateCustomer(customer: Customer): Promise<Customer> {
  const now = new Date().toISOString();
  const next: Customer = {
    ...customer,
    revision: customer.revision + 1,
    updatedAt: now,
  };
  await stageCustomer(next, customer.revision);
  return next;
}

export async function mergeCustomers(targetId: string, sourceId: string): Promise<Customer> {
  const merged = await api.mergeCustomers(targetId, sourceId);
  await putCustomer(merged);
  await deleteCustomer(sourceId);
  notifyCrm();
  return merged;
}

export async function listActivities(customerId: string): Promise<Activity[]> {
  await refreshActivitiesForCustomer(customerId).catch(() => undefined);
  const activities = await listLocalActivities(customerId);
  return activities.sort((a, b) => b.at.localeCompare(a.at));
}

export async function addNote(customerId: string, body: string, by?: string): Promise<Activity> {
  const activity: Activity = {
    id: crypto.randomUUID(),
    customerId,
    kind: "note",
    direction: "system",
    body,
    at: new Date().toISOString(),
    by,
  };
  await stageActivity(activity);
  return activity;
}

export async function logCommunication(
  customerId: string,
  input: NewCommunicationInput,
): Promise<Activity> {
  const activity: Activity = {
    id: crypto.randomUUID(),
    customerId,
    kind: input.kind,
    direction: input.direction,
    body: input.summary,
    at: new Date().toISOString(),
    by: input.by,
  };
  await stageActivity(activity);
  return activity;
}

export async function listTasks(customerId: string): Promise<Task[]> {
  await refreshTasksForCustomer(customerId).catch(() => undefined);
  const tasks = await listLocalTasks(customerId);
  return tasks.sort((a, b) => {
    const aOpen = a.status === "open" ? 0 : 1;
    const bOpen = b.status === "open" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return (a.dueDate ?? "\uFFFF").localeCompare(b.dueDate ?? "\uFFFF");
  });
}

export async function createTask(customerId: string, input: NewTaskInput): Promise<Task> {
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    customerId,
    title: input.title,
    dueDate: input.dueDate,
    assignee: input.assignee,
    status: "open",
    revision: 0,
    createdAt: now,
  };
  await stageTask(task, 0);
  return task;
}

export async function toggleTask(task: Task): Promise<Task> {
  const now = new Date().toISOString();
  const done = task.status !== "done";
  const next: Task = {
    ...task,
    status: done ? "done" : "open",
    completedAt: done ? now : undefined,
    revision: task.revision + 1,
  };
  await stageTask(next, task.revision);
  return next;
}

export async function setWorkspaceStage(workspaceId: string, stage: JobStage): Promise<void> {
  const row = await readWorkspaceRow(workspaceId);
  if (!row) throw new Error("This job is not available on this device.");
  const next = structuredClone(row.workspace);
  next.stage = stage;
  await saveWorkspaceLocally(next);
}

export async function linkWorkspaceToCustomer(
  workspaceId: string,
  customerId: string,
): Promise<void> {
  const row = await readWorkspaceRow(workspaceId);
  if (!row) throw new Error("This job is not available on this device.");
  const next = structuredClone(row.workspace);
  next.customerId = customerId;
  await saveWorkspaceLocally(next);
}
