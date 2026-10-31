type TavilyResult = { title: string; url: string; content: string };
export type FoundEmail = { email: string; source: string };

async function webSearch(query: string): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 8 }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

// Opens the pages and returns their full text
async function extractPages(
  urls: string[],
): Promise<{ url: string; content: string }[]> {
  if (urls.length === 0) return [];
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({ urls }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map(
      (r: { url: string; raw_content?: string }) => ({
        url: r.url,
        content: r.raw_content ?? "",
      }),
    );
  } catch {
    return [];
  }
}

const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;
const BAD_TLDS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "css",
  "js",
  "ico",
  "pdf",
];
const BAD_DOMAINS = [
  "example.com",
  "domain.com",
  "yourdomain.com",
  "sentry.io",
  "wixpress.com",
  "squarespace.com",
  "godaddy.com",
  "amazon.com",
  "goodreads.com",
  "facebook.com",
  "google.com",
  "w3.org",
  "schema.org",
];
const BAD_PREFIXES = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "privacy",
  "abuse",
  "postmaster",
  "webmaster",
];

// Pages that never show a real contact email, or that sell people's emails
const SKIP_HOSTS = [
  "amazon.",
  "goodreads.",
  "facebook.",
  "instagram.",
  "twitter.",
  "x.com",
  "youtube.",
  "linkedin.",
  "pinterest.",
  "tiktok.",
  "reddit.",
  "wikipedia.",
  "barnesandnoble.",
  "rocketreach.",
  "zoominfo.",
  "contactout.",
  "hunter.io",
  "signalhire.",
  "apollo.io",
  "lusha.",
  "emailsearch.",
  "skrapp.",
];

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function nameTokens(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

type Scored = FoundEmail & { score: number };

// Finds emails in a page text and keeps only the ones that look like this author's
function collectEmails(
  text: string,
  source: string,
  tokens: string[],
): Scored[] {
  const out: Scored[] = [];
  const lower = text.toLowerCase();
  const host = hostOf(source).replace(/[^a-z0-9]/g, "");
  const ownSite = tokens.some((t) => host.includes(t));

  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/^[._-]+|[._-]+$/g, "");
    const [localRaw, domain] = email.split("@");
    if (!localRaw || !domain || localRaw.length > 40) continue;

    const tld = domain.split(".").pop() || "";
    if (BAD_TLDS.includes(tld)) continue;
    if (BAD_DOMAINS.some((d) => domain === d || domain.endsWith("." + d)))
      continue;
    if (BAD_PREFIXES.some((p) => localRaw.startsWith(p))) continue;

    const local = localRaw.replace(/[^a-z0-9]/g, "");
    const domainClean = domain.replace(/[^a-z0-9]/g, "");
    const nameInEmail = tokens.some(
      (t) => local.includes(t) || domainClean.includes(t),
    );

    const idx = lower.indexOf(email);
    const around = lower.slice(Math.max(0, idx - 250), idx + 250);
    const nameNear =
      tokens.length > 0 && tokens.every((t) => around.includes(t));

    if (ownSite || nameInEmail || nameNear) {
      out.push({
        email,
        source,
        score: (nameInEmail ? 2 : 0) + (ownSite ? 1 : 0) + (nameNear ? 1 : 0),
      });
    }
  }
  return out;
}

