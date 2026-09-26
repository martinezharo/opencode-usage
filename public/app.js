const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("en-US");

const WINDOW_ORDER = ["rolling", "weekly", "monthly"];
const REFRESH_MS = 60_000;

const refs = {
  meters: document.querySelector("#meters"),
  sessions: document.querySelector("#sessions"),
  sessionList: document.querySelector("#sessions-list"),
  sessionNote: document.querySelector("#sessions-note"),
  detail: document.querySelector("#detail"),
  host: document.querySelector("#meta-host"),
  clock: document.querySelector("#meta-clock"),
  note: document.querySelector("#foot-note"),
  template: document.querySelector("#meter-template"),
};

const meters = new Map();
let snapshot = null;
let active = null;
let hideTimer = 0;
let lastLoad = 0;
let sessionsSignature = "";

const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

function tokens(value) {
  if (!value) return "0";
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
  return String(value);
}

function cost(value) {
  if (value > 0 && value < 0.005) return "<$0.01";
  return usd.format(value);
}

function countdown(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

function resetText(iso) {
  if (!iso) return "reset time unavailable";
  const value = countdown(iso);
  return value === "now" ? "resetting now" : `resets in ${value}`;
}

function clockText() {
  return `${new Date().toISOString().slice(11, 16)} UTC`;
}

function agoText(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function dirLabel(directory) {
  if (!directory) return "";
  const parts = String(directory).split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : parts.join("/");
}

function buildMeters() {
  for (const key of WINDOW_ORDER) {
    const node = refs.template.content.firstElementChild.cloneNode(true);
    const track = node.querySelector(".meter__track");
    const fill = node.querySelector(".meter__fill");
    const ref = {
      node,
      track,
      fill,
      label: node.querySelector(".meter__label"),
      reset: node.querySelector(".meter__reset"),
      amount: node.querySelector(".meter__amount"),
      percent: node.querySelector(".meter__percent"),
      signature: "",
      window: null,
    };

    track.addEventListener("mouseenter", () => showDetail(key, track));
    track.addEventListener("mouseleave", scheduleHide);
    track.addEventListener("focus", () => showDetail(key, track));
    track.addEventListener("blur", scheduleHide);
    track.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideDetail();
    });
    fill.addEventListener("mouseover", (event) => {
      const seg = event.target.closest(".seg");
      if (seg) highlight(key, seg.dataset.model);
    });
    fill.addEventListener("mouseleave", () => highlight(key, null));

    refs.meters.append(node);
    meters.set(key, ref);
  }
}

function renderSegments(ref, window_) {
  const signature = window_.segments
    .map((seg) => `${seg.name}:${seg.spend.toFixed(6)}:${seg.share.toFixed(6)}`)
    .join("|");
  if (ref.signature === signature) return;
  ref.signature = signature;

  const segments = window_.segments.map((seg) => {
    const element = document.createElement("span");
    element.className = "seg";
    element.dataset.model = seg.name;
    element.style.setProperty("--c-light", seg.color.light);
    element.style.setProperty("--c-dark", seg.color.dark);
    element.style.flexGrow = String(seg.share);
    return element;
  });
  ref.fill.replaceChildren(...segments);
}

function apply() {
  refs.host.textContent = snapshot.host;

  for (const key of WINDOW_ORDER) {
    const window_ = snapshot.windows[key];
    const ref = meters.get(key);
    if (!window_ || !ref) continue;

    ref.window = window_;
    ref.label.textContent = window_.label;
    ref.reset.textContent = resetText(window_.resetsAt);
    renderSegments(ref, window_);

    if (window_.percent == null) {
      ref.amount.innerHTML = `${esc(cost(window_.activitySpent))}<span class="meter__limit">in this window</span>`;
      ref.percent.textContent = "";
      ref.percent.classList.remove("is-over");
      ref.fill.style.width = "100%";
      ref.track.setAttribute(
        "aria-label",
        `${window_.label}: ${cost(window_.activitySpent)} of model activity. ${resetText(window_.resetsAt)}`,
      );
      continue;
    }

    ref.amount.innerHTML = `${esc(usd.format(window_.planSpent))}<span class="meter__limit">of ${esc(usd.format(window_.limit))}</span>`;
    ref.percent.textContent = `${Math.round(window_.percent)}%`;
    ref.percent.classList.toggle("is-over", window_.percent > 100);
    ref.fill.style.width = `${Math.min(100, Math.max(0, window_.percent))}%`;
    ref.track.setAttribute(
      "aria-label",
      `${window_.label}: ${Math.round(window_.percent)} percent of the ${usd.format(window_.limit)} plan used. ${cost(window_.activitySpent)} of model activity. ${resetText(window_.resetsAt)}`,
    );
  }

  renderNote();
  renderSessions();
  if (active) refreshDetail();
}

