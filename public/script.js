"use strict";

/* ===== Data ===== */
const labels = { home: "Home", study: "Study", health: "Health", shopping: "Shopping" };

const OFFLINE_MSG =
  'Cannot reach the server. Start it with "npm start" and open http://localhost:3000';

/* ===== State =====
   Project 1 kept the tasks in the browser (localStorage).
   Project 2 keeps them on the server: the page asks the API for them. */
const state = {
  tasks: [],
  filter: "all",
  theme: "light",
  loading: true,
};

/* Only the colour theme is still saved in the browser (it is a personal display setting) */
function loadTheme() {
  try {
    const saved = localStorage.getItem("dailynest-theme");
    if (saved === "dark" || saved === "light") state.theme = saved;
  } catch (e) { /* ignore */ }
}
function saveTheme() {
  try {
    localStorage.setItem("dailynest-theme", state.theme);
  } catch (e) { /* ignore */ }
}

/* ===== Elements ===== */
const grid = document.getElementById("taskGrid");
const emptyMsg = document.getElementById("emptyMsg");
const chips = document.querySelectorAll(".chip");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const navToggle = document.getElementById("navToggle");
const siteNav = document.getElementById("siteNav");
const themeToggle = document.getElementById("themeToggle");
const clearDoneBtn = document.getElementById("clearDoneBtn");
const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskCategory = document.getElementById("taskCategory");
const addBtn = taskForm.querySelector('button[type="submit"]');
const formMsg = document.getElementById("formMsg");
const todayDate = document.getElementById("todayDate");

/* ===== Talking to the API ===== */
// One helper for every request. It returns the JSON answer, or throws an Error
// with a friendly message (taken from the server's error response).
async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(OFFLINE_MSG); // network problem or server is not running
  }

  if (res.status === 204) return null; // success with no body (DELETE)

  let payload = null;
  try { payload = await res.json(); } catch (e) { /* not JSON */ }

  if (!res.ok) {
    const problem = payload && payload.error;
    let message = problem ? problem.message : `Request failed (${res.status})`;
    if (problem && Array.isArray(problem.details) && problem.details.length) {
      message = problem.details.map(d => d.message).join(". ");
    }
    throw new Error(message);
  }
  return payload;
}

function showMessage(text) {
  formMsg.textContent = text;
}

// Ask the server for the tasks (respecting the filter) and for the progress numbers
async function refresh() {
  const params = new URLSearchParams({ limit: "200" });
  if (state.filter !== "all") params.set("category", state.filter);

  const [tasks, stats] = await Promise.all([
    api("GET", "/api/tasks?" + params.toString()),
    api("GET", "/api/stats"),
  ]);
  state.tasks = tasks.data;
  state.loading = false;
  render();
  updateProgress(stats.data);
}

/* ===== Render ===== */
function render() {
  grid.innerHTML = "";

  state.tasks.forEach(t => {
    const card = document.createElement("article");
    card.className = "card" + (t.done ? " is-done" : "");

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = labels[t.category];

    const title = document.createElement("h3");
    title.textContent = t.text; // textContent keeps user text safe

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const doneBtn = document.createElement("button");
    doneBtn.className = "btn";
    doneBtn.dataset.action = "toggle";
    doneBtn.dataset.id = t.id;
    doneBtn.setAttribute("aria-pressed", t.done);
    doneBtn.textContent = t.done ? "✓ Done" : "Mark done";

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger";
    delBtn.dataset.action = "delete";
    delBtn.dataset.id = t.id;
    delBtn.setAttribute("aria-label", "Delete task: " + t.text);
    delBtn.textContent = "Delete";

    actions.append(doneBtn, delBtn);
    card.append(tag, title, actions);
    grid.appendChild(card);
  });

  emptyMsg.textContent = state.loading
    ? "Loading your tasks..."
    : "No tasks here yet. Add your first one above!";
  emptyMsg.hidden = !state.loading && state.tasks.length > 0;
}

// The numbers now come from GET /api/stats (worked out on the server)
function updateProgress(stats) {
  progressText.textContent = `${stats.done} of ${stats.total} tasks done (${stats.percent}%)`;
  progressFill.style.width = stats.percent + "%";
  progressBar.setAttribute("aria-valuenow", stats.percent);
}

/* ===== Events ===== */
taskForm.addEventListener("submit", async e => {
  e.preventDefault();
  const text = taskInput.value.trim();
  if (!text) {
    showMessage("Please type a task before adding it.");
    taskInput.focus();
    return;
  }

  addBtn.disabled = true; // stop double clicks while the request is running
  try {
    await api("POST", "/api/tasks", { text, category: taskCategory.value });
    taskInput.value = "";
    showMessage("");
    await refresh();
  } catch (err) {
    showMessage(err.message); // e.g. the server's validation message
  } finally {
    addBtn.disabled = false;
    taskInput.focus();
  }
});

grid.addEventListener("click", async e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  const id = Number(btn.dataset.id);
  btn.disabled = true;

  try {
    if (btn.dataset.action === "toggle") {
      const task = state.tasks.find(t => t.id === id);
      if (!task) return;
      await api("PATCH", `/api/tasks/${id}`, { done: !task.done });
      await refresh();
      // Keep keyboard focus on the same button after re-render
      const again = grid.querySelector(`button[data-action="toggle"][data-id="${id}"]`);
      if (again) again.focus();
    } else if (btn.dataset.action === "delete") {
      await api("DELETE", `/api/tasks/${id}`);
      await refresh();
    }
    showMessage("");
  } catch (err) {
    showMessage(err.message);
    btn.disabled = false;
    refresh().catch(() => {}); // the list may be out of date (e.g. task already deleted)
  }
});

chips.forEach(chip => {
  chip.addEventListener("click", async () => {
    state.filter = chip.dataset.filter;
    chips.forEach(c => {
      const active = c === chip;
      c.classList.toggle("is-active", active);
      c.setAttribute("aria-pressed", active);
    });
    try {
      await refresh();
      showMessage("");
    } catch (err) {
      showMessage(err.message);
    }
  });
});

clearDoneBtn.addEventListener("click", async () => {
  clearDoneBtn.disabled = true;
  try {
    await api("DELETE", "/api/tasks?done=true");
    showMessage("");
    await refresh();
  } catch (err) {
    showMessage(err.message);
  } finally {
    clearDoneBtn.disabled = false;
  }
});

navToggle.addEventListener("click", () => {
  const open = siteNav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", open);
});
siteNav.addEventListener("click", e => {
  if (e.target.tagName === "A") {
    siteNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    siteNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }
});

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const dark = state.theme === "dark";
  themeToggle.textContent = dark ? "Light mode" : "Dark mode";
  themeToggle.setAttribute("aria-pressed", dark);
}
themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();
  saveTheme();
});

/* ===== Init ===== */
todayDate.textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long", year: "numeric", month: "long", day: "numeric",
});
loadTheme();
applyTheme();
render(); // shows "Loading your tasks..." until the server answers
refresh().catch(err => {
  state.loading = false;
  render();
  showMessage(err.message);
});
