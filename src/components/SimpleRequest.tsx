import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  FileText,
  Images,
  Mail,
  Mic,
  MicOff,
  Minus,
  Paperclip,
  Pencil,
  Plus,
  Send,
  X,
} from "lucide-react";
import {
  newId,
  type ChangeRequest,
  type JobEntry,
  type RequestSummary,
} from "../types";
import { createRequest, createRequestedChange } from "../services/requests";
import { blobToBase64, openRequest } from "../services/storage";
import {
  priorChangesForJob,
  type PriorChangeSummary,
} from "../services/changeOrder";
import { createRequestSubmission } from "../services/requestSubmission";
import {
  looksLikePhotoFile,
  preparePhotoForUpload,
} from "../services/photoUpload";
import PhotoAnnotator from "./PhotoAnnotator";
import RequestQuestions from "./RequestQuestions";
import CopyDashNote from "./CopyDashNote";
import { formatDashNote } from "../services/dashNote";
import "./SimpleRequest.css";

export interface SimpleRequestProps {
  /** The admin-managed customer/job directory. */
  jobs: JobEntry[];
  /** Dashboard summaries, used to roll earlier change orders for the job. */
  requests: RequestSummary[];
  /** Fresh request seeded from a permanent job workspace. */
  initialRequest?: ChangeRequest;
  /** The shell runs the task after returning home and owns its notification. */
  onSubmit: (send: () => Promise<string>) => void;
}

/** One photo the PM added, with its annotated replacement once edited. */
interface PhotoEntry {
  id: string;
  file: File;
  /** Annotated JPEG after the editor is used; the original File until then. */
  blob: Blob;
  /** True once the PM saved a markup, so the tile can say so. */
  edited: boolean;
}

/** How a directory row reads in the field and in the suggestion list. */
const jobLabel = (job: JobEntry) =>
  `${job.customer || "No customer name"} — ${job.jobNumber || "no job number"}`;

/*
 * Minimal Speech Recognition surface. It is declared locally so the browser
 * API's vendor shape never leaks an `any` into this component's exports.
 */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognition(): SpeechRecognitionConstructor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const NO_MICROPHONE =
  "Microphone access is blocked. Allow the microphone for this site, or type the note.";

const VOICE_ERRORS: Record<string, string | undefined> = {
  "not-allowed": NO_MICROPHONE,
  "service-not-allowed": NO_MICROPHONE,
  "audio-capture":
    "No microphone was found on this device — type the note instead.",
  "no-speech": "No speech was heard. Tap the microphone and try again.",
  network: "Voice input lost its network connection — type the note instead.",
};

/**
 * Builds the request body. `base` is the request already saved by a previous
 * attempt, so a retry keeps the same id and contract revision instead of
 * creating a second request.
 */
function buildRequest(
  base: ChangeRequest | null,
  details: {
    job: JobEntry | null;
    customer: string;
    note: string;
    prior?: PriorChangeSummary | null;
  } & Pick<
    ChangeRequest,
    "requestType" | "customerCredits" | "knownChangeAmount"
  >,
): ChangeRequest {
  const sameWorkspace =
    !base?.workspaceId || details.job?.id === `workspace-${base.workspaceId}`;
  const request = sameWorkspace && base ? base : createRequest();
  const description = details.note.trim();
  return {
    ...request,
    updatedAt: new Date().toISOString(),
    status: "submitted",
    submittedAt: null,
    requestType: details.requestType,
    customerCredits: details.customerCredits,
    knownChangeAmount: details.knownChangeAmount,
    job: {
      ...request.job,
      customer: details.customer,
      customerPhone: details.job?.customerPhone ?? "",
      customerEmail: details.job?.customerEmail ?? "",
      address: details.job?.address ?? "",
      jobNumber: details.job?.jobNumber ?? "",
      projectManager: details.job?.projectManager ?? "",
      // Only copy the directory's contract amount when it carries one, so a
      // blank entry never wipes an amount the request already holds.
      ...(details.job?.contractAmount
        ? { originalContract: details.job.contractAmount }
        : {}),
      // A new change order continues the job's running total; the workspace
      // seed already carries its own rolled-up values.
      ...(details.prior
        ? {
            previousChanges: details.prior.previousChanges,
            orderNumber: details.prior.nextOrderNumber,
          }
        : {}),
    },
    requestedChanges: description
      ? [
          {
            ...createRequestedChange(),
            description,
            room: "",
            action: "add",
          },
        ]
      : [],
    ...(details.job ? { jobDirectoryId: details.job.id } : {}),
  };
}

