/* ==========================================================================
   Prend Surveys — app
   Sections:
     1. Small helpers (DOM, dates)
     2. Survey types (add new renderers here)
     3. Loading + validating surveys.json
     4. "Already voted" memory (localStorage + cookie)
     5. Results chart
     6. Hero (active survey) and Archive rendering
     7. Boot + automatic open/close refresh
   ========================================================================== */

import { TIME_ZONE, SURVEYS_URL } from "./config.js";
import { getResults, submitVote, seedDemoResults, adapterName } from "./data.js";

const LOG = "[Prend Surveys]";

/* ==========================================================================
   1. Helpers
   ========================================================================== */

/** Tiny hyperscript helper. Uses textContent only, never innerHTML. */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---- Dates (all evaluated/displayed in TIME_ZONE) ---- */

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, hourCycle: "h23",
  year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric",
});

/** Offset (ms) of TIME_ZONE from UTC at the given instant. */
function zoneOffsetMs(ts) {
  const p = Object.fromEntries(zoneParts.formatToParts(new Date(ts)).map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

/**
 * Parses a config date. Strings with an offset or "Z" are exact instants.
 * Strings WITHOUT one (e.g. "2026-11-02T15:00") are read as TIME_ZONE wall time.
 * Returns null if malformed.
 */
function parseDate(str) {
  if (typeof str !== "string") return null;
  const s = str.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:\d{2})?$/i);
  if (!m) return null;

  if (m[7]) {
    const d = new Date(s.replace(" ", "T"));
    return isNaN(d) ? null : d;
  }

  const [, y, mo, d, hh = "0", mi = "0", ss = "0"] = m;
  const wall = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss);
  const check = new Date(wall);
  if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || +hh > 23 || +mi > 59) return null;

  let instant = wall - zoneOffsetMs(wall);          // first guess
  instant = wall - zoneOffsetMs(instant);           // refine across DST edges
  return new Date(instant);
}

const fmtFull = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const fmtDay = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, month: "short", day: "numeric", year: "numeric",
});

/* ==========================================================================
   2. Survey types
   --------------------------------------------------------------------------
   Each type is an object with:
     validate(survey)           -> string[]   problems (empty = fine)
     getOptions(survey)         -> string[]   labels used by the results chart
     renderBallot(survey, submit) -> HTMLElement
         Builds the voting UI. When the person confirms, call
         `await submit(optionIndex)`. It rejects with a friendly Error
         message on failure; show it and let them try again.

   To add a type (e.g. "yes-no" or "rating-1-5"): add an entry below and use
   its name in "type" in surveys.json. Nothing else needs to change.
   Votes are always stored as "option index -> count", so a rating type can
   simply expose getOptions() = ["1","2","3","4","5"].
   ========================================================================== */

const SURVEY_TYPES = {
  "multiple-choice": {
    validate(s) {
      const errs = [];
      if (!Array.isArray(s.options) || s.options.length < 2) {
        errs.push('"options" must be an array with at least 2 choices');
      } else if (s.options.some((o) => typeof o !== "string" || !o.trim())) {
        errs.push('every item in "options" must be a non-empty string');
      } else if (new Set(s.options).size !== s.options.length) {
        errs.push('"options" contains duplicates');
      } else if (s.options.length > 20) {
        errs.push('"options" supports at most 20 choices');
      }
      return errs;
    },

    getOptions: (s) => s.options,

    renderBallot(survey, submit) {
      const name = `choice-${survey.id}`;
      const error = h("p", { class: "form-error", role: "alert", hidden: true });
      const button = h("button", { class: "btn", type: "submit" }, "Submit vote");

      const options = survey.options.map((label, i) =>
        h("label", { class: "option" },
          h("input", { type: "radio", name, value: String(i) }),
          h("span", { class: "option__body" },
            h("span", { class: "option__mark", "aria-hidden": "true" }),
            h("span", {}, label)))
      );

      const form = h("form", { class: "ballot", novalidate: true },
        h("fieldset", {},
          h("legend", { class: "visually-hidden" }, survey.question),
          ...options),
        error,
        button);

      const showError = (msg) => { error.textContent = msg; error.hidden = !msg; };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (form.dataset.busy) return;                       // prevent double-submit

        const picked = form.querySelector(`input[name="${name}"]:checked`);
        if (!picked) { showError("Please choose an option first."); return; }
        showError("");

        form.dataset.busy = "1";
        form.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
        button.textContent = "Submitting…";

        try {
          await submit(Number(picked.value));
        } catch (err) {
          delete form.dataset.busy;
          form.querySelectorAll("input, button").forEach((el) => (el.disabled = false));
          button.textContent = "Submit vote";
          showError(err.message || "Something went wrong. Please try again.");
        }
      });

      return form;
    },
  },
};

