import { useCallback, useEffect, useState } from "react";
import {
  Briefcase,
  FileText,
  GitMerge,
  Link2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Tag,
  UserRound,
} from "lucide-react";
import {
  addNote,
  createTask,
  linkWorkspaceToCustomer,
  listActivities,
  listCustomers,
  listTasks,
  logCommunication,
  openCustomer,
  setWorkspaceStage,
  subscribeCrm,
  toggleTask,
} from "../../crm";
import type {
  Activity,
  Customer,
  CustomerSummary,
  JobStage,
  NewCommunicationInput,
  NewTaskInput,
  Task,
} from "../../crm/types";
import {
  cachedWorkspaces,
  subscribeWorkspaces,
} from "../../services/workspaces";
import { cachedRequests } from "../../services/storage";
import { customerNameKey } from "../../services/customerDirectory";
import type { ChangeRequest, RequestStatus } from "../../types";
import type { WorkspaceRow } from "../../workspaces/types";
import ActivityTimeline from "./ActivityTimeline";
import CustomerForm from "./CustomerForm";
import TaskList from "./TaskList";
import "./crm.css";

const STAGES: JobStage[] = ["lead", "in_progress", "complete", "closed"];
const STAGE_LABELS: Record<JobStage, string> = {
  lead: "Lead",
  in_progress: "In progress",
  complete: "Complete",
  closed: "Closed",
};
const REQUEST_LABELS: Record<RequestStatus, string> = {
  submitted: "In queue",
  in_review: "In review",
  needs_information: "Needs info",
  completed: "Completed",
};

export interface CustomerDetailProps {
  id: string;
  onBack: () => void;
}

