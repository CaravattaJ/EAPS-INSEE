const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const SPORTS_CODES = ["93.11Z", "93.12Z", "93.13Z", "93.19Z", "85.51Z", "93.29Z"];
const HIGH_PRIORITY_CODES = ["93.11Z", "93.12Z", "93.13Z", "93.19Z"];
const MEDIUM_PRIORITY_CODES = ["85.51Z"];
const STORAGE_KEY = "veille-sports-21-state-v1";
const REQUEST_DELAY_MS = 900;
const MAX_RETRIES = 4;
const MAX_API_PAGES = 20;
const RECOVERY_DAYS = 15;
const STALE_SYNC_DAYS = 10;
const WIDE_RANGE_WARNING_DAYS = 90;
const WALDEC_SPORT_PREFIX = "011";
const COMPLEMENTARY_KEYWORD = "sport";
const JOAFE_API_BASE = "https://journal-officiel-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/jo_associations/records";
const JOAFE_PAGE_SIZE = 100;
const JOAFE_SPORT_FAMILY_PREFIX = "11000/";
const BAN_API_BASE = "https://api-adresse.data.gouv.fr/search/";
const PAGE_SIZE = 25;
const DEPARTMENTS = [
  { code: "21", label: "Côte-d'Or" },
  { code: "25", label: "Doubs" },
  { code: "39", label: "Jura" },
  { code: "58", label: "Nièvre" },
  { code: "70", label: "Haute-Saône" },
  { code: "71", label: "Saône-et-Loire" },
  { code: "89", label: "Yonne" },
  { code: "90", label: "Territoire de Belfort" }
];
const DEFAULT_DEPARTMENTS = ["21"];
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

function daysSince(dateIso) {
  if (!dateIso) return Infinity;
  return (Date.now() - new Date(dateIso).getTime()) / 86400000;
}

function priorityForCode(code) {
  if (HIGH_PRIORITY_CODES.includes(code)) return "Élevée";
  if (MEDIUM_PRIORITY_CODES.includes(code)) return "Moyenne";
  return "Faible";
}

function isInDepartments(postalCode, departments = DEFAULT_DEPARTMENTS) {
  return departments.some(code => postalCode.startsWith(code));
}

function departmentsLabel(departments = DEFAULT_DEPARTMENTS) {
  const labels = departments.map(code => DEPARTMENTS.find(department => department.code === code)?.label || code);
  return labels.length <= 2 ? labels.join(" et ") : `${labels.length} départements sélectionnés`;
}

function toCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
    priority: priorityForCode(item.activite_principale || code),
    lat: toCoordinate(item.latitude),
    lon: toCoordinate(item.longitude)
  };
}

function extractItems(payload, code, since, departments = DEFAULT_DEPARTMENTS) {
  const items = [];
  for (const result of payload.results || []) {
    const matches = result.matching_etablissements?.length ? result.matching_etablissements : [result.siege];
    for (const establishment of matches.filter(Boolean)) {
      const normalized = normalizeResult(result, establishment, code);
      if (isInDepartments(normalized.postalCode, departments) && isAfter(normalized.creationDate, since)) items.push(normalized);
    }
  }
  return items;
}

function markKeywordFallback(item) {
  if (SPORTS_CODES.includes(item.activity)) return item;
  return { ...item, priority: "Faible", reason: `Nom évoquant le sport, activité déclarée non sportive : ${item.activity}` };
}

function deduplicate(items) {
  return [...new Map(items.filter(item => item.siret || item.rna).map(item => [item.siret || `rna:${item.rna}`, item])).values()];
}

function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
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

function duplicateKey(item) {
  return `${normalizeText(item.name)}|${item.postalCode}`;
}

function isAssociationSource(item) {
  return item.source === "RNA" || item.source === "JOAFE";
}

function flagProbableDuplicates(items) {
  const sireneAssociations = items.filter(item => !isAssociationSource(item) && item.association && item.siret);
  const sireneByKey = new Map(sireneAssociations.map(item => [duplicateKey(item), item]));
  return items.map(item => {
    if (!isAssociationSource(item)) {
      const { possibleDuplicateOf, ...rest } = item;
      return rest;
    }
    const match = sireneByKey.get(duplicateKey(item));
    if (!match || match.siret === item.siret) {
      const { possibleDuplicateOf, ...rest } = item;
      return rest;
    }
    return { ...item, possibleDuplicateOf: `${match.name} — SIRET ${match.siret}` };
  });
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
  const isoDate = french ? `${french[3]}-${french[2]}-${french[1]}` : (value || "").slice(0, 10);
  // Le fichier "rna_import" utilise 0001-01-01 comme valeur par défaut quand la date est inconnue :
  // on la traite comme une date manquante plutôt que comme une exclusion injustifiée.
  return isoDate === "0001-01-01" ? "" : isoDate;
}