function PhotoTile({
  photo,
  index,
  disabled,
  onEdit,
  onRemove,
}: {
  photo: PhotoEntry;
  index: number;
  disabled: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [url, setUrl] = useState("");
  // The object URL lives and dies with this tile, so removing a photo, saving a
  // markup, or leaving the page always releases it.
  useEffect(() => {
    const next = URL.createObjectURL(photo.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo.blob]);
  return (
    <li className="sr-photo">
      {url ? (
        <img src={url} alt={`Photo ${index + 1}`} />
      ) : (
        <span className="sr-photo-empty" aria-hidden="true" />
      )}
      {photo.edited ? <span className="sr-photo-tag">Marked up</span> : null}
      <span className="sr-photo-actions">
        <button
          type="button"
          className="button sr-photo-action"
          disabled={disabled}
          aria-label={`Edit photo ${index + 1}`}
          onClick={() => onEdit(photo.id)}
        >
          <Pencil size={16} />
          Edit
        </button>
        <button
          type="button"
          className="button sr-photo-action"
          disabled={disabled}
          aria-label={`Remove photo ${index + 1}`}
          onClick={() => onRemove(photo.id)}
        >
          <X size={16} />
          Remove
        </button>
      </span>
    </li>
  );
}

export default function SimpleRequest(
  props: SimpleRequestProps,
): React.ReactElement {
  const { jobs, requests, onSubmit, initialRequest } = props;
  // Only active directory rows are offered; without any, the page falls back to
  // a typed customer name so it still works.
  const seededJob: JobEntry | undefined = initialRequest?.workspaceId
    ? {
        id: `workspace-${initialRequest.workspaceId}`,
        jobNumber: initialRequest.job.jobNumber,
        customer: initialRequest.job.customer,
        address: initialRequest.job.address,
        projectManager: initialRequest.job.projectManager,
        estimator: initialRequest.job.branchContact,
        status: "Active",
        customerPhone: initialRequest.job.customerPhone || "",
        customerEmail: initialRequest.job.customerEmail || "",
        contractAmount: initialRequest.job.originalContract,
        active: true,
        updatedAt: initialRequest.updatedAt,
      }
    : undefined;
  const directoryJobs = seededJob
    ? [
        seededJob,
        ...jobs.filter(
          (job) => job.active && job.jobNumber !== seededJob.jobNumber,
        ),
      ]
    : jobs.filter((job) => job.active);
  const customerId = useId();
  const noteId = useId();
  const amountId = useId();
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const submissionStarted = useRef(false);

  const [jobId, setJobId] = useState(seededJob?.id || "");
  // The customer/job search text. In directory mode it is the type-ahead query
  // and then the chosen job's label; without a directory it is simply the
  // customer's name, so the page still works on a bare device.
  const [customerText, setCustomerText] = useState(
    seededJob ? jobLabel(seededJob) : "",
  );
  const [matchListOpen, setMatchListOpen] = useState(false);
  const [note, setNote] = useState("");
  const [requestType, setRequestType] =
    useState<ChangeRequest["requestType"]>();
  const [customerCredits, setCustomerCredits] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountSign, setAmountSign] = useState<"+" | "-">("+");
  const [amountError, setAmountError] = useState("");
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [contentError, setContentError] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [emailError, setEmailError] = useState("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceNote, setVoiceNote] = useState<{
    tone: "error" | "info";
    text: string;
  } | null>(null);
  // Voice is only an accelerator: an unsupported browser hides the microphone
  // and the textarea keeps working.
  const [voiceSupported] = useState(() => speechRecognition() !== null);

  const selectedJob = directoryJobs.find((job) => job.id === jobId) ?? null;
  const amountText = amount.trim();
  const validAmount = !amountText || /^\d+(?:\.\d{1,2})?$/.test(amountText);
  const [amountDollars, amountCents = ""] = amountText.split(".");
  const knownChangeAmount =
    validAmount && amountText
      ? `${amountSign}${amountDollars}.${amountCents.padEnd(2, "0")}`
      : undefined;
  const editing = photos.find((photo) => photo.id === editingId) ?? null;
  const fallbackCustomer = !directoryJobs.length;
  const query = customerText.trim().toLowerCase();
  const selectedLabel = selectedJob ? jobLabel(selectedJob) : "";
  // Suggestions appear while the PM types and never for the job already chosen.
  const showMatches =
    !fallbackCustomer &&
    matchListOpen &&
    query.length > 0 &&
    query !== selectedLabel.toLowerCase();
  const matches = showMatches
    ? directoryJobs
        .filter((job) =>
          `${job.customer} ${job.jobNumber} ${job.address} ${job.projectManager}`
            .toLowerCase()
            .includes(query),
        )
        .slice(0, 6)
    : [];
  const matchListId = `${customerId}-matches`;

  const chooseJob = (job: JobEntry) => {
    setJobId(job.id);
    setCustomerText(jobLabel(job));
    setMatchListOpen(false);
    setCustomerError("");
  };

  useEffect(
    () => () => {
      const instance = recognition.current;
      recognition.current = null;
      try {
        instance?.abort();
      } catch {
        // The recognizer was already torn down.
      }
    },
    [],
  );

  /**
   * Opens the picker for the source the PM pressed. `capture` is set on the
   * shared input right before the picker opens: with it the phone goes straight
   * to the camera, without it the OS offers the photo library. The attribute is
   * not a React prop, so a re-render never puts it back.
   */
  const openPhotoPicker = (source: "camera" | "library") => {
    const input = photoInput.current;
    if (!input) return;
    if (source === "camera") input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };

  const addPhotos = (files: File[]) => {
    // Not every OS reports a photo's MIME type; a HEIC off Windows often has
    // an empty one, and silently dropping it looked like the picker ignoring
    // the tap. Extension-matching files are converted at upload if needed.
    const images = files.filter(looksLikePhotoFile);
    if (!images.length) return;
    setContentError("");
    setPhotos((current) => [
      ...current,
      ...images.map((file) => ({
        id: newId(),
        file,
        blob: file as Blob,
        edited: false,
      })),
    ]);
  };

  const removePhoto = (id: string) => {
    setPhotos((current) => current.filter((photo) => photo.id !== id));
    setEditingId((current) => (current === id ? null : current));
  };

  const saveEdited = (id: string, blob: Blob) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id ? { ...photo, blob, edited: true } : photo,
      ),
    );
    setEditingId(null);
  };

  const stopListening = () => {
    const instance = recognition.current;
    recognition.current = null;
    setListening(false);
    setInterim("");
    try {
      instance?.stop();
    } catch {
      // Already stopped.
    }
  };

  const startListening = () => {
    const Recognition = speechRecognition();
    if (!Recognition) return;
    setVoiceNote(null);
    setInterim("");
    try {
      const instance = new Recognition();
      instance.continuous = true;
      instance.interimResults = true;
      instance.lang = "en-US";
      instance.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += transcript;
          else interimText += transcript;
        }
        const addition = finalText.trim();
        // Final speech is appended to whatever is already typed, never over it.
        if (addition)
          setNote((current) =>
            current.trim() ? `${current.trimEnd()} ${addition}` : addition,
          );
        setInterim(interimText);
      };
      instance.onerror = (event) => {
        const code = event.error || "";
        if (code === "aborted") {
          setVoiceNote({ tone: "info", text: "Voice input stopped." });
        } else {
          setVoiceNote({
            tone: "error",
            text:
              VOICE_ERRORS[code] ??
              "Voice input stopped. Type the note instead.",
          });
        }
        setListening(false);
        setInterim("");
      };
      instance.onend = () => {
        setListening(false);
        setInterim("");
      };
      recognition.current = instance;
      instance.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setVoiceNote({
        tone: "error",
        text: "Voice input could not start on this device — type the note instead.",
      });
    }
  };

  const submit = async () => {
    if (submissionStarted.current) return;
    const customer = (selectedJob?.customer ?? customerText).trim();
    const nextCustomerError = customer
      ? ""
      : fallbackCustomer
        ? "Enter the customer or project owner."
        : "Type a customer or pick a job from the list.";
    const nextContentError =
      note.trim() || photos.length
        ? ""
        : "Add a note or at least one photo before sending.";
    const nextAmountError = validAmount
      ? ""
      : "Enter dollars with at most two decimal places, and use Plus or Minus to choose the sign.";
    const targetEmail = emailAddress.trim();
    const nextEmailError =
      targetEmail && (!targetEmail.includes("@") || !targetEmail.includes("."))
        ? "Please enter a valid email address or clear the field."
        : "";
    setCustomerError(nextCustomerError);
    setContentError(nextContentError);
    setAmountError(nextAmountError);
    setEmailError(nextEmailError);
    if (
      nextCustomerError ||
      nextContentError ||
      nextAmountError ||
      nextEmailError
    )
      return;
    if (listening) stopListening();
    submissionStarted.current = true;
    setBusy(true);
    // A workspace seed already knows its prior change orders. A directory job
    // is matched by job number so a second or third submission continues the
    // same running contract total.
    const prior =
      !initialRequest?.workspaceId && selectedJob
        ? await priorChangesForJob(
            requests,
            selectedJob.jobNumber,
            openRequest,
          )
        : undefined;
    const request = buildRequest(initialRequest ?? null, {
      job: selectedJob,
      customer,
      note,
      requestType,
      customerCredits,
      knownChangeAmount,
      prior,
    });
    onSubmit(
      createRequestSubmission(
        request,
        [
          ...photos.map((photo) => ({
            prepare: async () => {
              const prepared = await preparePhotoForUpload(
                photo.blob,
                photo.file.name,
              );
              return {
                name: prepared.name,
                mimeType: prepared.mimeType,
                size: prepared.size,
                kind: "photo" as const,
                data: await blobToBase64(prepared.blob),
              };
            },
          })),
          ...(pdf
            ? [
                {
                  prepare: async () => ({
                    name: pdf.name,
                    mimeType: pdf.type || "application/pdf",
                    size: pdf.size,
                    kind: "document" as const,
                    data: await blobToBase64(pdf),
                  }),
                },
              ]
            : []),
        ],
        targetEmail,
      ),
    );
  };

  return (
    <>
      <form
        className="simple-request"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header className="sr-head">
          <h1>Quick request</h1>
          <p className="sr-help">
            Send a change to estimating. A note or one photo is enough.
          </p>
        </header>

        <section className="sr-section">
          <h2 className="sr-section-title">Customer</h2>
          <div
            className="sr-combo"
            onBlur={(event) => {
              // Close only when focus leaves the field and its suggestions, so a
              // tap on a suggestion never tears the list down first.
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setMatchListOpen(false);
            }}
          >
            <label className="sr-label" htmlFor={customerId}>
              {fallbackCustomer ? "Customer / project owner" : "Customer / job"}
            </label>
            <input
              id={customerId}
              className="sr-input"
              type="text"
              value={customerText}
              disabled={busy}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showMatches}
              aria-controls={showMatches ? matchListId : undefined}
              placeholder={
                fallbackCustomer
                  ? "Customer or project owner"
                  : "Type a customer, job number, or address…"
              }
              aria-label={
                fallbackCustomer ? "Customer / project owner" : "Customer / job"
              }
              aria-required="true"
              aria-invalid={Boolean(customerError)}
              onChange={(event) => {
                const value = event.target.value;
                setCustomerText(value);
                setCustomerError("");
                // Typing over a pick means the chosen job no longer applies.
                if (selectedJob && value !== selectedLabel) setJobId("");
                setMatchListOpen(true);
              }}
              onFocus={() => setMatchListOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setMatchListOpen(false);
                  return;
                }
                // Enter takes the top match rather than submitting the form.
                if (event.key === "Enter" && matches.length) {
                  event.preventDefault();
                  chooseJob(matches[0]);
                }
              }}
            />
            {showMatches ? (
              <ul className="sr-matches" id={matchListId}>
                {matches.map((job) => (
                  <li key={job.id}>
                    <button
                      type="button"
                      className="sr-match"
                      aria-label={`Use job ${job.jobNumber || "without a number"} for ${job.customer || "this customer"}`}
                      // Keep focus on the input while the row is pressed. Without
                      // this the input blurs first on browsers that do not focus a
                      // button on press (macOS/iOS Safari), the list unmounts, and
                      // the click never lands — so the pick looked like a no-op.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseJob(job)}
                    >
                      <strong>{job.customer || "No customer name"}</strong>
                      <span>{job.jobNumber || "No job number"}</span>
                      {job.address ? <small>{job.address}</small> : null}
                    </button>
                  </li>
                ))}
                {!matches.length ? (
                  <li className="sr-match-empty">
                    No job matches “{customerText.trim()}”. You can still send
                    this with the customer name alone.
                  </li>
                ) : null}
              </ul>
            ) : null}
            {selectedJob ? (
              <dl className="sr-summary">
                <div>
                  <dt>Customer</dt>
                  <dd>{selectedJob.customer || "—"}</dd>
                </div>
                <div>
                  <dt>Job number</dt>
                  <dd>{selectedJob.jobNumber || "—"}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{selectedJob.address || "—"}</dd>
                </div>
                {selectedJob.customerPhone ? (
                  <div>
                    <dt>Customer phone</dt>
                    <dd>{selectedJob.customerPhone}</dd>
                  </div>
                ) : null}
                {selectedJob.customerEmail ? (
                  <div>
                    <dt>Customer email</dt>
                    <dd>{selectedJob.customerEmail}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Project manager</dt>
                  <dd>{selectedJob.projectManager || "—"}</dd>
                </div>
              </dl>
            ) : null}
          </div>
          {customerError ? (
            <p className="sr-error" role="alert">
              {customerError}
            </p>
          ) : null}
        </section>

        <section className="sr-section">
          <RequestQuestions
            requestType={requestType}
            customerCredits={customerCredits}
            disabled={busy}
            onChange={(answers) => {
              setRequestType(answers.requestType);
              setCustomerCredits(answers.customerCredits ?? false);
            }}
          />
        </section>

        <section className="sr-section sr-amount-section">
          <h2 className="sr-section-title">
            Known change amount <span className="sr-optional">optional</span>
          </h2>
          <p className="sr-help" id={`${amountId}-help`}>
            If you know the dollar amount, enter it here. Choose plus for an
            added cost or minus for a deduction.
          </p>
          <div
            className="sr-amount-sign"
            role="group"
            aria-label="Amount direction"
          >
            <button
              type="button"
              className={`button${amountSign === "+" ? " primary" : ""}`}
              aria-label="Plus — increase"
              aria-pressed={amountSign === "+"}
              disabled={busy}
              onClick={() => setAmountSign("+")}
            >
              <Plus size={18} aria-hidden="true" /> Plus
            </button>
            <button
              type="button"
              className={`button${amountSign === "-" ? " primary" : ""}`}
              aria-label="Minus — deduction"
              aria-pressed={amountSign === "-"}
              disabled={busy}
              onClick={() => setAmountSign("-")}
            >
              <Minus size={18} aria-hidden="true" /> Minus
            </button>
          </div>
          <label className="sr-label" htmlFor={amountId}>
            Known change amount
          </label>
          <div className="sr-amount-input">
            <span aria-hidden="true">{amountSign}$</span>
            <input
              id={amountId}
              className="sr-input"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              disabled={busy}
              aria-describedby={`${amountId}-help${amountError ? ` ${amountId}-error` : ""}`}
              aria-invalid={Boolean(amountError)}
              onChange={(event) => {
                setAmount(event.target.value);
                setAmountError("");
              }}
            />
          </div>
          {amountError ? (
            <p className="sr-error" id={`${amountId}-error`} role="alert">
              {amountError}
            </p>
          ) : null}
        </section>

        <section className="sr-section">
          <h2 className="sr-section-title">Photos</h2>
          {requestType === "insurance_supplement" ? (
            <div className="sr-insurance-photo-reminder" role="note">
              <Camera size={16} />
              <span>
                Insurance supplements require photos. Please attach photos for
                insurance.
              </span>
            </div>
          ) : null}
          <p className="sr-help">
            Take a photo or pick one from the phone. Mark up a photo to point at
            the work.
          </p>
          <input
            ref={photoInput}
            type="file"
            // One input backs both sources: the button that is pressed sets the
            // `capture` attribute just before the picker opens, so the phone
            // goes straight to the camera or shows the photo library. The
            // explicit list (same as the full request form) makes iOS transcode
            // HEIC library picks to JPEG; `image/*` would hand the raw HEIC
            // over, which the Apps Script endpoint rejects.
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            multiple
            hidden
            aria-label="Add photos"
            disabled={busy}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              addPhotos(files);
            }}
          />
          <div className="sr-photo-sources">
            <button
              type="button"
              className="button primary sr-photo-source"
              disabled={busy}
              onClick={() => openPhotoPicker("camera")}
            >
              <Camera size={19} />
              Take photo
            </button>
            <button
              type="button"
              className="button sr-photo-source"
              disabled={busy}
              onClick={() => openPhotoPicker("library")}
            >
              <Images size={19} />
              Choose from library
            </button>
          </div>
          {photos.length ? (
            <ul className="sr-photo-grid">
              {photos.map((photo, index) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  index={index}
                  disabled={busy}
                  onEdit={setEditingId}
                  onRemove={removePhoto}
                />
              ))}
            </ul>
          ) : null}
        </section>

        <section className="sr-section">
          <h2 className="sr-section-title">What changed?</h2>
          <label className="sr-label" htmlFor={noteId}>
            What changed?
          </label>
          <textarea
            id={noteId}
            className="sr-textarea"
            rows={5}
            value={note}
            disabled={busy}
            aria-label="What changed?"
            placeholder="e.g. Added insulation to the open kitchen wall"
            onChange={(event) => {
              setNote(event.target.value);
              setContentError("");
            }}
          />
          {voiceSupported ? (
            <button
              type="button"
              className={`button sr-mic${listening ? " is-listening" : ""}`}
              aria-pressed={listening}
              disabled={busy}
              onClick={() => (listening ? stopListening() : startListening())}
            >
              {listening ? <MicOff size={20} /> : <Mic size={20} />}
              {listening ? "Stop listening" : "Speak the note"}
            </button>
          ) : (
            <p className="sr-help">
              Voice input is not available in this browser — type your note
              instead.
            </p>
          )}
          {listening ? (
            <p className="sr-listening" aria-live="polite">
              <span className="sr-listening-dot" aria-hidden="true" />
              Listening…{interim ? <em>{interim}</em> : null}
            </p>
          ) : null}
          {voiceNote ? (
            <p
              className={voiceNote.tone === "error" ? "sr-error" : "sr-help"}
              role={voiceNote.tone === "error" ? "alert" : "status"}
            >
              {voiceNote.text}
            </p>
          ) : null}
          {contentError ? (
            <p className="sr-error" role="alert">
              {contentError}
            </p>
          ) : null}
        </section>

        <section className="sr-section">
          <h2 className="sr-section-title">
            PDF <span className="sr-optional">Optional</span>
          </h2>
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            aria-label="Attach a PDF"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (file) setPdf(file);
            }}
          />
          {pdf ? (
            <span className="sr-file-row">
              <FileText size={18} />
              <span className="sr-file-name">{pdf.name}</span>
              <button
                type="button"
                className="button"
                disabled={busy}
                aria-label={`Remove ${pdf.name}`}
                onClick={() => setPdf(null)}
              >
                <X size={17} />
                Remove
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="button sr-wide"
              disabled={busy}
              onClick={() => pdfInput.current?.click()}
            >
              <FileText size={18} />
              Attach a PDF
            </button>
          )}
        </section>

        <section className="sr-section email-card">
          <div className="email-card-header">
            <div className="email-card-title">
              <Mail size={18} />
              <strong>Email change order & attachments</strong>
            </div>
            {photos.length + (pdf ? 1 : 0) > 0 ? (
              <span className="email-attachments-count">
                <Paperclip size={14} />
                {photos.length + (pdf ? 1 : 0)} attachment
                {photos.length + (pdf ? 1 : 0) === 1 ? "" : "s"} included
              </span>
            ) : (
              <span className="email-attachments-count muted">
                No attachments
              </span>
            )}
          </div>
          <p className="email-card-desc">
            Enter an email address to send this change order and attachments
            directly. Sending automatically saves the change order, submits it
            to estimating, and returns to the home page.
          </p>
          <div className="email-form">
            <div className="email-input-group">
              <input
                type="email"
                className="email-input"
                value={emailAddress}
                onChange={(e) => {
                  setEmailAddress(e.target.value);
                  if (emailError) setEmailError("");
                }}
                placeholder="Enter recipient email (e.g. rrussell@haysandsons.com)"
                aria-label="Recipient email address"
                disabled={busy}
              />
              <button
                type="button"
                className="button primary"
                disabled={!emailAddress.trim() || busy}
                onClick={() => submit()}
              >
                <Send size={15} />
                {busy
                  ? "Sending email & submitting…"
                  : "Send email & submit to estimating"}
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
          </div>

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

        <div className="sr-submit">
          <CopyDashNote
            disabled={busy}
            text={formatDashNote(
              buildRequest(null, {
                job: selectedJob,
                customer: (selectedJob?.customer ?? customerText).trim(),
                note,
                requestType,
                customerCredits,
                knownChangeAmount,
              }),
              [
                ...photos.map((photo) => photo.file.name),
                ...(pdf ? [pdf.name] : []),
              ],
            )}
          />
          <button
            type="submit"
            className="button primary sr-submit-button"
            disabled={busy}
          >
            <Send size={19} />
            {busy
              ? "Submitting…"
              : emailAddress.trim()
                ? "Send email & submit to estimating"
                : "Send to estimating"}
          </button>
        </div>
      </form>
      {editing ? (
        <PhotoAnnotator
          file={editing.file}
          onSave={(blob) => saveEdited(editing.id, blob)}
          onCancel={() => setEditingId(null)}
        />
      ) : null}
    </>
  );
}