function renderNote() {
  refs.note.replaceChildren();
  const parts = [];
  if (snapshot.dbAvailable === false) {
    parts.push(`No opencode database at ${snapshot.dbPath}`);
  }
  if (snapshot.limits == null) {
    parts.push("plan caps disabled; tracking spend by window");
  } else if (snapshot.plan === "api") {
    parts.push("Plan usage from the OpenCode Go API");
  } else {
    const limits = `$${snapshot.limits.rolling} / $${snapshot.limits.weekly} / $${snapshot.limits.monthly}`;
    parts.push(
      snapshot.planError === "no-key"
        ? "No OpenCode Go key found; showing local spend only"
        : `Plan limits API unavailable (${snapshot.planError}); showing local spend only`,
    );
    parts.push(`local estimates against ${limits}`);
  }
  if (snapshot.modelSource === "console") {
    parts.push("model costs from the OpenCode console");
  } else if (snapshot.planError === "no-key") {
    parts.push("model costs from local sessions");
  } else {
    parts.push(`console unavailable; model costs from local sessions`);
  }
  for (const text of parts) {
    const span = document.createElement("span");
    span.textContent = text;
    refs.note.append(span);
  }
  const hint = document.createElement("span");
  hint.textContent = "hover or tap a bar for the model split";
  refs.note.append(hint);
}

function renderSessions() {
  const sessions = snapshot.sessions ?? [];
  const unavailable = snapshot.dbAvailable === false;
  refs.sessions.hidden = unavailable;
  if (unavailable) return;

  const signature = sessions
    .map((session) => `${session.id}:${session.updatedAt}:${session.cost}:${agoText(session.updatedAt)}`)
    .join("|");
  if (signature === sessionsSignature) return;
  sessionsSignature = signature;

  if (!sessions.length) {
    refs.sessionList.replaceChildren();
    refs.sessionNote.textContent = "no OpenCode Go sessions in the local database yet";
    refs.sessionNote.hidden = false;
    return;
  }
  refs.sessionNote.hidden = true;

  refs.sessionList.innerHTML = sessions
    .map((session) => {
      const meta = [dirLabel(session.directory), agoText(session.updatedAt), session.agent]
        .filter(Boolean)
        .map((part) => `<span>${esc(part)}</span>`)
        .join("");
      const models = session.models
        .map(
          (model) => `
          <li class="session__model">
            <span class="swatch" style="--c-light:${esc(model.color.light)};--c-dark:${esc(model.color.dark)}"></span>
            <span class="session__model-name">${esc(model.name)}</span>
            <span class="session__model-cost">${esc(cost(model.cost))}</span>
          </li>`,
        )
        .join("");
      return `
        <li class="session">
          <div class="session__head">
            <p class="session__title" title="${esc(session.title)}">${esc(session.title)}</p>
            <p class="session__cost">${esc(cost(session.cost))}</p>
          </div>
          <p class="session__meta">${meta}</p>
          <ul class="session__models">${models}</ul>
        </li>`;
    })
    .join("");
}

function detailHTML(window_) {
  const rows = window_.segments
    .map((seg) => {
      const stats = seg.tokens
        ? [
            `${num.format(seg.runs)} requests`,
            `${tokens(seg.tokens.input)} input`,
            `${tokens(seg.tokens.output)} output`,
            `${tokens(seg.tokens.cacheRead)} cache read`,
          ]
        : ["usage from another device or client"];
      return `
        <li class="detail__row" data-model="${esc(seg.name)}">
          <span class="swatch" style="--c-light:${esc(seg.color.light)};--c-dark:${esc(seg.color.dark)}"></span>
          <span class="detail__name">${esc(seg.name)}</span>
          <span class="detail__spend">${esc(cost(seg.spend))}</span>
          <span class="detail__share">${Math.round(seg.share * 100)}%</span>
          <span class="detail__stats">${stats
            .map((stat) => `<span>${esc(stat)}</span>`)
            .join("")}</span>
        </li>`;
    })
    .join("");

  const headline =
    window_.percent == null
      ? `activity ${cost(window_.activitySpent)}`
      : `${Math.round(window_.percent)}% of ${usd.format(window_.limit)} plan`;

  return `
    <div class="detail__head">
      <span class="detail__window">${esc(window_.label)}</span>
      <span class="detail__total">${esc(headline)}</span>
    </div>
    <ul class="detail__rows">${rows}</ul>
    <div class="detail__foot">
      <span>${esc(resetText(window_.resetsAt))}</span>
      <span>activity ${esc(cost(window_.activitySpent))}</span>
    </div>`;
}