export default function CustomerDetail({ id, onBack }: CustomerDetailProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [mergeFocus, setMergeFocus] = useState(false);
  const [linkJobId, setLinkJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCustomer = useCallback(async () => {
    try {
      const next = await openCustomer(id);
      setCustomer(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  const loadActivities = useCallback(async () => {
    try {
      setActivities(await listActivities(id));
    } catch {
      // Timeline is non-critical.
    }
  }, [id]);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await listTasks(id));
    } catch {
      // Tasks are non-critical.
    }
  }, [id]);

  const loadCustomers = useCallback(async () => {
    try {
      setCustomers(await listCustomers());
    } catch {
      // Merge picker just shows an empty list.
    }
  }, []);

  useEffect(() => {
    void loadCustomer();
    void loadActivities();
    void loadTasks();
    void loadCustomers();
    const unsubscribe = subscribeCrm(() => {
      void loadCustomer();
      void loadActivities();
      void loadTasks();
      void loadCustomers();
    });
    return unsubscribe;
  }, [loadCustomer, loadActivities, loadTasks, loadCustomers]);

  useEffect(() => {
    const read = async () => {
      setWorkspaces(await cachedWorkspaces());
    };
    void read();
    return subscribeWorkspaces(() => void read());
  }, []);

  // Own change orders are read from this device's request cache: a customer
  // links to the change orders its picks created, without another round-trip.
  useEffect(() => {
    setRequests(cachedRequests());
  }, [id]);

  const handleAddNote = useCallback(
    async (body: string) => {
      await addNote(id, body);
      await loadActivities();
    },
    [id, loadActivities],
  );

  const handleLogCommunication = useCallback(
    async (input: NewCommunicationInput) => {
      await logCommunication(id, input);
      await loadActivities();
    },
    [id, loadActivities],
  );

  const handleAddTask = useCallback(
    async (input: NewTaskInput) => {
      await createTask(id, input);
      await loadTasks();
    },
    [id, loadTasks],
  );

  const handleToggleTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      await toggleTask(task);
      await loadTasks();
    },
    [tasks, loadTasks],
  );

  const changeStage = useCallback(
    async (workspaceId: string, stage: JobStage) => {
      setBusy(true);
      setError("");
      try {
        await setWorkspaceStage(workspaceId, stage);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const linkJob = useCallback(async () => {
    if (!linkJobId) return;
    setBusy(true);
    setError("");
    try {
      await linkWorkspaceToCustomer(linkJobId, id);
      setLinkJobId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [id, linkJobId]);

  const handleSaved = useCallback(async () => {
    setFormOpen(false);
    setMergeFocus(false);
    await loadCustomer();
    await loadCustomers();
  }, [loadCustomer, loadCustomers]);

  if (!customer) {
    return (
      <div className="empty">
        {error ? (
          <>
            <h3>This customer could not be opened.</h3>
            <p>{error}</p>
            <div className="button-row">
              <button
                className="button primary"
                onClick={() => void loadCustomer()}
              >
                Try again
              </button>
              <button className="button" onClick={onBack}>
                Back to customers
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="spinner" />
            <p>Loading customer…</p>
          </>
        )}
      </div>
    );
  }

  const linked = workspaces.filter((row) => row.workspace.customerId === id);
  const unlinked = workspaces.filter((row) => row.workspace.customerId !== id);
  // New change orders carry the customer id; older ones are matched by name so
  // a customer's history is complete the first time they are opened.
  const customerKey = customerNameKey(customer.name);
  const linkedRequests = requests
    .filter(
      (request) =>
        request.customerId === id ||
        (!request.customerId &&
          customerKey &&
          customerNameKey(request.job?.customer) === customerKey),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="crm crm-detail">
      <div className="crm-profile">
        <span className="crm-profile-avatar" aria-hidden="true">
          <UserRound size={28} />
        </span>
        <div className="crm-profile-main">
          <h1>{customer.name || "Untitled customer"}</h1>
          <div className="crm-profile-lines">
            {customer.phone ? (
              <span>
                <Phone size={14} />
                {customer.phone}
              </span>
            ) : null}
            {customer.email ? (
              <span>
                <Mail size={14} />
                {customer.email}
              </span>
            ) : null}
            {customer.address || customer.cityStateZip ? (
              <span>
                <MapPin size={14} />
                {[customer.address, customer.cityStateZip]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            ) : null}
          </div>
          {customer.tags?.length ? (
            <div className="crm-tags">
              {customer.tags.map((tag) => (
                <span key={tag} className="crm-tag">
                  <Tag size={12} />
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="crm-profile-actions">
          <button
            className="button"
            onClick={() => {
              setMergeFocus(false);
              setFormOpen(true);
            }}
          >
            <Pencil size={16} />
            Edit
          </button>
          <button
            className="button"
            onClick={() => {
              setMergeFocus(true);
              setFormOpen(true);
            }}
          >
            <GitMerge size={16} />
            Merge
          </button>
        </div>
      </div>

      {error ? (
        <div className="notice danger" role="alert">
          {error}
        </div>
      ) : null}

      <section className="crm-section" aria-label="Jobs">
        <div className="crm-section-head">
          <h2>
            <Briefcase size={17} />
            Jobs
          </h2>
        </div>
        {linked.length ? (
          <ul className="crm-job-list">
            {linked.map((row) => (
              <li key={row.workspace.id} className="crm-job">
                <div className="crm-job-main">
                  <strong>
                    {row.workspace.record.customer.customerName || "Untitled job"}
                  </strong>
                  <small>
                    {row.workspace.record.customer.jobNumber || "No job number"}
                  </small>
                </div>
                <select
                  className="crm-job-stage"
                  aria-label={`Stage for ${row.workspace.record.customer.customerName || "job"}`}
                  value={row.workspace.stage ?? "lead"}
                  disabled={busy}
                  onChange={(event) =>
                    void changeStage(
                      row.workspace.id,
                      event.target.value as JobStage,
                    )
                  }
                >
                  {STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {STAGE_LABELS[stage]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        ) : (
          <p className="crm-empty">No jobs linked to this customer yet.</p>
        )}

        <div className="crm-link">
          <div className="crm-field">
            <label htmlFor="crm-link-job">Link a job</label>
            <select
              id="crm-link-job"
              aria-label="Link a job to this customer"
              value={linkJobId}
              disabled={busy}
              onChange={(event) => setLinkJobId(event.target.value)}
            >
              <option value="">Choose an unlinked job…</option>
              {unlinked.map((row) => (
                <option key={row.workspace.id} value={row.workspace.id}>
                  {row.workspace.record.customer.customerName || "Untitled job"}
                  {row.workspace.record.customer.jobNumber
                    ? ` · ${row.workspace.record.customer.jobNumber}`
                    : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            className="button"
            disabled={busy || !linkJobId}
            onClick={() => void linkJob()}
          >
            <Link2 size={16} />
            Link job
          </button>
        </div>
      </section>

      <section className="crm-section" aria-label="Change orders">
        <div className="crm-section-head">
          <h2>
            <FileText size={17} />
            Change orders
          </h2>
          {linkedRequests.length ? (
            <span className="crm-badge">{linkedRequests.length}</span>
          ) : null}
        </div>
        {linkedRequests.length ? (
          <ul className="crm-job-list">
            {linkedRequests.map((request) => (
              <li key={request.id} className="crm-job">
                <div className="crm-job-main">
                  <strong>
                    {request.job.jobNumber ||
                      request.job.customer ||
                      "Untitled change order"}
                  </strong>
                  <small>
                    {[
                      request.job.customer,
                      new Date(request.updatedAt).toLocaleDateString(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                <span className="crm-badge">
                  {REQUEST_LABELS[request.status] ?? request.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="crm-empty">
            No change orders linked to this customer yet. Pick this customer on
            the New request page and the change order appears here.
          </p>
        )}
      </section>

      <ActivityTimeline
        activities={activities}
        onAddNote={handleAddNote}
        onLogCommunication={handleLogCommunication}
      />

      <TaskList
        tasks={tasks}
        onAddTask={handleAddTask}
        onToggle={handleToggleTask}
      />

      {formOpen ? (
        <CustomerForm
          mode="edit"
          initial={customer}
          customers={customers}
          mergeFocus={mergeFocus}
          onCancel={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
