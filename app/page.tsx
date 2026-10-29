"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Papa from "papaparse";

type Source = { title: string; url: string };

type Candidate = {
  authorName: string;
  bookTitle: string;
  bookWhy: string;
  reason: string;
};

type Research = {
  matchType: "exact" | "possible" | "none";
  confidence: "high" | "medium" | "low" | "none";
  authorName: string;
  bookTitle: string;
  bookWhy: string;
  notes: string;
  candidates: Candidate[];
  sources: Source[];
};

type Draft = { subject: string; body: string };

type Author = {
  email: string;
  name: string;
  status: "idle" | "loading" | "done" | "error";
  result?: Research;
  message?: string;
  approval?: "approved" | "rejected";
  editing?: boolean;
  draft?: Draft;
  writing?: boolean;
  sendStatus?: "sending" | "sent" | "failed";
  sendError?: string;
  bookLoading?: boolean;
};

const EMAIL_REGEX = /[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g;
const DEFAULT_SUBJECT = "Feature draft for [Book Title]";

const DEFAULT_BODY = `Hi [Author Name],

I recently came across [Book Title] and was really impressed by [Insert 1 specific detail: e.g., your message on resilience / your unique approach to personal growth].

Our team at The Author Global Press runs a dedicated Author Spotlight Series where we feature independent authors and help connect their stories with active readers online.

Instead of asking you to take my word for it, our editorial team would love to write a custom, complimentary feature draft for [Book Title] so you can see exact coverage before making any decisions.

If you'd be open to reviewing a $0 preview draft for your book, simply reply "YES" to this email and I'll send it over for you to check out.

Either way, congratulations on publishing [Book Title], it's a fantastic piece of work!

Best regards,

Augustine Emmanuel
Literary Publicist | The Author Global Press`;

// Replaces the placeholders in a text
function fillText(
  text: string,
  vals: { authorName: string; bookTitle: string; detail: string },
) {
  const first = vals.authorName.trim().split(" ")[0];
  let out = text;
  if (vals.authorName)
    out = out.replace(/\[\s*author name\s*\]/gi, () => vals.authorName);
  if (first) out = out.replace(/\[\s*first name\s*\]/gi, () => first);
  if (vals.bookTitle)
    out = out.replace(/\[\s*book title\s*\]/gi, () => vals.bookTitle);
  if (vals.detail)
    out = out.replace(/\[\s*insert[^\]]*\]/gi, () => vals.detail);
  return out;
}
// A small log in your browser of who you already emailed
const SENT_KEY = "sentEmails";

function getSent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function addSent(email: string) {
  try {
    const list = getSent();
    const e = email.toLowerCase();
    if (!list.includes(e)) {
      list.push(e);
      localStorage.setItem(SENT_KEY, JSON.stringify(list));
    }
  } catch {}
}