function showDetail(key, anchor) {
  clearTimeout(hideTimer);
  const window_ = snapshot?.windows[key];
  if (!window_) return;
  active = { key, anchor };
  refs.detail.innerHTML = detailHTML(window_);
  refs.detail.hidden = false;
  place(anchor);
  for (const row of refs.detail.querySelectorAll(".detail__row")) {
    row.addEventListener("mouseenter", () => highlight(key, row.dataset.model));
    row.addEventListener("mouseleave", () => highlight(key, null));
  }
  requestAnimationFrame(() => refs.detail.classList.add("is-open"));
}

function refreshDetail() {
  const window_ = snapshot?.windows[active.key];
  if (!window_) return;
  refs.detail.innerHTML = detailHTML(window_);
  place(active.anchor);
  for (const row of refs.detail.querySelectorAll(".detail__row")) {
    row.addEventListener("mouseenter", () => highlight(active.key, row.dataset.model));
    row.addEventListener("mouseleave", () => highlight(active.key, null));
  }
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideDetail, 140);
}

function hideDetail() {
  refs.detail.classList.remove("is-open");
  active = null;
  setTimeout(() => {
    if (!active) refs.detail.hidden = true;
  }, 180);
}

function place(anchor) {
  const box = anchor.getBoundingClientRect();
  const panel = refs.detail.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.min(
    Math.max(box.left, 12),
    Math.max(12, viewportWidth - panel.width - 12),
  );
  let top = box.bottom + 10;
  if (top + panel.height > viewportHeight - 12) top = box.top - panel.height - 10;
  if (top < 12) top = Math.min(box.bottom + 10, viewportHeight - panel.height - 12);
  refs.detail.style.left = `${left}px`;
  refs.detail.style.top = `${Math.max(12, top)}px`;
}

function highlight(key, model) {
  const ref = meters.get(key);
  if (!ref) return;
  for (const seg of ref.fill.children) {
    seg.classList.toggle("is-dim", model != null && seg.dataset.model !== model);
  }
  if (active?.key === key) {
    for (const row of refs.detail.querySelectorAll(".detail__row")) {
      row.classList.toggle("is-hot", model != null && row.dataset.model === model);
    }
  }
}

async function load() {
  lastLoad = Date.now();
  try {
    const response = await fetch("/api/usage", { cache: "no-store" });
    if (!response.ok) throw new Error(`request failed (${response.status})`);
    snapshot = await response.json();
    if (!meters.size) buildMeters();
    apply();
  } catch (error) {
    if (!snapshot) refs.note.textContent = `Usage service unreachable (${error.message}).`;
  }
}

function tick() {
  refs.clock.textContent = clockText();
  if (!snapshot) return;
  for (const key of WINDOW_ORDER) {
    const ref = meters.get(key);
    if (ref?.window) ref.reset.textContent = resetText(ref.window.resetsAt);
  }
  if (active) {
    const foot = refs.detail.querySelector(".detail__foot span");
    const window_ = snapshot.windows[active.key];
    if (foot && window_) foot.textContent = resetText(window_.resetsAt);
  }
  const resetPassed = Object.values(snapshot.windows).some(
    (window_) => window_.resetsAt && Date.parse(window_.resetsAt) <= Date.now(),
  );
  if (resetPassed || Date.now() - lastLoad >= REFRESH_MS) load();
}

refs.detail.addEventListener("mouseenter", () => clearTimeout(hideTimer));
refs.detail.addEventListener("mouseleave", scheduleHide);
window.addEventListener("resize", () => {
  if (active) place(active.anchor);
});
window.addEventListener("scroll", () => {
  if (active) place(active.anchor);
}, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastLoad >= REFRESH_MS) load();
});

refs.clock.textContent = clockText();
load();
setInterval(tick, 1000);