// Looks for emails that the author shows publicly on their own pages
export async function findAuthorEmail(
  authorName: string,
  bookTitle: string,
): Promise<FoundEmail[]> {
  const tokens = nameTokens(authorName);
  if (tokens.length === 0) return [];

  const query = bookTitle
    ? `${authorName} author "${bookTitle}" official website contact`
    : `${authorName} author official website contact`;
  const results = await webSearch(query);

  // Keep pages that are the author's own site or clearly about the author
  const ranked = results
    .filter((r) => !SKIP_HOSTS.some((h) => hostOf(r.url).includes(h)))
    .map((r) => {
      const host = hostOf(r.url).replace(/[^a-z0-9]/g, "");
      const own = tokens.some((t) => host.includes(t));
      const mentions = tokens.every((t) =>
        (r.title + " " + r.content).toLowerCase().includes(t),
      );
      return { r, own, mentions };
    })
    .filter((x) => x.own || x.mentions)
    .sort((a, b) => Number(b.own) - Number(a.own))
    .slice(0, 3);

  if (ranked.length === 0) return [];

  const urls = new Set(ranked.map((x) => x.r.url));

  // Also try the contact and about pages of the author's own website
  const site = ranked.find((x) => x.own);
  if (site) {
    try {
      const origin = new URL(site.r.url).origin;
      urls.add(origin + "/contact");
      urls.add(origin + "/about");
    } catch {}
  }

  const pages = await extractPages([...urls]);

  const all: Scored[] = [];
  for (const p of pages) all.push(...collectEmails(p.content, p.url, tokens));
  for (const x of ranked)
    all.push(...collectEmails(x.r.content, x.r.url, tokens));

  // Remove duplicates, keep the best one, best first
  const best = new Map<string, Scored>();
  for (const e of all) {
    const old = best.get(e.email);
    if (!old || e.score > old.score) best.set(e.email, e);
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((e) => ({ email: e.email, source: e.source }));
}
export type SiteInfo = {
  website: string;
  contacts: { url: string; form: boolean }[];
};

const CONTACT_PATH = /contact|get-in-touch|reach|connect|write-to/i;

function pathOf(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

// A best guess: does the page text look like a contact form?
function looksLikeForm(text: string) {
  const t = text.toLowerCase();
  return (
    /\b(send|submit)\b/.test(t) &&
    /\bmessage\b/.test(t) &&
    /\b(name|e-?mail)\b/.test(t)
  );
}

function isNotFound(text: string) {
  return /page not found|404|doesn['’]t exist|nothing (was )?found/i.test(
    text.slice(0, 400),
  );
}

// Finds the author's own website and its contact page (no social media)
export async function findAuthorSite(
  authorName: string,
  bookTitle: string,
): Promise<SiteInfo> {
  const none: SiteInfo = { website: "", contacts: [] };
  const tokens = nameTokens(authorName);
  if (tokens.length === 0) return none;

  const query = bookTitle
    ? `${authorName} author "${bookTitle}" official website`
    : `${authorName} author official website`;
  const results = await webSearch(query);

  // Keep only sites whose address looks like the author's own
  const last = tokens[tokens.length - 1];
  const scored = results
    .filter((r) => !SKIP_HOSTS.some((h) => hostOf(r.url).includes(h)))
    .map((r) => {
      const host = hostOf(r.url).replace(/[^a-z0-9]/g, "");
      const all = tokens.every((t) => host.includes(t));
      const lastOnly = last.length >= 4 && host.includes(last);
      const mentions = tokens.every((t) =>
        (r.title + " " + r.content).toLowerCase().includes(t),
      );
      const score = all ? 2 : lastOnly && mentions ? 1 : 0;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return none;

  let origin = "";
  try {
    origin = new URL(scored[0].r.url).origin;
  } catch {
    return none;
  }
  const siteHost = hostOf(origin);

  // The home page, the usual contact addresses, and contact pages seen in search
  const urls = new Set<string>([origin]);
  for (const p of ["/contact", "/contact-me", "/contact-us"])
    urls.add(origin + p);
  for (const x of scored) {
    if (hostOf(x.r.url) === siteHost && CONTACT_PATH.test(pathOf(x.r.url)))
      urls.add(x.r.url);
  }

  const pages = await extractPages([...urls].slice(0, 8));

  const toContacts = (ps: { url: string; content: string }[]) =>
    ps
      .filter(
        (p) =>
          hostOf(p.url) === siteHost &&
          CONTACT_PATH.test(pathOf(p.url)) &&
          p.content.length > 80 &&
          !isNotFound(p.content),
      )
      .map((p) => ({ url: p.url, form: looksLikeForm(p.content) }));

  let contacts = toContacts(pages);

  // If none of the usual addresses worked, look for a "Contact" link on the home page
  if (contacts.length === 0) {
    const home = pages.find((p) => p.url.replace(/\/$/, "") === origin);
    const links = [
      ...(home?.content ?? "").matchAll(
        /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
      ),
    ]
      .filter(
        (m) =>
          hostOf(m[2]) === siteHost &&
          (CONTACT_PATH.test(m[1]) || CONTACT_PATH.test(m[2])),
      )
      .map((m) => m[2]);
    const extra = [...new Set(links)].filter((u) => !urls.has(u)).slice(0, 3);
    if (extra.length > 0) contacts = toContacts(await extractPages(extra));
  }

  // Remove duplicates, forms first
  const seen = new Set<string>();
  const unique = contacts.filter((c) => {
    const k = c.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => Number(b.form) - Number(a.form));

  return { website: origin, contacts: unique.slice(0, 3) };
}