const RNA_POSTAL_CODE_HEADERS = ["adrs_codepostal", "code_postal", "codepostal"];
const RNA_TITLE_HEADERS = ["titre", "titre_court", "nom"];

function extractRnaItems(text, since, departments = DEFAULT_DEPARTMENTS) {
  const delimiter = (text.split(/\r?\n/, 1)[0].match(/;/g) || []).length >= (text.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ";" : ",";
  const rows = parseDelimited(text.replace(/^﻿/, ""), delimiter);
  if (rows.length < 2) throw new Error("Le fichier RNA est vide ou son format n'est pas reconnu");
  const headers = rows.shift().map(value => normalizeText(value.trim()));
  if (!headers.some(header => RNA_POSTAL_CODE_HEADERS.includes(header)) || !headers.some(header => RNA_TITLE_HEADERS.includes(header))) {
    throw new Error(`Les colonnes attendues (code postal, titre...) n'ont pas été reconnues dans ce fichier. Colonnes trouvées : ${headers.join(", ") || "aucune"}. Vérifiez qu'il s'agit bien d'un export RNA officiel (fichier « waldec » ou « import »)`);
  }
  return deduplicate(rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))).map(record => {
    const title = firstValue(record, RNA_TITLE_HEADERS);
    const object = firstValue(record, ["objet", "objet_social"]);
    const waldecCodes = [firstValue(record, ["objet_social1"]), firstValue(record, ["objet_social2"])].filter(Boolean);
    const sportWaldecCode = waldecCodes.find(code => code.startsWith(WALDEC_SPORT_PREFIX));
    const keywords = findSportKeywords(`${title} ${object}`);
    // "date_decla" est la date de la DERNIÈRE déclaration (ex. changement de bureau, d'adresse) : une
    // vieille association peut avoir une date_decla très récente sans être nouvelle. On ne l'utilise
    // donc jamais comme date de création, y compris en repli — seul "date_publi" (date de publication
    // au Journal officiel de l'avis de création) est un repli légitime quand "date_creat" est absent.
    const creationDate = normalizeRnaDate(firstValue(record, ["date_creat", "date_creation", "date_publi", "date_publication"]));
    const postalCode = firstValue(record, RNA_POSTAL_CODE_HEADERS);
    const dissolution = firstValue(record, ["date_disso", "date_dissolution"]);
    if (!isInDepartments(postalCode, departments) || dissolution || (creationDate && !isAfter(creationDate, since))) return null;
    const priority = sportWaldecCode ? "Élevée" : keywords.length ? "Moyenne" : "Faible";
    const reason = sportWaldecCode
      ? `Objet social sportif déclaré (code ${sportWaldecCode})`
      : keywords.length
        ? `Mot(s)-clé(s) : ${keywords.join(", ")}`
        : "Aucun indice sportif détecté dans l'objet déclaré, à vérifier";
    return {
      siret: firstValue(record, ["siret"]),
      siren: "",
      rna: firstValue(record, ["id", "rna", "numero_rna", "id_ex"]),
      name: title || "Association sans titre",
      commune: firstValue(record, ["adrs_libcommune", "libelle_commune", "libcom", "commune"]) || "Non renseignée",
      postalCode,
      activity: "Objet associatif",
      creationDate,
      association: true,
      object,
      reason,
      source: "RNA",
      priority,
      lat: null,
      lon: null
    };
  }).filter(item => item && (item.rna || item.siret)));
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { items: [], lastSync: null, lastRnaImport: null };
  } catch {
    return { items: [], lastSync: null, lastRnaImport: null };
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

async function fetchByParams(extraParams, since, departments = DEFAULT_DEPARTMENTS, onProgress = () => {}) {
  const items = [];
  let page = 1;
  let pages = 1;
  do {
    onProgress(page, pages);
    const params = new URLSearchParams({
      departement: departments.join(","),
      etat_administratif: "A",
      date_creation_min: since,
      per_page: "25",
      page: String(page),
      ...extraParams
    });
    const response = await requestWithRetry(`${API_BASE}?${params}`);
    if (!response.ok) throw new Error(`La source a répondu ${response.status}`);
    const payload = await response.json();
    items.push(...extractItems(payload, extraParams.activite_principale || "", since, departments));
    pages = Math.min(Number(payload.total_pages || 1), MAX_API_PAGES);
    page += 1;
    if (page <= pages) await wait(REQUEST_DELAY_MS);
  } while (page <= pages);
  return { items, truncated: pages >= MAX_API_PAGES };
}

function fetchCode(code, since, departments, onProgress = () => {}) {
  return fetchByParams({ activite_principale: code }, since, departments, (page, pages) => onProgress(code, page, pages));
}

function fetchKeyword(keyword, since, departments, onProgress = () => {}) {
  return fetchByParams({ q: keyword }, since, departments, onProgress);
}

function normalizeJoafeRecord(record) {
  const codes = record.domaine_activite_categorise || [];
  const sportCode = codes.find(code => code.startsWith(JOAFE_SPORT_FAMILY_PREFIX));
  const keywords = findSportKeywords(`${record.titre || ""} ${record.objet || ""}`);
  const priority = sportCode ? "Élevée" : keywords.length ? "Moyenne" : "Faible";
  const reason = sportCode
    ? `Activité sportive déclarée au Journal officiel (${sportCode})`
    : keywords.length
      ? `Mot(s)-clé(s) : ${keywords.join(", ")}`
      : "Aucun indice sportif détecté dans l'objet déclaré, à vérifier";
  // Le champ geo_point de l'API Journal officiel (v2.1) est un objet { lon, lat }, pas un tableau.
  const lat = record.geo_point?.lat;
  const lon = record.geo_point?.lon;
  return {
    siret: "",
    siren: "",
    rna: record.numero_rna || "",
    name: record.titre || "Association sans titre",
    commune: record.commune_actuelle || "Non renseignée",
    postalCode: record.codepostal_actuel || "",
    activity: "Association (Journal officiel)",
    creationDate: (record.dateparution || record.datedeclaration || "").slice(0, 10),
    association: true,
    object: record.objet || "",
    reason,
    source: "JOAFE",
    priority,
    lat: toCoordinate(lat),
    lon: toCoordinate(lon)
  };
}

function joafeWhereClause(since, departments = DEFAULT_DEPARTMENTS) {
  const departmentList = departments.map(code => `"${code}"`).join(",");
  return `departement_code in (${departmentList}) and typeavis="Création" and dateparution>="${since}"`;
}

async function fetchJoafe(since, departments = DEFAULT_DEPARTMENTS, onProgress = () => {}) {
  const items = [];
  let offset = 0;
  let total = Infinity;
  let page = 0;
  do {
    page += 1;
    onProgress(page);
    const params = new URLSearchParams({
      where: joafeWhereClause(since, departments),
      order_by: "dateparution desc",
      limit: String(JOAFE_PAGE_SIZE),
      offset: String(offset)
    });
    const response = await requestWithRetry(`${JOAFE_API_BASE}?${params}`);
    if (!response.ok) throw new Error(`La source Journal officiel a répondu ${response.status}`);
    const payload = await response.json();
    total = Number(payload.total_count || 0);
    for (const record of payload.results || []) {
      const item = normalizeJoafeRecord(record);
      if (isInDepartments(item.postalCode, departments)) items.push(item);
    }
    offset += JOAFE_PAGE_SIZE;
    if (offset < total) await wait(REQUEST_DELAY_MS);
  } while (offset < total && offset < JOAFE_PAGE_SIZE * MAX_API_PAGES);
  return { items, truncated: offset < total };
}

async function geocodeCommune(commune, postalCode, fetchImplementation = fetch) {
  const params = new URLSearchParams({ q: commune, postcode: postalCode, type: "municipality", limit: "1" });
  const response = await fetchImplementation(`${BAN_API_BASE}?${params}`);
  if (!response.ok) return null;
  const payload = await response.json();
  const feature = payload.features?.[0];
  if (!feature) return null;
  const [lon, lat] = feature.geometry.coordinates;
  return { lat: toCoordinate(lat), lon: toCoordinate(lon) };
}

function paginate(items, page, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), currentPage, totalPages, total: items.length };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR").format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function priorityClass(priority) {
  if (priority === "Élevée") return "high";
  if (priority === "Moyenne") return "medium";
  return "low";
}

