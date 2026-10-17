import { useEffect, useId, useState } from "react";
import { FileText, Plus, Search, Upload } from "lucide-react";
import type { ChangeRequest, JobEntry, RequestSummary } from "../types";
import type { WorkspaceRow } from "../workspaces/types";
import {
  createWorkspace,
  normalizeJobNumber,
  workspaceFromDirectory,
} from "../workspaces/model";
import {
  cachedWorkspaces,
  refreshWorkspaces,
  saveWorkspaceLocally,
  subscribeWorkspaces,
} from "../services/workspaces";
import { syncWorkspaces } from "../services/workspaces";
import { importWorkspaceLocally } from "../workspaces/importStore";
import JobWorkspace from "./JobWorkspace";
import { CustomerImportPage } from "./components/CustomerImportPage";
import WorkspaceMigration from "./WorkspaceMigration";
import "./workspace.css";
import "./documents.css";

export default function JobsDocuments({
  workspaceId,
  jobs,
  requests,
  onOpenWorkspace,
  onNewRequest,
  onOpenRequest,
  onBack,
}: {
  workspaceId?: string;
  jobs: JobEntry[];
  requests: RequestSummary[];
  onOpenWorkspace: (id: string) => void;
  onNewRequest: (request: ChangeRequest) => void;
  onOpenRequest: (id: string) => void;
  onBack: () => void;
}) {
  const directorySelectId = useId();
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<"jobs" | "migration" | "reference">("jobs");
  useEffect(() => {
    let active = true;
    const read = async () => {
      const cached = await cachedWorkspaces();
      if (active) setRows(cached);
    };
    void read().catch((value) => active && setError(String(value)));
    void refreshWorkspaces()
      .then(() => {
        if (active) setError("");
      })
      .catch(
        (value) =>
          active &&
          setError(value instanceof Error ? value.message : String(value)),
      );
    const unsubscribe = subscribeWorkspaces(
      () => void read().catch((value) => active && setError(String(value))),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function create(entry?: JobEntry) {
    setBusy(true);
    setError("");
    try {
      if (entry) {
        const matches = rows.filter(
          (row) =>
            normalizeJobNumber(row.workspace.record.customer.jobNumber) ===
            normalizeJobNumber(entry.jobNumber),
        );
        if (entry.jobNumber.trim() && matches.length === 1) {
          onOpenWorkspace(matches[0].workspace.id);
          return;
        }
        if (entry.jobNumber.trim() && matches.length > 1)
          throw new Error(
            "More than one saved job uses this number. Open the correct saved job below.",
          );
      }
      const workspace = entry
        ? workspaceFromDirectory(entry)
        : createWorkspace();
      await saveWorkspaceLocally(workspace);
      onOpenWorkspace(workspace.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  if (workspaceId)
    return (
      <JobWorkspace
        key={workspaceId}
        id={workspaceId}
        requests={requests}
        onNewRequest={onNewRequest}
        onOpenRequest={onOpenRequest}
        onBack={onBack}
      />
    );
  const query = search.trim().toLowerCase();
  const visible = rows
    .filter((row) =>
      [
        row.workspace.record.customer.customerName,
        row.workspace.record.customer.jobNumber,
        row.workspace.record.customer.lossAddress,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
    .sort((a, b) => b.workspace.updatedAt.localeCompare(a.workspace.updatedAt));
  return (
    <div className="documents-workspace jobs-documents">
      <div className="workspace-title">
        <div>
          <p className="workspace-eyebrow">Shared job workspace</p>
          <h1>Jobs & Documents</h1>
          <p>
            Job details, production documents, and change requests together.
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void create()}
        >
          <Plus size={18} />
          New job
        </button>
      </div>
      <div className="workspace-tools">
        <button
          className="button"
          aria-pressed={tool === "jobs"}
          onClick={() => setTool("jobs")}
        >
          Saved jobs
        </button>
        <button
          className="button"
          aria-pressed={tool === "migration"}
          onClick={() => setTool("migration")}
        >
          <Upload size={16} />
          Import document jobs
        </button>
        <button
          className="button"
          aria-pressed={tool === "reference"}
          onClick={() => setTool("reference")}
        >
          Customer reference CSV
        </button>
      </div>
      {error && (
        <div className="notice danger" role="alert">
          {error}
          <button
            className="button small"
            onClick={() =>
              void refreshWorkspaces()
                .then(() => setError(""))
                .catch((value) => setError(String(value)))
            }
          >
            Retry connection
          </button>
        </div>
      )}
      {tool === "migration" ? (
        <WorkspaceMigration
          workspaces={rows.map((row) => row.workspace)}
          onImport={async (workspace) => {
            await importWorkspaceLocally(
              workspace,
              rows.find((row) => row.workspace.id === workspace.id)?.workspace,
            );
            setRows(await cachedWorkspaces());
            void syncWorkspaces().catch(() => undefined);
          }}
          onDone={() => setTool("jobs")}
        />
      ) : tool === "reference" ? (
        <CustomerImportPage canImport onOpenIntake={() => setTool("jobs")} />
      ) : (
        <>
          <label className="workspace-search">
            <Search size={18} />
            <input
              aria-label="Search saved jobs"
              placeholder="Search customer, job number, or address"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <section className="workspace-panel">
            <h2>
              Saved jobs <span className="workspace-count">{rows.length}</span>
            </h2>
            {visible.length ? (
              visible.map((row) => (
                <button
                  className="workspace-list-row"
                  key={row.workspace.id}
                  onClick={() => onOpenWorkspace(row.workspace.id)}
                >
                  <FileText size={22} />
                  <span>
                    <strong>
                      {row.workspace.record.customer.customerName ||
                        "Untitled job"}
                    </strong>
                    <small>
                      {[
                        row.workspace.record.customer.jobNumber,
                        row.workspace.record.customer.lossAddress,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Job details in progress"}
                    </small>
                    <small>
                      {row.conflict
                        ? "Conflicting edits need review"
                        : row.error
                          ? "Sync needs attention · device copy saved"
                          : row.dirty || row.inFlight
                            ? "Saved on device · sync queued"
                            : "Saved to shared workspace"}
                    </small>
                  </span>
                  <span>Open →</span>
                </button>
              ))
            ) : (
              <p>
                {rows.length
                  ? "No saved jobs match your search."
                  : "Create a job or choose one from the directory below. Documents can be prepared before any change request exists."}
              </p>
            )}
          </section>
          <section className="workspace-panel">
            <h2>Start from the job directory</h2>
            <p>
              Choose an imported job to start its workspace. Future directory
              imports preserve your saved details and documents.
            </p>
            <div className="workspace-directory-select">
              <label htmlFor={directorySelectId}>Directory job</label>
              <select
                id={directorySelectId}
                value=""
                disabled={busy}
                onChange={(event) => {
                  const entry = jobs.find(
                    (job) => job.id === event.target.value,
                  );
                  if (entry) void create(entry);
                }}
              >
                <option value="">Choose a job…</option>
                {jobs
                  .filter((job) => job.active)
                  .map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.customer} · {job.jobNumber}
                    </option>
                  ))}
              </select>
            </div>
            {!jobs.length && (
              <p>
                No directory jobs imported yet. You can create a job manually.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