function wasSent(email: string) {
  return getSent().includes(email.toLowerCase());
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState(DEFAULT_SUBJECT);
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [progress, setProgress] = useState("");
  const stopRef = useRef(false);
  const [researchingAll, setResearchingAll] = useState(false);
  const [researchProgress, setResearchProgress] = useState("");
  const stopResearchRef = useRef(false);

  // Load the saved template when the page opens
  useEffect(() => {
    try {
      const saved = localStorage.getItem("emailTemplate");
      if (saved) {
        const t = JSON.parse(saved);
        if (t.subject) setSubjectTemplate(t.subject);
        if (t.body) setBodyTemplate(t.body);
      }
    } catch {}
    setTemplateLoaded(true);
  }, []);

  // Save the template every time you change it
  useEffect(() => {
    if (!templateLoaded) return;
    try {
      localStorage.setItem(
        "emailTemplate",
        JSON.stringify({ subject: subjectTemplate, body: bodyTemplate }),
      );
    } catch {}
  }, [subjectTemplate, bodyTemplate, templateLoaded]);
  // Load the saved author list when the page opens
  const [authorsLoaded, setAuthorsLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("authorsList");
      if (saved) {
        const list: Author[] = JSON.parse(saved);
        setAuthors(
          list.map(
            (a): Author => ({
              ...a,
              // If the page closed in the middle of a task, reset that task
              status:
                a.status === "loading"
                  ? a.result
                    ? "done"
                    : "idle"
                  : a.status,
              writing: false,
              editing: false,
              sendStatus: a.sendStatus === "sending" ? undefined : a.sendStatus,
            }),
          ),
        );
      }
    } catch {}
    setAuthorsLoaded(true);
  }, []);

  // Save the author list every time it changes
  useEffect(() => {
    if (!authorsLoaded) return;
    try {
      localStorage.setItem("authorsList", JSON.stringify(authors));
    } catch {}
  }, [authors, authorsLoaded]);

  // If you paste a full email that starts with "Subject:", split it
  function handleBodyChange(value: string) {
    const m = value.match(/^\s*subject:\s*(.*)\r?\n+/i);
    if (m) {
      setSubjectTemplate(m[1].trim());
      setBodyTemplate(value.slice(m[0].length));
    } else {
      setBodyTemplate(value);
    }
  }

  // Upload a .txt file with your template
  function handleTemplateFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleBodyChange(String(reader.result || ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  function addAuthors(newOnes: { email: string; name: string }[]) {
    setAuthors((current) => {
      const seen = new Set(current.map((a) => a.email.toLowerCase()));
      const result = [...current];
      for (const a of newOnes) {
        const key = a.email.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ ...a, status: "idle" });
        }
      }
      return result;
    });
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        const list = result.data
          .map((row) => ({
            email: (row.email || "").trim(),
            name: (row.name || "").trim(),
          }))
          .filter((a) => a.email.includes("@"));

        if (list.length === 0) {
          setError(
            "No emails found. Make sure your file has an 'email' column.",
          );
          return;
        }
        addAuthors(list);
      },
      error: () => setError("Could not read this file."),
    });

    e.target.value = "";
  }

  function handlePaste() {
    setError("");
    const list: { email: string; name: string }[] = [];

    for (const line of pasted.split("\n")) {
      const matches = line.match(EMAIL_REGEX);
      if (!matches) continue;

      if (matches.length > 1) {
        for (const email of matches) list.push({ email, name: "" });
      } else {
        const email = matches[0];
        const name = line
          .replace(email, "")
          .replace(/[,;<>"']/g, " ")
          .trim();
        list.push({ email, name });
      }
    }

    if (list.length === 0) {
      setError("No emails found in the box.");
      return;
    }
    addAuthors(list);
    setPasted("");
  }

  // Changes one author in the list
  function updateAuthor(email: string, changes: Partial<Author>) {
    setAuthors((current) =>
      current.map((a) => (a.email === email ? { ...a, ...changes } : a)),
    );
  }

  // Changes the research result of one author (used by Edit)
  function updateResult(email: string, changes: Partial<Research>) {
    setAuthors((current) =>
      current.map((a) =>
        a.email === email && a.result
          ? { ...a, result: { ...a.result, ...changes } }
          : a,
      ),
    );
  }

  // Searches the web for details about the book of one author
  async function findBookDetails(
    email: string,
    authorName: string,
    bookTitle: string,
  ) {
    if (!authorName || !bookTitle) {
      setError("Add the author name and the book title first.");
      return;
    }
    setError("");
    updateAuthor(email, { bookLoading: true });

    try {
      const res = await fetch("/api/research-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName, bookTitle }),
      });
      const data = await res.json();

      if (!res.ok) {
        updateAuthor(email, { bookLoading: false });
        setError(data.error || "Could not research the book.");
        return;
      }

      setAuthors((current) =>
        current.map((a) => {
          if (a.email !== email || !a.result) return a;
          const have = new Set(a.result.sources.map((s) => s.url));
          const newSources = (data.sources || []).filter(
            (s: Source) => !have.has(s.url),
          );
          return {
            ...a,
            bookLoading: false,
            result: {
              ...a.result,
              bookWhy: data.bookWhy || "",
              sources: [...a.result.sources, ...newSources],
            },
          };
        }),
      );

      if (!data.bookWhy) {
        setError(
          "No details about this book were found. You can type them yourself with Edit.",
        );
      }
    } catch {
      updateAuthor(email, { bookLoading: false });
      setError("Could not reach the server.");
    }
  }

  // Makes a similar author the main pick
  function pickCandidate(email: string, c: Candidate) {
    updateResult(email, {
      authorName: c.authorName,
      bookTitle: c.bookTitle,
      bookWhy: c.bookWhy,
    });
    if (!c.bookWhy) findBookDetails(email, c.authorName, c.bookTitle);
  }

  // Asks our research route about one author
  async function researchAuthor(
    author: Author,
  ): Promise<"ok" | "rate" | "fail"> {
    updateAuthor(author.email, { status: "loading", message: "" });

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: author.email, name: author.name }),
      });
      const data = await res.json();

      if (!res.ok) {
        updateAuthor(author.email, {
          status: "error",
          message: data.error || "Research failed.",
        });
        return res.status === 429 ? "rate" : "fail";
      }
      updateAuthor(author.email, {
        status: "done",
        result: data,
        approval: undefined,
        editing: false,
      });
      return "ok";
    } catch {
      updateAuthor(author.email, {
        status: "error",
        message: "Could not reach the server.",
      });
      return "fail";
    }
  }

  // Researches every author that is not done yet, one after the other
  async function researchAll() {
    const todo = authors.filter(
      (a) => a.status === "idle" || a.status === "error",
    );
    if (todo.length === 0) {
      setResearchProgress("Nothing to research.");
      return;
    }
    if (
      !confirm(
        `Research ${todo.length} authors? Keep this tab open until it finishes.`,
      )
    )
      return;

    stopResearchRef.current = false;
    setResearchingAll(true);
    setError("");
    let ok = 0;
    let failed = 0;

    for (let i = 0; i < todo.length; i++) {
      if (stopResearchRef.current) break;
      setResearchProgress(
        `Researching ${i + 1} of ${todo.length}: ${todo[i].email}`,
      );
      let result = await researchAuthor(todo[i]);

      // If we hit the rate limit, wait one minute and try once more
      if (result === "rate" && !stopResearchRef.current) {
        for (let s = 60; s > 0 && !stopResearchRef.current; s--) {
          setResearchProgress(
            `Rate limit reached. Waiting ${s}s, then trying again...`,
          );
          await wait(1000);
        }
        if (!stopResearchRef.current) result = await researchAuthor(todo[i]);
      }

      if (result === "ok") ok++;
      else failed++;

      // A short pause before the next author
      if (i < todo.length - 1) {
        for (let s = 5; s > 0 && !stopResearchRef.current; s--) {
          setResearchProgress(
            `Done ${ok} of ${todo.length}. Next author in ${s}s...`,
          );
          await wait(1000);
        }
      }
    }

    setResearchingAll(false);
    setResearchProgress(
      stopResearchRef.current
        ? `Stopped. ${ok} researched, ${failed} failed.`
        : `Finished. ${ok} researched, ${failed} failed.`,
    );
  }
  // Changes the email draft of one author (used when you edit it)
  function updateDraft(email: string, changes: Partial<Draft>) {
    setAuthors((current) =>
      current.map((a) =>
        a.email === email && a.draft
          ? { ...a, draft: { ...a.draft, ...changes } }
          : a,
      ),
    );
  }

  // Fills your template for one author
  async function fillTemplate(author: Author) {
    if (!author.result) return;
    if (!subjectTemplate.trim() || !bodyTemplate.trim()) {
      setError("Your template is empty. Add a subject and a message first.");
      return;
    }
    setError("");
    updateAuthor(author.email, { writing: true });

    const { authorName, bookTitle, bookWhy } = author.result;
    let detail = "";

    // Ask Gemini for the one specific detail, only if the template has that slot
    const placeholder = (bodyTemplate.match(/\[\s*insert[^\]]*\]/i) || [""])[0];
    if (placeholder && bookWhy) {
      try {
        const res = await fetch("/api/fill-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: bodyTemplate,
            placeholder,
            authorName,
            bookTitle,
            bookWhy,
          }),
        });
        const data = await res.json();
        if (res.ok) detail = data.detail || "";
      } catch {}
    }

    const vals = { authorName, bookTitle, detail };
    updateAuthor(author.email, {
      writing: false,
      draft: {
        subject: fillText(subjectTemplate, vals),
        body: fillText(bodyTemplate, vals),
      },
    });
  }

  // Fills the template for every approved author, one after the other
  async function fillAllApproved() {
    for (const a of authors) {
      if (a.approval === "approved" && !a.draft) {
        await fillTemplate(a);
      }
    }
  }
  const MAX_PER_RUN = 30;

  function hasPlaceholder(d: Draft) {
    return /\[[^\]]+\]/.test(d.subject + d.body);
  }

  // Sends one email. Returns true if it worked.
  async function sendOne(author: Author, test = false): Promise<boolean> {
    if (!author.draft) return false;

    if (hasPlaceholder(author.draft)) {
      setError(
        `The draft for ${author.email} still has a placeholder like [Book Title]. Fix it first.`,
      );
      return false;
    }

    setError("");
    if (!test) {
      updateAuthor(author.email, { sendStatus: "sending", sendError: "" });
    }

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: author.email,
          subject: author.draft.subject,
          body: author.draft.body,
          test,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (test) setError(data.error || "Could not send the test.");
        else
          updateAuthor(author.email, {
            sendStatus: "failed",
            sendError: data.error || "Could not send.",
          });
        return false;
      }

      if (test) {
        setProgress("✅ Test email sent to your own inbox. Go and check it.");
        return true;
      }
      addSent(author.email);
      updateAuthor(author.email, { sendStatus: "sent" });
      return true;
    } catch {
      if (test) setError("Could not reach the server.");
      else
        updateAuthor(author.email, {
          sendStatus: "failed",
          sendError: "Could not reach the server.",
        });
      return false;
    }
  }

  // The "Send to author" button
  async function sendOneClick(author: Author) {
    if (
      wasSent(author.email) &&
      !confirm("You already emailed this address before. Send again?")
    )
      return;
    if (!confirm(`Send this email to ${author.email}?`)) return;
    await sendOne(author);
  }

  // Sends every approved author, slowly, one after the other
  async function sendAllApproved() {
    const todo = authors.filter(
      (a) =>
        a.approval === "approved" &&
        a.draft &&
        a.sendStatus !== "sent" &&
        !wasSent(a.email),
    );
    if (todo.length === 0) {
      setProgress("Nothing to send.");
      return;
    }

    const batch = todo.slice(0, MAX_PER_RUN);
    if (
      !confirm(
        `Send ${batch.length} emails now? Keep this tab open until it finishes.`,
      )
    )
      return;

    stopRef.current = false;
    setSendingAll(true);
    setError("");
    let done = 0;

    for (let i = 0; i < batch.length; i++) {
      if (stopRef.current) break;
      setProgress(
        `Sending ${i + 1} of ${batch.length} to ${batch[i].email}...`,
      );
      const ok = await sendOne(batch[i]);
      if (ok) done++;

      // Wait 20 to 45 seconds before the next one
      if (i < batch.length - 1) {
        const secs = 20 + Math.floor(Math.random() * 25);
        for (let s = secs; s > 0 && !stopRef.current; s--) {
          setProgress(
            `Sent ${done} of ${batch.length}. Next email in ${s}s...`,
          );
          await wait(1000);
        }
      }
    }

    setSendingAll(false);
    setProgress(
      stopRef.current
        ? `Stopped. ${done} emails were sent.`
        : `Done. ${done} emails were sent.`,
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-3xl font-bold">Author Outreach</h1>
      <p className="mt-2 text-gray-600">
        Add authors by uploading a CSV file or by pasting emails below.
      </p>

      <h2 className="mt-6 font-semibold">Option 1: Upload a CSV</h2>
      <p className="text-sm text-gray-500">
        Needs an <b>email</b> column. A <b>name</b> column is optional.
      </p>
      <input
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="mt-2 block w-full rounded border p-3"
      />

      <h2 className="mt-6 font-semibold">Option 2: Paste emails</h2>
      <p className="text-sm text-gray-500">
        One per line. You can add a name after the email, like:{" "}
        <i>jane@example.com Jane Doe</i>
      </p>
      <textarea
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        rows={6}
        placeholder={"jane@example.com Jane Doe\njohn@example.com"}
        className="mt-2 w-full rounded border p-3"
      />
      <button
        onClick={handlePaste}
        className="mt-2 rounded bg-black px-4 py-2 text-white"
      >
        Add emails
      </button>

      <h2 className="mt-8 font-semibold">Your email template</h2>
      <p className="text-sm text-gray-500">
        Paste your own email here, or upload a .txt file. Use these
        placeholders: <b>[Author Name]</b>, <b>[First Name]</b>,{" "}
        <b>[Book Title]</b>, and <b>[Insert 1 specific detail: ...]</b> (the AI
        fills this one). If you paste a full email that starts with
        &quot;Subject:&quot;, the subject line is split off for you.
      </p>
      <input
        value={subjectTemplate}
        onChange={(e) => setSubjectTemplate(e.target.value)}
        placeholder="Subject line"
        className="mt-2 w-full rounded border p-3"
      />
      <textarea
        value={bodyTemplate}
        onChange={(e) => handleBodyChange(e.target.value)}
        rows={16}
        className="mt-2 w-full rounded border p-3"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded border px-3 py-2 text-sm">
          Upload .txt template
          <input
            type="file"
            accept=".txt"
            onChange={handleTemplateFile}
            className="hidden"
          />
        </label>
        <button
          onClick={() => {
            setSubjectTemplate(DEFAULT_SUBJECT);
            setBodyTemplate(DEFAULT_BODY);
          }}
          className="text-sm text-gray-500 underline"
        >
          Reset to the example
        </button>
        <button
          onClick={fillAllApproved}
          className="rounded bg-purple-600 px-4 py-2 text-white"
        >
          Fill template for all approved (
          {authors.filter((a) => a.approval === "approved" && !a.draft).length})
        </button>
      </div>

      {error && <p className="mt-4 text-red-600">{error}</p>}

      {authors.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              {authors.length} authors loaded (
              {authors.filter((a) => a.approval === "approved").length}{" "}
              approved)
            </h2>
            <button
              onClick={() => {
                if (confirm("Remove all authors, research and drafts?"))
                  setAuthors([]);
              }}
              className="text-sm text-red-600 underline"
            >
              Clear all
            </button>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded border bg-gray-50 p-3 text-gray-900">
            <button
              onClick={researchAll}
              disabled={researchingAll}
              className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            >
              Research all (
              {
                authors.filter(
                  (a) => a.status === "idle" || a.status === "error",
                ).length
              }{" "}
              to do)
            </button>
            {researchingAll && (
              <button
                onClick={() => (stopResearchRef.current = true)}
                className="rounded bg-red-600 px-4 py-2 text-white"
              >
                Stop
              </button>
            )}
            {researchProgress && (
              <span className="text-sm">{researchProgress}</span>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3 rounded border bg-gray-50 p-3 text-gray-900">
            <button
              onClick={sendAllApproved}
              disabled={sendingAll}
              className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            >
              Send all approved (
              {
                authors.filter(
                  (a) =>
                    a.approval === "approved" &&
                    a.draft &&
                    a.sendStatus !== "sent",
                ).length
              }{" "}
              ready)
            </button>
            {sendingAll && (
              <button
                onClick={() => (stopRef.current = true)}
                className="rounded bg-red-600 px-4 py-2 text-white"
              >
                Stop
              </button>
            )}
            {progress && <span className="text-sm">{progress}</span>}
          </div>

          <table className="w-full border text-left">
            <thead className="bg-gray-100 text-gray-900">
              <tr>
                <th className="border p-2">#</th>
                <th className="border p-2">Email</th>
                <th className="border p-2">Name</th>
                <th className="border p-2">Research</th>
              </tr>
            </thead>
            <tbody>
              {authors.map((a, i) => (
                <Fragment key={a.email}>
                  <tr>
                    <td className="border p-2">{i + 1}</td>
                    <td className="border p-2">{a.email}</td>
                    <td className="border p-2">{a.name || "-"}</td>
                    <td className="border p-2">
                      <button
                        onClick={() => researchAuthor(a)}
                        disabled={a.status === "loading"}
                        className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
                      >
                        {a.status === "loading"
                          ? "Researching..."
                          : a.status === "done"
                            ? "Redo"
                            : "Research"}
                      </button>
                    </td>
                  </tr>

                  {a.status === "error" && (
                    <tr key={a.email + "-error"}>
                      <td colSpan={4} className="border p-3 text-red-600">
                        {a.message}
                      </td>
                    </tr>
                  )}

                  {a.status === "done" && a.result && (
                    <tr key={a.email + "-result"}>
                      <td
                        colSpan={4}
                        className="border bg-gray-50 p-4 text-gray-900"
                      >
                        {a.result.matchType === "exact" && (
                          <p className="mb-3 rounded bg-green-100 p-2 text-sm text-green-900">
                            ✅ Exact match: this email was found in the search
                            results.
                          </p>
                        )}
                        {a.result.matchType === "possible" && (
                          <p className="mb-3 rounded bg-yellow-100 p-2 text-sm text-yellow-900">
                            ⚠️ The exact email was not found. These are possible
                            authors with a similar name. Please check the
                            sources before you trust this.
                          </p>
                        )}
                        {a.result.matchType === "none" && (
                          <p className="mb-3 rounded bg-red-100 p-2 text-sm text-red-900">
                            ❌ No author found for this email.
                          </p>
                        )}

                        {a.result.authorName && (
                          <>
                            <p>
                              <b>
                                {a.result.matchType === "possible"
                                  ? "Best guess:"
                                  : "Author:"}
                              </b>{" "}
                              {a.result.authorName}{" "}
                              <span className="text-sm text-gray-500">
                                (confidence: {a.result.confidence})
                              </span>
                            </p>
                            {a.result.bookTitle && (
                              <p className="mt-1">
                                <b>Book:</b> {a.result.bookTitle}
                              </p>
                            )}
                            {a.result.bookWhy && (
                              <p className="mt-1">
                                <b>Why it stands out:</b> {a.result.bookWhy}
                              </p>
                            )}
                            {a.result.bookTitle && !a.result.bookWhy && (
                              <p className="mt-1 text-sm text-gray-600">
                                No details about this book yet.
                                <button
                                  onClick={() =>
                                    findBookDetails(
                                      a.email,
                                      a.result!.authorName,
                                      a.result!.bookTitle,
                                    )
                                  }
                                  disabled={a.bookLoading}
                                  className="ml-2 rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                                >
                                  {a.bookLoading
                                    ? "Searching..."
                                    : "Find book details"}
                                </button>
                              </p>
                            )}
                          </>
                        )}

                        {a.result.notes && (
                          <p className="mt-2 text-sm text-gray-600">
                            {a.result.notes}
                          </p>
                        )}

                        {a.result.candidates.length > 0 && (
                          <div className="mt-3 text-sm">
                            <b>Other authors with a similar name:</b>
                            <ul className="mt-1 list-disc pl-5">
                              {a.result.candidates.map((c, n) => (
                                <li key={n} className="mb-1">
                                  <b>{c.authorName}</b>
                                  {c.bookTitle && <> – {c.bookTitle}</>}
                                  {c.reason && (
                                    <span className="text-gray-600">
                                      {" "}
                                      ({c.reason})
                                    </span>
                                  )}{" "}
                                  <button
                                    onClick={() => pickCandidate(a.email, c)}
                                    className="ml-1 rounded border px-2 py-0.5 text-xs"
                                  >
                                    Use this one
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {a.result.sources.length > 0 && (
                          <div className="mt-3 text-sm">
                            <b>Sources:</b>
                            <ul className="list-disc pl-5">
                              {a.result.sources.map((s, n) => (
                                <li key={n}>
                                  <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 underline"
                                  >
                                    {s.title}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Edit form */}
                        {a.editing && (
                          <div className="mt-4 rounded border bg-white p-3">
                            <label className="block text-sm font-semibold">
                              Author name
                            </label>
                            <input
                              value={a.result.authorName}
                              onChange={(e) =>
                                updateResult(a.email, {
                                  authorName: e.target.value,
                                })
                              }
                              className="mb-2 w-full rounded border p-2 text-gray-900"
                            />
                            <label className="block text-sm font-semibold">
                              Book title
                            </label>
                            <input
                              value={a.result.bookTitle}
                              onChange={(e) =>
                                updateResult(a.email, {
                                  bookTitle: e.target.value,
                                })
                              }
                              className="mb-2 w-full rounded border p-2 text-gray-900"
                            />
                            <label className="block text-sm font-semibold">
                              Why it stands out
                            </label>
                            <textarea
                              value={a.result.bookWhy}
                              onChange={(e) =>
                                updateResult(a.email, {
                                  bookWhy: e.target.value,
                                })
                              }
                              rows={3}
                              className="w-full rounded border p-2 text-gray-900"
                            />
                          </div>
                        )}

                        {/* Yes / No / Edit buttons */}
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                          <button
                            onClick={() =>
                              updateAuthor(a.email, {
                                approval: "approved",
                                editing: false,
                              })
                            }
                            className="rounded bg-green-600 px-3 py-1 text-white"
                          >
                            Yes, correct
                          </button>
                          <button
                            onClick={() =>
                              updateAuthor(a.email, {
                                approval: "rejected",
                                editing: false,
                              })
                            }
                            className="rounded bg-red-600 px-3 py-1 text-white"
                          >
                            No
                          </button>
                          <button
                            onClick={() =>
                              updateAuthor(a.email, { editing: !a.editing })
                            }
                            className="rounded border px-3 py-1"
                          >
                            {a.editing ? "Close edit" : "Edit"}
                          </button>

                          {a.approval === "approved" && (
                            <span className="font-semibold text-green-700">
                              ✅ Approved
                            </span>
                          )}
                          {a.approval === "rejected" && (
                            <span className="font-semibold text-red-700">
                              ❌ Rejected
                            </span>
                          )}
                        </div>
                        {a.approval === "approved" && (
                          <div className="mt-4 border-t pt-3">
                            <button
                              onClick={() => fillTemplate(a)}
                              disabled={a.writing}
                              className="rounded bg-purple-600 px-3 py-1 text-white disabled:opacity-50"
                            >
                              {a.writing
                                ? "Filling..."
                                : a.draft
                                  ? "Fill again (resets edits)"
                                  : "Fill template"}
                            </button>

                            {a.draft && (
                              <div className="mt-3 rounded border bg-white p-3">
                                <p className="mb-1 text-sm text-gray-500">
                                  To: {a.email}
                                </p>

                                {/\[[^\]]+\]/.test(
                                  a.draft.subject + a.draft.body,
                                ) && (
                                  <p className="mb-2 rounded bg-yellow-100 p-2 text-sm text-yellow-900">
                                    ⚠️ Some placeholders are still not filled
                                    (like{" "}
                                    {
                                      (a.draft.subject + a.draft.body).match(
                                        /\[[^\]]+\]/,
                                      )?.[0]
                                    }
                                    ). Please fix them by hand below before
                                    sending.
                                  </p>
                                )}

                                <label className="block text-sm font-semibold">
                                  Subject
                                </label>
                                <input
                                  value={a.draft.subject}
                                  onChange={(e) =>
                                    updateDraft(a.email, {
                                      subject: e.target.value,
                                    })
                                  }
                                  className="mb-2 w-full rounded border p-2 text-gray-900"
                                />
                                <label className="block text-sm font-semibold">
                                  Email
                                </label>
                                <textarea
                                  value={a.draft.body}
                                  onChange={(e) =>
                                    updateDraft(a.email, {
                                      body: e.target.value,
                                    })
                                  }
                                  rows={14}
                                  className="w-full rounded border p-2 text-gray-900"
                                />
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() => sendOne(a, true)}
                                    className="rounded border px-3 py-1 text-sm"
                                  >
                                    Send test to me
                                  </button>
                                  <button
                                    onClick={() => sendOneClick(a)}
                                    disabled={
                                      a.sendStatus === "sending" ||
                                      a.sendStatus === "sent"
                                    }
                                    className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
                                  >
                                    {a.sendStatus === "sending"
                                      ? "Sending..."
                                      : a.sendStatus === "sent"
                                        ? "Sent"
                                        : "Send to author"}
                                  </button>
                                  {a.sendStatus === "sent" && (
                                    <span className="font-semibold text-green-700">
                                      ✅ Sent
                                    </span>
                                  )}
                                  {a.sendStatus === "failed" && (
                                    <span className="text-red-600">
                                      ❌ {a.sendError}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
