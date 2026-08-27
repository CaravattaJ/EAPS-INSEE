const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const SPORTS_CODES = ["93.11Z", "93.12Z", "93.13Z", "93.19Z", "85.51Z"];
const STORAGE_KEY = "veille-sports-21-state-v1";
const DECISIONS = ["À qualifier", "À contrôler", "Déjà connu", "Pas un lieu de pratique", "Hors périmètre"];
const REQUEST_DELAY_MS = 900;
const MAX_RETRIES = 4;
const SPORT_KEYWORDS = [
  "sport", "football", "futsal", "rugby", "handball", "basket", "volley", "judo", "karate", "karaté",
  "aikido", "aïkido", "boxe", "gymnastique", "fitness", "musculation", "natation", "plongee", "plongée",
  "canoe", "canoë", "kayak", "aviron", "cyclisme", "vtt", "equitation", "équitation", "randonnee", "randonnée",
  "escalade", "athletisme", "athlétisme", "triathlon", "tennis", "badminton", "petanque", "pétanque", "escrime"
];

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function defaultSince(today = new Date()) {
  const date = new Date(today);
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

function isAfter(date, since) {
  return Boolean(date) && date.slice(0, 10) >= since;
}

function normalizeResult(result, establishment, code) {
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

function extractItems(payload, code, since) {
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

function deduplicate(items) {
  return [...new Map(items.filter(item => item.siret || item.rna).map(item => [item.siret || `rna:${item.rna}`, item])).values()];
}

function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function findSportKeywords(value) {
  const text = normalizeText(value);
  const found = new Map();
  for (const keyword of SPORT_KEYWORDS) {
    const normalized = normalizeText(keyword);
    if (!found.has(normalized) && new RegExp(`(^|[^a-z])${normalized}([^a-z]|$)`, "i").test(text)) found.set(normalized, keyword);
  }
  return [...found.values()];
}

function parseDelimited(text, delimiter = ";") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) { row.push(field); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function firstValue(record, names) {
  for (const name of names) if (record[name]) return record[name].trim();
  return "";
}

function normalizeRnaDate(value) {
  const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || "");
  if (french) return `${french[3]}-${french[2]}-${french[1]}`;
  return (value || "").slice(0, 10);
}

function extractRnaItems(text, since) {
  const delimiter = (text.split(/\r?\n/, 1)[0].match(/;/g) || []).length >= (text.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ";" : ",";
  const rows = parseDelimited(text.replace(/^\uFEFF/, ""), delimiter);
  if (rows.length < 2) throw new Error("Le fichier RNA est vide ou son format n'est pas reconnu");
  const headers = rows.shift().map(value => normalizeText(value.trim()));
  return deduplicate(rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))).map(record => {
    const title = firstValue(record, ["titre", "titre_court", "nom"]);
    const object = firstValue(record, ["objet", "objet_social", "objet_social1"]);
    const keywords = findSportKeywords(`${title} ${object}`);
    const creationDate = normalizeRnaDate(firstValue(record, ["date_creat", "date_creation", "date_decla", "date_declaration"]));
    const postalCode = firstValue(record, ["adrs_codepostal", "code_postal", "codepostal"]);
    const dissolution = firstValue(record, ["date_disso", "date_dissolution"]);
    if (!keywords.length || !postalCode.startsWith("21") || dissolution || (creationDate && !isAfter(creationDate, since))) return null;
    return {
      siret: firstValue(record, ["siret"]),
      siren: "",
      rna: firstValue(record, ["id", "rna", "numero_rna", "id_ex"]),
      name: title || "Association sans titre",
      commune: firstValue(record, ["adrs_libcommune", "libelle_commune", "commune"]) || "Non renseignée",
      postalCode,
      activity: "Objet associatif sportif",
      creationDate,
      association: true,
      object,
      reason: `Mot(s)-clé(s) : ${keywords.join(", ")}`,
      source: "RNA",
      priority: "Moyenne",
      decision: "À qualifier"
    };
  }).filter(item => item && (item.rna || item.siret)));
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

async function requestWithRetry(url, fetchImplementation = fetch, waitImplementation = wait) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetchImplementation(url);
    if (response.status !== 429) return response;
    if (attempt === MAX_RETRIES) break;

    const retryAfter = Number(response.headers?.get?.("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(2000 * (2 ** attempt), 30000);
    await waitImplementation(delay);
  }
  throw new Error("L'API limite temporairement les recherches (erreur 429). Attendez une minute puis réessayez");
}

async function fetchCode(code, since, onProgress = () => {}) {
  const items = [];
  let page = 1;
  let pages = 1;
  do {
    onProgress(code, page, pages);
    const params = new URLSearchParams({
      departement: "21",
      activite_principale: code,
      etat_administratif: "A",
      date_creation_min: since,
      per_page: "25",
      page: String(page)
    });
    const response = await requestWithRetry(`${API_BASE}?${params}`);
    if (!response.ok) throw new Error(`La source a répondu ${response.status}`);
    const payload = await response.json();
    items.push(...extractItems(payload, code, since));
    pages = Math.min(Number(payload.total_pages || 1), 20);
    page += 1;
    if (page <= pages) await wait(REQUEST_DELAY_MS);
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
      <td><span class="structure-name">${escapeHtml(item.name)}</span><span class="identifier">${item.source === "RNA" ? "Source RNA" : item.association ? "Association" : "Établissement"}${item.siret ? ` · SIRET ${escapeHtml(item.siret)}` : ""}${item.rna ? ` · RNA ${escapeHtml(item.rna)}` : ""}</span>${item.reason ? `<br><span class="identifier">${escapeHtml(item.reason)}</span>` : ""}</td>
      <td>${escapeHtml(item.commune)}<br><span class="identifier">${escapeHtml(item.postalCode)}</span></td>
      <td>${escapeHtml(item.activity)}</td>
      <td>${formatDate(item.creationDate)}</td>
      <td><select class="decision-select" data-key="${escapeHtml(item.siret || `rna:${item.rna}`)}" aria-label="Décision pour ${escapeHtml(item.name)}">${DECISIONS.map(decision => `<option${decision === item.decision ? " selected" : ""}>${decision}</option>`).join("")}</select></td>
    </tr>`).join("");
}

function showMessage(text, error = false) {
  const message = document.querySelector("#message");
  message.textContent = text;
  message.classList.toggle("error", error);
  message.hidden = false;
}

function exportCsv(items) {
  const rows = [["Niveau de confiance", "Source", "Type", "Nom", "SIRET", "RNA", "Commune", "Code postal", "Activité", "Motif", "Date de création", "Décision"], ...items.map(item => [item.priority, item.source || "Sirene", item.association ? "Association" : "Établissement", item.name, item.siret, item.rna, item.commune, item.postalCode, item.activity, item.reason || "", item.creationDate, item.decision])];
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `veille-sports-21-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Expose uniquement les fonctions pures nécessaires aux tests. L'utilisation de
// globalThis conserve un script classique compatible avec une ouverture file://,
// tout en permettant aux tests Node.js de vérifier la logique sans la dupliquer.
Object.assign(globalThis, {
  veilleSportsTestApi: { defaultSince, isAfter, normalizeResult, extractItems, deduplicate, requestWithRetry, parseDelimited, findSportKeywords, extractRnaItems }
});

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
      const batches = [];
      for (const [index, code] of SPORTS_CODES.entries()) {
        button.textContent = `Recherche ${index + 1}/${SPORTS_CODES.length} — ${code}…`;
        batches.push(await fetchCode(code, sinceInput.value, (_activity, page, pages) => {
          if (pages > 1) button.textContent = `Recherche ${index + 1}/${SPORTS_CODES.length} — ${code}, page ${page}/${pages}…`;
        }));
        if (index < SPORTS_CODES.length - 1) await wait(REQUEST_DELAY_MS);
      }
      const previous = new Map(state.items.map(item => [item.siret || `rna:${item.rna}`, item]));
      const existingRna = state.items.filter(item => item.source === "RNA");
      state.items = deduplicate([...batches.flat(), ...existingRna]).map(item => ({ ...item, decision: previous.get(item.siret || `rna:${item.rna}`)?.decision || item.decision }));
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
  document.querySelector("#rna-button").addEventListener("click", () => document.querySelector("#rna-input").click());
  document.querySelector("#rna-input").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    showMessage(`Analyse du fichier RNA « ${file.name} »…`);
    try {
      const imported = extractRnaItems(await file.text(), sinceInput.value);
      const previous = new Map(state.items.map(item => [item.siret || `rna:${item.rna}`, item]));
      state.items = deduplicate([...state.items, ...imported]).map(item => ({ ...item, decision: previous.get(item.siret || `rna:${item.rna}`)?.decision || item.decision }));
      saveState(state);
      render(state, document.querySelector("#filter-input").value);
      showMessage(`${imported.length} association(s) sportive(s) candidate(s) ont été trouvées dans le fichier RNA.`);
    } catch (error) {
      showMessage(`Import RNA impossible : ${error.message}.`, true);
    } finally {
      event.target.value = "";
    }
  });
  document.querySelector("#results-body").addEventListener("change", event => {
    if (!event.target.matches(".decision-select")) return;
    const item = state.items.find(candidate => (candidate.siret || `rna:${candidate.rna}`) === event.target.dataset.key);
    if (item) item.decision = event.target.value;
    saveState(state);
    render(state, document.querySelector("#filter-input").value);
  });
  document.querySelector("#export-button").addEventListener("click", () => state.items.length ? exportCsv(state.items) : showMessage("Aucun résultat à exporter.", true));
}
