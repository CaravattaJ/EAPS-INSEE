const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const SPORTS_CODES = ["93.11Z", "93.12Z", "93.13Z", "93.19Z", "85.51Z"];
const STORAGE_KEY = "veille-sports-21-state-v1";
const DECISIONS = ["À qualifier", "À contrôler", "Déjà connu", "Pas un lieu de pratique", "Hors périmètre"];

export function defaultSince(today = new Date()) {
  const date = new Date(today);
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

export function isAfter(date, since) {
  return Boolean(date) && date.slice(0, 10) >= since;
}

export function normalizeResult(result, establishment, code) {
  const siege = result.siege || {};
  const item = establishment || siege;
  const address = item.adresse || item;
  return {
    siret: String(item.siret || siege.siret || ""),
    siren: String(result.siren || ""),
    name: result.nom_complet || result.nom_raison_sociale || result.nom_commercial || "Nom non renseigné",
    commune: address.libelle_commune || item.libelle_commune || "Non renseignée",
    postalCode: address.code_postal || item.code_postal || "",
    activity: item.activite_principale || code,
    creationDate: item.date_creation || result.date_creation || "",
    association: Boolean(result.complements?.est_association),
    rna: result.identifiant_association || result.complements?.identifiant_association || "",
    priority: ["93.11Z", "93.12Z", "93.13Z", "93.19Z"].includes(item.activite_principale || code) ? "Élevée" : "Moyenne",
    decision: "À qualifier"
  };
}

export function extractItems(payload, code, since) {
  const items = [];
  for (const result of payload.results || []) {
    const matches = result.matching_etablissements?.length ? result.matching_etablissements : [result.siege];
    for (const establishment of matches.filter(Boolean)) {
      const normalized = normalizeResult(result, establishment, code);
      if (normalized.postalCode.startsWith("21") && isAfter(normalized.creationDate, since)) items.push(normalized);
    }
  }
  return items;
}

export function deduplicate(items) {
  return [...new Map(items.filter(item => item.siret).map(item => [item.siret, item])).values()];
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { items: [], lastSync: null };
  } catch {
    return { items: [], lastSync: null };
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function fetchCode(code, since) {
  const items = [];
  let page = 1;
  let pages = 1;
  do {
    const params = new URLSearchParams({ departement: "21", activite_principale: code, etat_administratif: "A", per_page: "25", page: String(page) });
    const response = await fetch(`${API_BASE}?${params}`);
    if (!response.ok) throw new Error(`La source a répondu ${response.status}`);
    const payload = await response.json();
    items.push(...extractItems(payload, code, since));
    pages = Math.min(Number(payload.total_pages || 1), 20);
    page += 1;
  } while (page <= pages);
  return items;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR").format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function render(state, query = "") {
  const filtered = state.items.filter(item => [item.name, item.commune, item.siret, item.rna, item.activity].join(" ").toLowerCase().includes(query.toLowerCase()));
  document.querySelector("#last-sync").textContent = state.lastSync ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.lastSync)) : "Jamais";
  document.querySelector("#new-count").textContent = state.items.length;
  document.querySelector("#pending-count").textContent = state.items.filter(item => item.decision === "À qualifier").length;
  document.querySelector("#empty-state").hidden = filtered.length > 0;
  document.querySelector("table").hidden = filtered.length === 0;
  document.querySelector("#results-body").innerHTML = filtered.map(item => `
    <tr>
      <td><span class="priority ${item.priority === "Élevée" ? "high" : "medium"}">${escapeHtml(item.priority)}</span></td>
      <td><span class="structure-name">${escapeHtml(item.name)}</span><span class="identifier">${item.association ? "Association · " : ""}SIRET ${escapeHtml(item.siret)}${item.rna ? ` · RNA ${escapeHtml(item.rna)}` : ""}</span></td>
      <td>${escapeHtml(item.commune)}<br><span class="identifier">${escapeHtml(item.postalCode)}</span></td>
      <td>${escapeHtml(item.activity)}</td>
      <td>${formatDate(item.creationDate)}</td>
      <td><select class="decision-select" data-siret="${escapeHtml(item.siret)}" aria-label="Décision pour ${escapeHtml(item.name)}">${DECISIONS.map(decision => `<option${decision === item.decision ? " selected" : ""}>${decision}</option>`).join("")}</select></td>
    </tr>`).join("");
}

function showMessage(text, error = false) {
  const message = document.querySelector("#message");
  message.textContent = text;
  message.classList.toggle("error", error);
  message.hidden = false;
}

function exportCsv(items) {
  const rows = [["Priorité", "Type", "Nom", "SIRET", "RNA", "Commune", "Code postal", "Activité", "Date de création", "Décision"], ...items.map(item => [item.priority, item.association ? "Association" : "Établissement", item.name, item.siret, item.rna, item.commune, item.postalCode, item.activity, item.creationDate, item.decision])];
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `veille-sports-21-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

if (typeof document !== "undefined") {
  const state = loadState();
  const sinceInput = document.querySelector("#since-input");
  sinceInput.value = state.lastSync ? new Date(new Date(state.lastSync).getTime() - 5 * 86400000).toISOString().slice(0, 10) : defaultSince();
  render(state);

  document.querySelector("#search-button").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Recherche en cours…";
    showMessage("Consultation des activités sportives en Côte-d'Or…");
    try {
      const batches = await Promise.all(SPORTS_CODES.map(code => fetchCode(code, sinceInput.value)));
      const previous = new Map(state.items.map(item => [item.siret, item]));
      state.items = deduplicate(batches.flat()).map(item => ({ ...item, decision: previous.get(item.siret)?.decision || item.decision }));
      state.lastSync = new Date().toISOString();
      saveState(state);
      render(state, document.querySelector("#filter-input").value);
      showMessage(`${state.items.length} structure(s) créée(s) depuis le ${formatDate(sinceInput.value)} ont été trouvées.`);
    } catch (error) {
      showMessage(`Recherche impossible : ${error.message}. Vérifiez l'accès réseau à recherche-entreprises.api.gouv.fr.`, true);
    } finally {
      button.disabled = false;
      button.innerHTML = '<span aria-hidden="true">↻</span> Rechercher les nouveautés';
    }
  });

  document.querySelector("#filter-input").addEventListener("input", event => render(state, event.target.value));
  document.querySelector("#results-body").addEventListener("change", event => {
    if (!event.target.matches(".decision-select")) return;
    const item = state.items.find(candidate => candidate.siret === event.target.dataset.siret);
    if (item) item.decision = event.target.value;
    saveState(state);
    render(state, document.querySelector("#filter-input").value);
  });
  document.querySelector("#export-button").addEventListener("click", () => state.items.length ? exportCsv(state.items) : showMessage("Aucun résultat à exporter.", true));
}