function isFutureDate(value) {
  if (!value) return false;
  return value.slice(0, 10) > new Date().toISOString().slice(0, 10);
}

const PRIORITY_ORDER = { "Élevée": 3, "Moyenne": 2, "Faible": 1 };

function sortItems(items, column, direction = "asc") {
  if (!column) return items;
  const factor = direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = column === "priority" ? (PRIORITY_ORDER[a.priority] || 0) : String(a[column] ?? "").toLowerCase();
    const bv = column === "priority" ? (PRIORITY_ORDER[b.priority] || 0) : String(b[column] ?? "").toLowerCase();
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}

function render(state, query = "", options = {}) {
  const { hideLow = false, sortColumn = null, sortDirection = "asc", page = 1, pageSize = PAGE_SIZE } = options;
  let filtered = state.items.filter(item => [item.name, item.commune, item.siret, item.rna, item.activity].join(" ").toLowerCase().includes(query.toLowerCase()));
  if (hideLow) filtered = filtered.filter(item => item.priority !== "Faible");
  filtered = sortItems(filtered, sortColumn, sortDirection);
  const { pageItems, currentPage, totalPages, total } = paginate(filtered, page, pageSize);
  document.querySelector("#last-sync").textContent = state.lastSync ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.lastSync)) : "Jamais";
  document.querySelector("#new-count").textContent = state.items.length;
  document.querySelector("#pending-count").textContent = state.items.filter(item => item.priority === "Faible").length;
  document.querySelector("#empty-state").hidden = filtered.length > 0;
  document.querySelector("table").hidden = filtered.length === 0;
  const staleSyncWarning = document.querySelector("#stale-sync-warning");
  if (staleSyncWarning) staleSyncWarning.hidden = daysSince(state.lastSync) <= STALE_SYNC_DAYS;
  const staleRnaWarning = document.querySelector("#stale-rna-warning");
  if (staleRnaWarning) staleRnaWarning.hidden = daysSince(state.lastRnaImport) <= STALE_SYNC_DAYS;
  document.querySelectorAll(".sort-button").forEach(button => {
    button.classList.toggle("sort-active", button.dataset.sort === sortColumn);
    button.dataset.sortDirection = button.dataset.sort === sortColumn ? sortDirection : "";
  });
  const pageIndicator = document.querySelector("#page-indicator");
  if (pageIndicator) pageIndicator.textContent = total === 0 ? "" : `Page ${currentPage} / ${totalPages} (${total} résultat(s))`;
  const prevButton = document.querySelector("#prev-page-button");
  if (prevButton) prevButton.disabled = currentPage <= 1;
  const nextButton = document.querySelector("#next-page-button");
  if (nextButton) nextButton.disabled = currentPage >= totalPages;
  document.querySelector("#results-body").innerHTML = pageItems.map(item => `
    <tr>
      <td><span class="priority ${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span></td>
      <td><span class="structure-name">${escapeHtml(item.name)}</span><span class="identifier">${item.source === "RNA" ? "Association (fichier RNA)" : item.source === "JOAFE" ? "Association (Journal officiel)" : item.association ? "Association" : "Établissement"}${item.siret ? ` · SIRET ${escapeHtml(item.siret)}` : ""}${item.rna ? ` · RNA ${escapeHtml(item.rna)}` : ""}</span>${item.reason ? `<br><span class="identifier">${escapeHtml(item.reason)}</span>` : ""}${item.possibleDuplicateOf ? `<br><span class="duplicate-flag">⚠ Peut-être déjà vue ailleurs — voir aussi ${escapeHtml(item.possibleDuplicateOf)}</span>` : ""}</td>
      <td>${escapeHtml(item.commune)}<br><span class="identifier">${escapeHtml(item.postalCode)}</span></td>
      <td>${escapeHtml(item.activity)}</td>
      <td>${formatDate(item.creationDate)}${isFutureDate(item.creationDate) ? '<br><span class="future-flag">Date à venir — pas encore en activité</span>' : ""}</td>
    </tr>`).join("");
  return { currentPage, mapItems: filtered };
}