/* ==========================================================================
   3. Loading + validating surveys.json
   ========================================================================== */

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Returns validated surveys (with parsed dates). Bad ones are logged and skipped. */
function validateSurveys(raw) {
  if (!Array.isArray(raw)) {
    console.error(`${LOG} surveys.json must contain an array of survey objects.`);
    return [];
  }

  const seen = new Set();
  const valid = [];

  raw.forEach((s, index) => {
    const label = `Survey #${index + 1}${s && s.id ? ` ("${s.id}")` : ""}`;
    const errs = [];

    if (!s || typeof s !== "object") { console.error(`${LOG} ${label}: not an object.`); return; }

    if (typeof s.id !== "string" || !ID_PATTERN.test(s.id)) {
      errs.push('"id" is required and may only contain letters, numbers, "-" and "_"');
    } else if (seen.has(s.id)) {
      errs.push(`duplicate id "${s.id}"`);
    }
    for (const field of ["title", "question"]) {
      if (typeof s[field] !== "string" || !s[field].trim()) errs.push(`missing "${field}"`);
    }

    const type = s.type ?? "multiple-choice";
    const renderer = SURVEY_TYPES[type];
    if (!renderer) errs.push(`unknown type "${type}" (known: ${Object.keys(SURVEY_TYPES).join(", ")})`);
    else errs.push(...renderer.validate(s));

    const opensAt = parseDate(s.opens);
    const closesAt = parseDate(s.closes);
    if (!opensAt) errs.push(`"opens" is missing or not a valid date (got ${JSON.stringify(s.opens)})`);
    if (!closesAt) errs.push(`"closes" is missing or not a valid date (got ${JSON.stringify(s.closes)})`);
    if (opensAt && closesAt && closesAt <= opensAt) errs.push('"closes" must be after "opens"');

    if (typeof s.id === "string") seen.add(s.id);

    if (errs.length) {
      console.error(`${LOG} ${label} skipped:\n  - ${errs.join("\n  - ")}`);
      return;
    }
    valid.push({ ...s, type, opensAt, closesAt });
  });

  return valid;
}

