import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Mail,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ChangeRequest, RequestAttachment } from "../types";
import IntakeReceipt from "./IntakeReceipt";
import RequestEditor from "./RequestEditor";
import CopyDashNote from "./CopyDashNote";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { formatDashNote } from "../services/dashNote";
import { sendRequestEmail } from "../services/storage";
import "./RequestReview.css";

export default function RequestReview({
  request,
  busy,
  onPreview,
  onDownload,
  onClaim,
  onComplete,
  onRequestInfo,
  onSendResponse,
  onDownloadSummary,
  onSaved,
  onReload,
  onBusy,
  onLeaveGuard,
  onDelete,
}: {
  request: ChangeRequest;
  busy: string;
  onBack?: () => void;
  onPreview: (attachment: RequestAttachment) => void;
  onDownload: (attachment: RequestAttachment) => void;
  onClaim: (name: string) => void;
  onComplete: () => void;
  onRequestInfo: (question: string) => void;
  onSendResponse: (response: string) => void;
  onDownloadSummary: () => void;
  onSaved: (request: ChangeRequest) => void;
  onReload: () => Promise<ChangeRequest>;
  onBusy: (message: string) => void;
  onLeaveGuard: (guard: (() => boolean) | null) => void;
  onDelete?: (id: string) => Promise<void> | void;
}) {
  const [claimName, setClaimName] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [response, setResponse] = useState("");
  const [editing, setEditing] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState("");
  const [emailError, setEmailError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(request.id);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSendEmail = async () => {
    const target = emailAddress.trim();
    if (!target) return;
    setSendingEmail(true);
    setEmailError("");
    setEmailSuccess("");
    try {
      const result = await sendRequestEmail(
        request.id,
        target,
        undefined,
        request,
      );
      setEmailSuccess(
        result.message ||
          `Email sent successfully to ${target} with ${request.attachments.length} attachment(s).`,
      );
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="review">
      <div className="review-actions">
        <CopyDashNote
          text={formatDashNote(request)}
          disabled={editing || Boolean(busy)}
        />
        {!editing && request.status !== "completed" ? (
          <button
            className="button"
            disabled={Boolean(busy)}
            onClick={() => setEditing(true)}
          >
            <Pencil size={16} />
            Edit request
          </button>
        ) : null}
        <button
          className="button"
          disabled={editing || Boolean(busy)}
          onClick={onDownloadSummary}
        >
          <Download size={16} />
          Download summary PDF
        </button>
        {onDelete ? (
          <button
            type="button"
            className="button danger"
            disabled={editing || Boolean(busy) || deleting}
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete this change order request"
          >
            <Trash2 size={16} />
            Delete request
          </button>
        ) : null}
      </div>

      <section className="review-card email-card">
        <div className="email-card-header">
          <div className="email-card-title">
            <Mail size={18} />
            <strong>Email change order & attachments</strong>
          </div>
          {request.attachments.length > 0 ? (
            <span className="email-attachments-count">
              <Paperclip size={14} />
              {request.attachments.length} attachment
              {request.attachments.length === 1 ? "" : "s"} included
            </span>
          ) : (
            <span className="email-attachments-count muted">
              No attachments
            </span>
          )}
        </div>
        <p className="email-card-desc">
          Enter an email address to send the change order details, requested changes, and all attachments via Google Apps Script.
        </p>
        <form
          className="email-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendEmail();
          }}
        >
          <div className="email-input-group">
            <input
              type="email"
              className="email-input"
              value={emailAddress}
              onChange={(e) => {
                setEmailAddress(e.target.value);
                if (emailError) setEmailError("");
              }}
              placeholder="Enter recipient email (e.g. estimator@example.com)"
              aria-label="Recipient email address"
              disabled={sendingEmail || Boolean(busy)}
              required
            />
            <button
              type="submit"
              className="button primary"
              disabled={!emailAddress.trim() || sendingEmail || Boolean(busy)}
            >
              <Send size={15} />
              {sendingEmail ? "Sending email…" : "Send email"}
            </button>
          </div>
          <div className="email-suggestions">
            <span>Quick fill:</span>
            <button
              type="button"
              className={`chip-button${emailAddress === "rrussell@haysandsons.com" ? " is-active" : ""}`}
              onClick={() => {
                setEmailAddress("rrussell@haysandsons.com");
                if (emailError) setEmailError("");
              }}
            >
              rrussell@haysandsons.com
            </button>
            <button
              type="button"
              className={`chip-button${emailAddress === "rshive@haysandsons.com" ? " is-active" : ""}`}
              onClick={() => {
                setEmailAddress("rshive@haysandsons.com");
                if (emailError) setEmailError("");
              }}
            >
              rshive@haysandsons.com
            </button>
          </div>
        </form>

        {emailSuccess ? (
          <div className="email-alert success" role="status">
            <CheckCircle2 size={16} />
            <span>{emailSuccess}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setEmailSuccess("")}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        {emailError ? (
          <div className="email-alert error" role="alert">
            <AlertCircle size={16} />
            <span>{emailError}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setEmailError("")}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
      </section>

      {busy ? (
        <p className="receipt-caption" role="status">
          {busy}
        </p>
      ) : null}
      {editing ? (
        <RequestEditor
          request={request}
          onSaved={(saved) => {
            setEditing(false);
            onSaved(saved);
          }}
          onCancel={() => setEditing(false)}
          onReload={onReload}
          onBusy={onBusy}
          onLeaveGuard={onLeaveGuard}
        />
      ) : (
        <IntakeReceipt
          request={request}
          busy={busy}
          onPreview={onPreview}
          onDownload={onDownload}
        />
      )}

      <fieldset className="review-workflow" disabled={editing || Boolean(busy)}>
        {request.status === "submitted" ? (
          <div className="review-card">
            <div className="review-card-icon">
              <Send size={26} />
            </div>
            <h2>Estimator? Start work on this request.</h2>
            <p>
              <strong>{request.job.customer || "Unnamed project"}</strong>
              {request.job.jobNumber ? ` · ${request.job.jobNumber}` : ""}
              <br />
              {request.requestedChanges.length} requested{" "}
              {request.requestedChanges.length === 1 ? "change" : "changes"} ·{" "}
              {request.attachments.length} attachment
              {request.attachments.length === 1 ? "" : "s"}
            </p>
            <label className="field review-field">
              <span>Estimator name</span>
              <input
                aria-label="Estimator name"
                value={claimName}
                placeholder="Enter your name to start work"
                onChange={(event) => setClaimName(event.target.value)}
              />
            </label>
            <button
              className="button primary large full"
              disabled={!claimName.trim() || Boolean(busy)}
              onClick={() => onClaim(claimName)}
            >
              <CheckCircle2 size={17} />
              {busy ? "Starting…" : "Start work"}
            </button>
          </div>
        ) : request.status === "in_review" ? (
          <div className="review-card">
            <h2>Estimator review</h2>
            <p>
              {request.estimatorName || "The estimator"} is working this
              request. Review the request details, make any needed edits or
              inquiries, and mark the request complete when finished.
            </p>
            {asking ? (
              <div className="review-ask">
                <label className="field">
                  <span>What information do you need?</span>
                  <textarea
                    aria-label="Information request"
                    value={question}
                    rows={3}
                    onChange={(event) => setQuestion(event.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button
                    className="button"
                    disabled={!question.trim() || Boolean(busy)}
                    onClick={() => onRequestInfo(question)}
                  >
                    {busy ? "Sending…" : "Send request"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setAsking(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="button-row">
                <button
                  className="button primary large"
                  disabled={Boolean(busy)}
                  onClick={onComplete}
                >
                  <CheckCircle2 size={17} />
                  {busy ? "Completing…" : "Mark complete"}
                </button>
                <button className="button" onClick={() => setAsking(true)}>
                  Request more information
                </button>
              </div>
            )}
          </div>
        ) : request.status === "needs_information" ? (
          <div className="review-card">
            <div className="review-card-icon">
              <TriangleAlert size={26} />
            </div>
            <h2>More information needed</h2>
            <blockquote className="review-question">
              {request.informationQuestion ||
                "The estimator needs more details."}
            </blockquote>
            <label className="field review-field">
              <span>Your response</span>
              <textarea
                aria-label="Response"
                value={response}
                rows={3}
                placeholder="Add the information the estimator asked for."
                onChange={(event) => setResponse(event.target.value)}
              />
            </label>
            <button
              className="button primary large full"
              disabled={!response.trim() || Boolean(busy)}
              onClick={() => onSendResponse(response)}
            >
              <Send size={17} />
              {busy ? "Sending…" : "Send response"}
            </button>
          </div>
        ) : (
          <div className="review-card review-done">
            <div className="review-card-icon">
              <CheckCircle2 size={26} />
            </div>
            <h2>
              {request.status === "completed" ? "Completed" : "Read only"}
            </h2>
            <p>
              {request.status === "completed"
                ? "This change order is finished and kept in the log for reference."
                : "This request is not editable."}
            </p>
          </div>
        )}
      </fieldset>

      <ConfirmDeleteModal
        isOpen={showDeleteConfirm}
        title="Delete change order request?"
        message="Are you sure you want to delete this change order request? This action will permanently remove the change order and all of its attached documents from the system. It cannot be undone."
        itemSummary={{
          customer: request.job?.customer || "Untitled Request",
          jobNumber: request.job?.jobNumber || "Pending",
          orderNumber: request.job?.orderNumber || "—",
          status: request.status,
        }}
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