function showMessage(text, error = false) {
  const message = document.querySelector("#message");
  message.textContent = text;
  message.classList.toggle("error", error);
  message.hidden = false;
}

function timestampForFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
}

function exportCsv(items) {
  const rows = [["Niveau de confiance", "Source", "Type", "Nom", "SIRET", "RNA", "Commune", "Code postal", "Activité", "Motif", "Date de création"], ...items.map(item => [item.priority, item.source || "Sirene", item.association ? "Association" : "Établissement", item.name, item.siret, item.rna, item.commune, item.postalCode, item.activity, item.reason || "", item.creationDate])];
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `veille-sports-21-historique-${timestampForFilename()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Expose uniquement les fonctions pures nécessaires aux tests. L'utilisation de
// globalThis conserve un script classique compatible avec une ouverture file://,
// tout en permettant aux tests Node.js de vérifier la logique sans la dupliquer.
Object.assign(globalThis, {
  veilleSportsTestApi: { defaultSince, isAfter, normalizeResult, extractItems, deduplicate, requestWithRetry, parseDelimited, findSportKeywords, extractRnaItems, priorityForCode, flagProbableDuplicates, markKeywordFallback, daysSince, isFutureDate, normalizeJoafeRecord, sortItems, isInDepartments, departmentsLabel, paginate, joafeWhereClause, geocodeCommune, DEPARTMENTS }
});

function readSelectedDepartments(select) {
  const values = Array.from(select.selectedOptions).map(option => option.value);
  return values.length ? values : DEFAULT_DEPARTMENTS;
}

const PRIORITY_MAP_COLORS = { "Élevée": "#b42318", "Moyenne": "#9a6700", "Faible": "#667085" };

if (typeof document !== "undefined") {
  const state = loadState();
  const sinceInput = document.querySelector("#since-input");
  const filterInput = document.querySelector("#filter-input");
  const hideLowInput = document.querySelector("#hide-low-input");
  const departmentSelect = document.querySelector("#department-select");
  const prevPageButton = document.querySelector("#prev-page-button");
  const nextPageButton = document.querySelector("#next-page-button");
  let sortColumn = null;
  let sortDirection = "asc";
  let page = 1;

  let map = null;
  let markerLayer = null;
  if (typeof L !== "undefined" && document.querySelector("#map")) {
    map = L.map("map").setView([47.05, 4.85], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 18
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }

  function updateMap(items) {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    for (const item of items) {
      if (typeof item.lat !== "number" || typeof item.lon !== "number") continue;
      L.circleMarker([item.lat, item.lon], {
        radius: 7,
        color: PRIORITY_MAP_COLORS[item.priority] || PRIORITY_MAP_COLORS["Faible"],
        weight: 2,
        fillOpacity: 0.75
      })
        .bindPopup(`<strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(item.commune)} (${escapeHtml(item.postalCode)})<br>${escapeHtml(item.activity)}<br>Créée le ${formatDate(item.creationDate)}`)
        .addTo(markerLayer);
    }
  }

  const renderNow = () => {
    const { currentPage, mapItems } = render(state, filterInput.value, { hideLow: hideLowInput.checked, sortColumn, sortDirection, page });
    page = currentPage;
    updateMap(mapItems);
  };

  if (Array.isArray(state.departments) && state.departments.length) {
    Array.from(departmentSelect.options).forEach(option => { option.selected = state.departments.includes(option.value); });
  }

  sinceInput.value = state.lastSync ? new Date(new Date(state.lastSync).getTime() - RECOVERY_DAYS * 86400000).toISOString().slice(0, 10) : defaultSince();
  renderNow();

  hideLowInput.addEventListener("change", () => { page = 1; renderNow(); });
  filterInput.addEventListener("input", () => { page = 1; renderNow(); });
  departmentSelect.addEventListener("change", () => {
    state.departments = readSelectedDepartments(departmentSelect);
    saveState(state);
  });
  prevPageButton.addEventListener("click", () => { page -= 1; renderNow(); });
  nextPageButton.addEventListener("click", () => { page += 1; renderNow(); });
  document.querySelectorAll(".sort-button").forEach(button => {
    button.addEventListener("click", () => {
      const column = button.dataset.sort;
      sortDirection = sortColumn === column && sortDirection === "asc" ? "desc" : "asc";
      sortColumn = column;
      page = 1;
      renderNow();
    });
  });

  sinceInput.addEventListener("change", () => {
    const chosen = new Date(`${sinceInput.value}T12:00:00`);
    if (Number.isNaN(chosen.getTime())) return;
    const daysAgo = (Date.now() - chosen.getTime()) / 86400000;
    if (daysAgo > WIDE_RANGE_WARNING_DAYS) {
      showMessage("Vous avez choisi une date assez ancienne. Sur une aussi longue période, le site des entreprises peut ne pas renvoyer tous les résultats. Si la liste semble incomplète, refaites une recherche sur une période plus courte.");
    }
  });

  document.querySelector("#search-button").addEventListener("click", async event => {
    const button = event.currentTarget;
    const departments = readSelectedDepartments(departmentSelect);
    button.disabled = true;
    button.textContent = "Recherche en cours…";
    showMessage(`Consultation des activités sportives en ${departmentsLabel(departments)}…`);
    try {
      const totalSteps = SPORTS_CODES.length + 2;
      const batches = [];
      let incompleteCount = 0;
      for (const [index, code] of SPORTS_CODES.entries()) {
        button.textContent = `Recherche ${index + 1}/${totalSteps} — ${code}…`;
        const { items, truncated } = await fetchCode(code, sinceInput.value, departments, (_code, page, pages) => {
          if (pages > 1) button.textContent = `Recherche ${index + 1}/${totalSteps} — ${code}, page ${page}/${pages}…`;
        });
        batches.push(items);
        if (truncated) incompleteCount += 1;
        await wait(REQUEST_DELAY_MS);
      }
      button.textContent = `Recherche ${SPORTS_CODES.length + 1}/${totalSteps} — noms évoquant le sport…`;
      const { items: keywordItems, truncated: keywordTruncated } = await fetchKeyword(COMPLEMENTARY_KEYWORD, sinceInput.value, departments, (page, pages) => {
        if (pages > 1) button.textContent = `Recherche ${SPORTS_CODES.length + 1}/${totalSteps} — noms évoquant le sport, page ${page}/${pages}…`;
      });
      if (keywordTruncated) incompleteCount += 1;
      const keywordBatch = keywordItems.map(markKeywordFallback);
      await wait(REQUEST_DELAY_MS);

      button.textContent = `Recherche ${totalSteps}/${totalSteps} — associations publiées au Journal officiel…`;
      const { items: joafeItems, truncated: joafeTruncated } = await fetchJoafe(sinceInput.value, departments, page => {
        if (page > 1) button.textContent = `Recherche ${totalSteps}/${totalSteps} — Journal officiel, page ${page}…`;
      });
      if (joafeTruncated) incompleteCount += 1;

      // Les anciens résultats sont mis en premier : ils sont conservés même si la nouvelle recherche
      // porte sur une période plus courte, et les nouveaux résultats (mêmes clé) les mettent à jour.
      state.items = flagProbableDuplicates(deduplicate([...state.items, ...keywordBatch, ...batches.flat(), ...joafeItems]));
      state.lastSync = new Date().toISOString();
      state.departments = departments;
      saveState(state);
      page = 1;
      renderNow();
      let summary = `${state.items.length} structure(s) créée(s) depuis le ${formatDate(sinceInput.value)} ont été trouvées en ${departmentsLabel(departments)} (dont ${joafeItems.length} publication(s) au Journal officiel des associations).`;
      if (incompleteCount > 0) summary += " Attention : pour au moins une source, il y avait beaucoup de résultats et la liste pourrait ne pas être complète.";
      showMessage(summary);
    } catch (error) {
      showMessage(`Recherche impossible : ${error.message}. Vérifiez votre connexion Internet ou réessayez dans quelques minutes.`, true);
    } finally {
      button.disabled = false;
      button.innerHTML = '<span aria-hidden="true">↻</span> Rechercher les nouveautés';
    }
  });

  document.querySelector("#rna-button").addEventListener("click", () => document.querySelector("#rna-input").click());
  document.querySelector("#rna-input").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const departments = readSelectedDepartments(departmentSelect);
    showMessage(`Analyse du fichier RNA « ${file.name} »…`);
    try {
      const imported = extractRnaItems(await file.text(), sinceInput.value, departments);
      for (const item of imported) {
        try {
          const coords = await geocodeCommune(item.commune, item.postalCode);
          if (coords) { item.lat = coords.lat; item.lon = coords.lon; }
        } catch { /* la géolocalisation est un confort, une erreur ici ne doit pas bloquer l'import */ }
        await wait(REQUEST_DELAY_MS);
      }
      state.items = flagProbableDuplicates(deduplicate([...state.items, ...imported]));
      state.lastRnaImport = new Date().toISOString();
      saveState(state);
      page = 1;
      renderNow();
      showMessage(`${imported.length} association(s) sportive(s) candidate(s) ont été trouvées dans le fichier RNA.`);
    } catch (error) {
      showMessage(`Import RNA impossible : ${error.message}.`, true);
    } finally {
      event.target.value = "";
    }
  });
  document.querySelector("#export-button").addEventListener("click", () => state.items.length ? exportCsv(state.items) : showMessage("Aucun résultat à exporter.", true));
}