async function loadSurveys() {
  const response = await fetch(SURVEYS_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${SURVEYS_URL}`);
  return validateSurveys(await response.json());
}

const typeOf = (survey) => SURVEY_TYPES[survey.type];
const isOpen = (s, now) => s.opensAt <= now && now < s.closesAt;

/** Open survey that opened most recently, or null. */
function pickActive(surveys, now) {
  return surveys.filter((s) => isOpen(s, now)).sort((a, b) => b.opensAt - a.opensAt)[0] || null;
}

/** Closed surveys, newest close date first. */
function pickClosed(surveys, now) {
  return surveys.filter((s) => s.closesAt <= now).sort((a, b) => b.closesAt - a.closesAt);
}

/* ==========================================================================
   4. "Already voted" memory
   --------------------------------------------------------------------------
   One flag per survey, in localStorage with a long-lived cookie as backup.
   It stores only the chosen option number, on the voter's own device, so
   we can highlight it. Nothing is sent anywhere and nothing identifies
   the voter. (Clearing site data or a private window bypasses it. That's
   a deliberate tradeoff; see README.)
   ========================================================================== */

const VOTED_KEY = "prendSurveys:voted:";
const COOKIE_NAME = "prend_voted_";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 730; // ~2 years
const cookiePath = () => location.pathname.replace(/[^/]*$/, "") || "/";

function readCookie(name) {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

function writeCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE}; path=${cookiePath()}; SameSite=Lax`;
}

/** Returns { index } (index may be null if unreadable) when voted, else null. */
function getVote(surveyId) {
  let value = null;
  try { value = localStorage.getItem(VOTED_KEY + surveyId); } catch { /* storage blocked */ }
  const cookie = readCookie(COOKIE_NAME + surveyId);

  if (value === null && cookie === null) return null;
  value ??= cookie;                                              // restore from backup
  try { localStorage.setItem(VOTED_KEY + surveyId, value); } catch { /* ignore */ }
  if (cookie === null) writeCookie(COOKIE_NAME + surveyId, value);

  const index = parseInt(value, 10);
  return { index: Number.isInteger(index) && index >= 0 ? index : null };
}

function rememberVote(surveyId, index) {
  try { localStorage.setItem(VOTED_KEY + surveyId, String(index)); } catch { /* ignore */ }
  writeCookie(COOKIE_NAME + surveyId, String(index));
}

/** Dev helper: visit index.html?reset in "local" mode to wipe votes + flags. */
function maybeResetDemoData() {
  const params = new URLSearchParams(location.search);
  if (!params.has("reset") || adapterName !== "local") return;

  try {
    Object.keys(localStorage).filter((k) => k.startsWith("prendSurveys:")).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
  document.cookie.split("; ").map((c) => c.split("=")[0]).filter((n) => n.startsWith(COOKIE_NAME))
    .forEach((n) => { document.cookie = `${n}=; max-age=0; path=${cookiePath()}`; });

  params.delete("reset");
  const qs = params.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  console.info(`${LOG} Demo data reset.`);
}

/* ==========================================================================
   5. Results chart (plain HTML/CSS)
   ========================================================================== */

/** Pads/cleans raw counts to one number per option. */
const normalizeCounts = (counts, length) =>
  Array.from({ length }, (_, i) => Math.max(0, Number(counts?.[i]) || 0));

function buildChart(survey, rawCounts, chosenIndex) {
  const labels = typeOf(survey).getOptions(survey);
  const counts = normalizeCounts(rawCounts, labels.length);
  const total = counts.reduce((a, b) => a + b, 0);

  const rows = labels.map((label, i) => {
    const pct = total ? (counts[i] / total) * 100 : 0;
    const mine = i === chosenIndex;
    return h("li", { class: "bar" + (mine ? " is-mine" : ""), style: `--i:${i}` },
      h("div", { class: "bar__label" },
        h("span", { class: "bar__name" }, label),
        mine ? h("span", { class: "badge" }, "Your vote") : null),
      h("div", { class: "bar__track", "aria-hidden": "true" },
        h("div", { class: "bar__fill", style: `--pct:${pct.toFixed(2)}%` })),
      // This text line doubles as the text alternative for the bar above.
      h("div", { class: "bar__value" },
        h("strong", {}, `${Math.round(pct)}%`),
        ` · ${plural(counts[i], "vote")}`));
  });

  return h("div", { class: "chart" },
    h("ol", { class: "chart__bars", "aria-label": `Results for ${survey.title}` }, ...rows),
    h("p", { class: "chart__total" }, `${plural(total, "vote")} total`));
}

/**
 * Triggers the grow-in animation once the chart is in the DOM. Reading
 * offsetWidth forces a reflow so the 0-width start state is committed before
 * the class is added (no requestAnimationFrame: it never fires in background tabs).
 */
function animateChart(chart) {
  void chart.offsetWidth;
  chart.classList.add("is-in");
}

/** Loads results into `container` (with loading + retry states). */
async function showResults(container, survey, { chosen = null, notice = "" } = {}) {
  container.replaceChildren(h("p", { class: "muted" }, "Loading results…"));

  let counts;
  try {
    counts = await getResults(survey.id);
  } catch (err) {
    console.error(`${LOG} Could not load results for "${survey.id}":`, err);
    container.replaceChildren(
      h("p", { class: "form-error", role: "alert" }, "We couldn't load the results. Check your connection and try again."),
      h("button", { class: "btn btn--ghost", type: "button", onclick: () => showResults(container, survey, { chosen, notice }) }, "Try again"));
    return;
  }

  const chart = buildChart(survey, counts, chosen);
  container.replaceChildren(
    notice ? h("p", { class: "notice", role: "status" }, notice) : null,
    chart);
  animateChart(chart);
}

/* ==========================================================================
   6. Hero + Archive
   ========================================================================== */

const heroEl = document.getElementById("hero");
const archiveListEl = document.getElementById("archive-list");

function renderHero(survey) {
  heroEl.setAttribute("aria-busy", "false");

  if (!survey) {
    heroEl.replaceChildren(
      h("div", { class: "card hero__card empty" },
        h("p", { class: "eyebrow eyebrow--idle" }, "Current survey"),
        h("h2", { class: "survey-title", style: "margin-top:10px" }, "No active survey right now."),
        h("p", { class: "muted" }, "Check back soon.")));
    return;
  }

  const body = h("div", { class: "hero__body" });
  const card = h("article", { class: "card hero__card" },
    h("div", { class: "hero__meta" },
      h("span", { class: "eyebrow" }, "Current survey"),
      h("span", { class: "chip" }, `Closes ${fmtFull.format(survey.closesAt)}`)),
    h("h2", { class: "survey-title" }, survey.title),
    h("p", { class: "survey-question" }, survey.question),
    body);
  heroEl.replaceChildren(card);

  const previous = getVote(survey.id);
  if (previous) {
    showResults(body, survey, { chosen: previous.index, notice: "You've already voted." });
    return;
  }

  body.append(typeOf(survey).renderBallot(survey, async (optionIndex) => {
    if (!isOpen(survey, new Date())) {
      throw new Error("Sorry, this survey just closed. Refresh the page to see the results.");
    }
    try {
      await submitVote(survey.id, optionIndex);
    } catch (err) {
      console.error(`${LOG} Vote failed for "${survey.id}":`, err);
      throw new Error("We couldn't record your vote. Check your connection and try again.");
    }
    rememberVote(survey.id, optionIndex);
    await showResults(body, survey, { chosen: optionIndex, notice: "Thanks! Your vote is in." });
  }));
}

async function renderArchive(closed) {
  if (!closed.length) {
    archiveListEl.replaceChildren(h("p", { class: "muted archive-empty" }, "No past surveys yet."));
    return;
  }

  // Fetch every total up front so each card can show its vote count.
  const results = await Promise.allSettled(closed.map((s) => getResults(s.id)));

  const cards = closed.map((survey, i) => {
    const panelId = `archive-panel-${survey.id}`;
    const panel = h("div", { class: "archive-panel", id: panelId, hidden: true });
    let counts = results[i].status === "fulfilled" ? results[i].value : null;

    const labels = typeOf(survey).getOptions(survey);
    const total = counts ? normalizeCounts(counts, labels.length).reduce((a, b) => a + b, 0) : null;

    const toggle = h("button", { class: "archive-toggle", type: "button", "aria-expanded": "false", "aria-controls": panelId },
      h("span", { class: "archive-title" }, survey.title),
      h("span", { class: "archive-question" }, survey.question),
      h("span", { class: "archive-meta" },
        `Closed ${fmtDay.format(survey.closesAt)} · ${total === null ? "votes unavailable" : plural(total, "vote")}`),
      h("span", { class: "chev", "aria-hidden": "true" }));

    toggle.addEventListener("click", async () => {
      const opening = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(opening));
      panel.hidden = !opening;
      if (!opening) return;

      if (counts) {                              // rebuild each time so the bars animate again
        const chart = buildChart(survey, counts, getVote(survey.id)?.index ?? null);
        panel.replaceChildren(chart);
        animateChart(chart);
      } else {                                   // earlier fetch failed: retry on open
        await showResults(panel, survey, { chosen: getVote(survey.id)?.index ?? null });
      }
    });

    return h("li", { class: "card archive-card" }, toggle, panel);
  });

  archiveListEl.replaceChildren(h("ul", { class: "archive-list" }, ...cards));
}

/* ==========================================================================
   7. Boot + automatic open/close refresh
   ========================================================================== */

let surveys = [];
let lastSignature = "";
let timer = null;

/** Re-renders only when the set of active/closed surveys actually changed. */
async function render() {
  const now = new Date();
  const active = pickActive(surveys, now);
  const closed = pickClosed(surveys, now);

  const signature = `${active?.id ?? "-"}|${closed.map((s) => s.id).join(",")}`;
  if (signature === lastSignature) return;
  lastSignature = signature;

  renderHero(active);
  await renderArchive(closed);
}

/** Wake up exactly when the next survey opens or closes. */
function scheduleNextChange() {
  clearTimeout(timer);
  const now = Date.now();
  const upcoming = surveys.flatMap((s) => [s.opensAt.getTime(), s.closesAt.getTime()]).filter((t) => t > now);
  if (!upcoming.length) return;
  const delay = Math.min(Math.min(...upcoming) - now + 500, 2 ** 31 - 1); // setTimeout max
  timer = setTimeout(tick, delay);
}

async function tick() {
  await render();
  scheduleNextChange();
}

async function boot() {
  maybeResetDemoData();

  try {
    surveys = await loadSurveys();
  } catch (err) {
    console.error(`${LOG} Could not load ${SURVEYS_URL}. If you opened index.html straight from disk, ` +
      `run a local server instead (see README).`, err);
    heroEl.setAttribute("aria-busy", "false");
    heroEl.replaceChildren(h("div", { class: "card hero__card empty" },
      h("h2", { class: "survey-title" }, "We couldn't load the surveys."),
      h("p", { class: "muted" }, "Please refresh the page in a moment.")));
    return;
  }

  seedDemoResults(surveys);   // local adapter only: fills in sampleResults for the demo
  await tick();

  // Re-check when a phone wakes up or the tab regains focus (timers pause in the background).
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

boot();
