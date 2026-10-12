import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileText,
  Images,
  Mail,
  Mic,
  MicOff,
  Paperclip,
  Pencil,
  Send,
  X,
} from "lucide-react";
import {
  newId,
  type ChangeRequest,
  type JobEntry,
  type RequestAttachment,
} from "../types";
import { createRequest, createRequestedChange } from "../services/requests";
import {
  blobToBase64,
  saveRequest,
  sendRequestEmail,
  uploadAttachment,
} from "../services/storage";
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
  /** Called after the request was sent; the message is shown on the dashboard. */
  onDone: (message: string) => void;
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
  details: { job: JobEntry | null; customer: string; note: string } & Pick<
    ChangeRequest,
    "requestType" | "customerCredits"
  >,
): ChangeRequest {
  const request = base ?? createRequest();
  const description = details.note.trim();
  return {
    ...request,
    updatedAt: new Date().toISOString(),
    status: "submitted",
    submittedAt: null,
    requestType: details.requestType,
    customerCredits: details.customerCredits,
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
  const { jobs, onDone } = props;
  // Only active directory rows are offered; without any, the page falls back to
  // a typed customer name so it still works.
  const directoryJobs = jobs.filter((job) => job.active);
  const customerId = useId();
  const noteId = useId();
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  // The request + revision from a failed attempt, reused by the retry.
  const savedAttempt = useRef<{
    request: ChangeRequest;
    revision: number;
  } | null>(null);

  const [jobId, setJobId] = useState("");
  // The customer/job search text. In directory mode it is the type-ahead query
  // and then the chosen job's label; without a directory it is simply the
  // customer's name, so the page still works on a bare device.
  const [customerText, setCustomerText] = useState("");
  const [matchListOpen, setMatchListOpen] = useState(false);
  const [note, setNote] = useState("");
  const [requestType, setRequestType] =
    useState<ChangeRequest["requestType"]>();
  const [customerCredits, setCustomerCredits] = useState(false);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [contentError, setContentError] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState("");
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

  // One stable upload identity per photo, plus one for the PDF. The Apps Script
  // upload endpoint hands back the file it already holds when it sees the same
  // (attachmentId, mutationId) pair again, so retrying a partial failure cannot
  // leave a second copy of the same photo in Drive.
  const uploadIdentity = useRef(
    new Map<string, { attachmentId: string; mutationId: string }>(),
  );
  const uploadIdentityFor = (key: string) => {
    const existing = uploadIdentity.current.get(key);
    if (existing) return existing;
    const created = { attachmentId: newId(), mutationId: newId() };
    uploadIdentity.current.set(key, created);
    return created;
  };

  const ensureSavedAndUploaded = async (): Promise<{
    current: ChangeRequest;
    customer: string;
  }> => {
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
    setCustomerError(nextCustomerError);
    setContentError(nextContentError);
    if (nextCustomerError || nextContentError) {
      throw new Error(nextCustomerError || nextContentError);
    }
    if (listening) stopListening();

    const prior = savedAttempt.current;
    const request = buildRequest(prior?.request ?? null, {
      job: selectedJob,
      customer,
      note,
      requestType,
      customerCredits,
    });
    setProgress("Saving the request…");
    const saved = await saveRequest(request, prior?.revision ?? 0, newId());
    savedAttempt.current = { request: saved, revision: saved.revision };
    const total = photos.length + (pdf ? 1 : 0);
    let done = 0;
    const uploaded: RequestAttachment[] = [];
    for (const photo of photos) {
      done += 1;
      setProgress(`Uploading photo ${done} of ${total}…`);
      const prepared = await preparePhotoForUpload(
        photo.blob,
        photo.file.name,
      );
      const identity = uploadIdentityFor(photo.id);
      uploaded.push(
        await uploadAttachment(
          saved.id,
          {
            name: prepared.name,
            mimeType: prepared.mimeType,
            size: prepared.size,
            kind: "photo",
            data: await blobToBase64(prepared.blob),
          },
          identity.attachmentId,
          identity.mutationId,
        ),
      );
    }
    if (pdf) {
      done += 1;
      setProgress(`Uploading ${pdf.name}…`);
      const identity = uploadIdentityFor("pdf");
      uploaded.push(
        await uploadAttachment(
          saved.id,
          {
            name: pdf.name,
            mimeType: pdf.type || "application/pdf",
            size: pdf.size,
            kind: "document",
            data: await blobToBase64(pdf),
          },
          identity.attachmentId,
          identity.mutationId,
        ),
      );
    }
    let current = saved;
    if (uploaded.length) {
      setProgress("Attaching the files…");
      current = await saveRequest(
        { ...request, attachments: uploaded },
        saved.revision,
        newId(),
      );
      savedAttempt.current = { request: current, revision: current.revision };
    }
    return { current, customer };
  };

  const handleSendEmail = async () => {
    if (busy || sendingEmail) return;
    const targetEmail = emailAddress.trim();
    if (
      !targetEmail ||
      !targetEmail.includes("@") ||
      !targetEmail.includes(".")
    ) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailError("");
    setEmailSuccess("");
    setSendingEmail(true);
    setBusy(true);
    let savedResult: { current: ChangeRequest; customer: string } | null = null;
    try {
      savedResult = await ensureSavedAndUploaded();
      setProgress(`Sending email to ${targetEmail}…`);
      await sendRequestEmail(
        savedResult.current.id,
        targetEmail,
        undefined,
        savedResult.current,
      );
      savedAttempt.current = null;
      onDone(
        `Sent to estimating & emailed to ${targetEmail}: ${savedResult.customer}${selectedJob?.jobNumber ? ` · job ${selectedJob.jobNumber}` : ""}.`,
      );
    } catch (error) {
      if (savedResult) {
        // The request was saved and submitted to estimating, but email delivery had an issue
        savedAttempt.current = null;
        const msg = error instanceof Error ? error.message : "Email delivery issue";
        onDone(
          `Sent to estimating: ${savedResult.customer}${selectedJob?.jobNumber ? ` · job ${selectedJob.jobNumber}` : ""} (Note: ${msg}).`,
        );
      } else {
        setEmailError(
          error instanceof Error
            ? error.message
            : "Failed to send email. Check your connection and try again.",
        );
      }
    } finally {
      setSendingEmail(false);
      setBusy(false);
      setProgress("");
    }
  };

  const submit = async () => {
    if (busy || sendingEmail) return;
    setSubmitError("");
    setBusy(true);
    const targetEmail = emailAddress.trim();
    if (targetEmail && (!targetEmail.includes("@") || !targetEmail.includes("."))) {
      setEmailError("Please enter a valid email address or clear the field.");
      setBusy(false);
      return;
    }
    let savedResult: { current: ChangeRequest; customer: string } | null = null;
    try {
      savedResult = await ensureSavedAndUploaded();
      let emailNotice = "";
      if (targetEmail) {
        try {
          setProgress(`Sending email to ${targetEmail}…`);
          await sendRequestEmail(
            savedResult.current.id,
            targetEmail,
            undefined,
            savedResult.current,
          );
          emailNotice = ` & emailed to ${targetEmail}`;
        } catch (emailErr) {
          emailNotice = ` (email failed: ${emailErr instanceof Error ? emailErr.message : "could not deliver"})`;
        }
      }
      savedAttempt.current = null;
      onDone(
        `Sent to estimating${emailNotice}: ${savedResult.customer}${selectedJob?.jobNumber ? ` · job ${selectedJob.jobNumber}` : ""}.`,
      );
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "The request could not be sent. Check the connection and try again.",
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
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

        <section className="sr-section">
          <h2 className="sr-section-title">Photos</h2>
          {requestType === "insurance_supplement" ? (
            <div className="sr-insurance-photo-reminder" role="note">
              <Camera size={16} />
              <span>
                Insurance supplements require photos. Please attach photos for insurance.
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
            Enter an email address to send this change order and attachments directly. Sending automatically saves the change order, submits it to estimating, and returns to the home page.
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
                disabled={busy || sendingEmail}
              />
              <button
                type="button"
                className="button primary"
                disabled={!emailAddress.trim() || busy || sendingEmail}
                onClick={() => void handleSendEmail()}
              >
                <Send size={15} />
                {sendingEmail
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

        <div className="sr-submit">
          <CopyDashNote
            disabled={busy}
            text={formatDashNote(
              buildRequest(savedAttempt.current?.request ?? null, {
                job: selectedJob,
                customer: (selectedJob?.customer ?? customerText).trim(),
                note,
                requestType,
                customerCredits,
              }),
              [
                ...photos.map((photo) => photo.file.name),
                ...(pdf ? [pdf.name] : []),
              ],
            )}
          />
          {submitError ? (
            <p className="sr-error" role="alert">
              {submitError}
            </p>
          ) : null}
          {progress ? (
            <p className="sr-help" aria-live="polite">
              {progress}
            </p>
          ) : null}
          <button
            type="submit"
            className="button primary sr-submit-button"
            disabled={busy || sendingEmail}
          >
            <Send size={19} />
            {busy || sendingEmail
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
