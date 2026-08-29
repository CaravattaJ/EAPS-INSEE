const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const SPORTS_CODES = ["93.11Z", "93.12Z", "93.13Z", "93.19Z", "85.51Z", "93.29Z"];
const HIGH_PRIORITY_CODES = ["93.11Z", "93.12Z", "93.13Z", "93.19Z"];
const MEDIUM_PRIORITY_CODES = ["85.51Z"];
// Libellés des codes NAF/APE utilisés, pour affichage : l'agent ne connaît pas forcément
// la signification d'un code comme "93.12Z" à la simple lecture du tableau.
const NAF_LABELS = {
  "93.11Z": "Gestion d'installations sportives",
  "93.12Z": "Activités de clubs de sports",
  "93.13Z": "Activités des centres de culture physique",
  "93.19Z": "Autres activités liées au sport",
  "85.51Z": "Enseignement de disciplines sportives et d'activités de loisirs",
  "93.29Z": "Autres activités récréatives et de loisirs"
};
function activityLabel(code) {
  return NAF_LABELS[code] ? `${NAF_LABELS[code]} (${code})` : code;
}
const STORAGE_KEY = "veille-sports-21-state-v1";
const AGENT_NAME_KEY = "veille-sports-agent-name";
const SHARED_FILE_NAME = "veille-sports-partage.json";
const DECISIONS = ["À qualifier", "À contrôler", "Déjà connu", "Pas un lieu de pratique", "Hors périmètre"];
const REQUEST_DELAY_MS = 900;
const MAX_RETRIES = 4;
// L'API Sirene ne propose aucun filtre ni tri par date de création (vérifié sur sa
// spécification officielle) : impossible de demander uniquement les nouveautés.
// Pour ne rien manquer, l'application doit donc parcourir TOUTES les pages de chaque
// code NAF puis filtrer les dates elle-même. MAX_API_PAGES n'est plus une limite
// normale : c'est un garde-fou de sécurité très large, pour éviter une boucle sans fin
// dans un cas vraiment anormal (ce nombre de pages ne devrait jamais être atteint en
// pratique).
const MAX_API_PAGES = 12000;
// En dessous de ce nombre de pages à parcourir, la recherche est assez rapide pour ne
// pas avoir besoin de demander confirmation à l'agent avant de la lancer.
const CONFIRM_THRESHOLD_PAGES = 40;
// Temps approximatif d'une page (délai entre requêtes + temps de réponse du serveur),
// utilisé uniquement pour donner une estimation de durée à l'agent avant de lancer une
// recherche longue.
const ESTIMATED_MS_PER_PAGE = REQUEST_DELAY_MS + 400;
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

function defaultDecisionFields() {
  return { decision: DECISIONS[0], decidedBy: "", decidedAt: "" };
}

function itemKey(item) {
  return item.siret || `rna:${item.rna}`;
}

// Choisit, entre deux versions du même item, la décision la plus récente (par date de
// décision) plutôt que d'écraser aveuglément l'une par l'autre. Sert à la fois à ne pas
// perdre une décision déjà prise quand une recherche rafraîchit les données factuelles
// d'une structure, et à fusionner un fichier partagé avec l'état local sans verrou.
function mergeDecision(oldItem, newItem) {
  const oldAt = oldItem?.decidedAt || "";
  const newAt = newItem?.decidedAt || "";
  const winner = oldAt > newAt ? oldItem : newItem;
  return { decision: winner.decision || DECISIONS[0], decidedBy: winner.decidedBy || "", decidedAt: winner.decidedAt || "" };
}

function mergeItemLists(oldItems, newItems) {
  const oldByKey = new Map(oldItems.map(item => [itemKey(item), item]));
  return deduplicate([...oldItems, ...newItems]).map(item => {
    const old = oldByKey.get(itemKey(item));
    return old ? { ...item, ...mergeDecision(old, item) } : item;
  });
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
    activityLabel: activityLabel(item.activite_principale || code),
    creationDate: item.date_creation || result.date_creation || "",
    association: Boolean(result.complements?.est_association),
    rna: result.identifiant_association || result.complements?.identifiant_association || "",
    priority: priorityForCode(item.activite_principale || code),
    lat: toCoordinate(item.latitude),
    lon: toCoordinate(item.longitude),
    ...defaultDecisionFields()
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
      lon: null,
      ...defaultDecisionFields()
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

// Stocke la référence (FileSystemFileHandle) vers le fichier partagé lié par l'agent, pour
// pouvoir le recharger/réenregistrer automatiquement d'une ouverture à l'autre. localStorage
// ne peut pas stocker cet objet : IndexedDB est le seul stockage local qui le permette.
const HANDLE_DB_NAME = "veille-sports-handles";
const HANDLE_STORE_NAME = "handles";
const HANDLE_KEY = "sharedFileHandle";

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGetHandle() {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(HANDLE_STORE_NAME, "readonly").objectStore(HANDLE_STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function idbSetHandle(handle) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(HANDLE_STORE_NAME, "readwrite").objectStore(HANDLE_STORE_NAME).put(handle, HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Demande le nom/les initiales de l'agent une seule fois par poste, pour identifier qui a
// pris quelle décision quand plusieurs agents partagent leurs résultats.
function getAgentName() {
  let name = localStorage.getItem(AGENT_NAME_KEY) || "";
  if (!name) {
    name = (prompt("Votre nom ou vos initiales (pour identifier vos décisions auprès de vos collègues) :") || "").trim();
    if (name) localStorage.setItem(AGENT_NAME_KEY, name);
  }
  return name;
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

function buildSireneParams(extraParams, departments, page) {
  return new URLSearchParams({
    departement: departments.join(","),
    etat_administratif: "A",
    per_page: "25",
    page: String(page),
    ...extraParams
  });
}

// Renvoie le nombre de pages qu'il faudra parcourir pour ce code/mot-clé (sans les
// récupérer). Sert uniquement à estimer la durée d'une recherche avant de la lancer,
// puisque l'API ne permet pas de ne demander que les nouveautés (voir MAX_API_PAGES).
async function probePageCount(extraParams, departments) {
  const params = buildSireneParams(extraParams, departments, 1);
  const response = await requestWithRetry(`${API_BASE}?${params}`);
  if (!response.ok) throw new Error(`La source a répondu ${response.status}`);
  const payload = await response.json();
  return Math.min(Number(payload.total_pages || 1), MAX_API_PAGES);
}

function formatDuration(estimatedMs) {
  const totalMinutes = Math.round(estimatedMs / 60000);
  if (totalMinutes < 1) return "moins d'une minute";
  if (totalMinutes < 60) return `environ ${totalMinutes} minute${totalMinutes > 1 ? "s" : ""}`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `environ ${hours} h${minutes ? ` ${minutes}` : ""}`;
}

async function fetchByParams(extraParams, since, departments = DEFAULT_DEPARTMENTS, onProgress = () => {}) {
  const items = [];
  let page = 1;
  let pages = 1;
  do {
    onProgress(page, pages);
    const params = buildSireneParams(extraParams, departments, page);
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
    lon: toCoordinate(lon),
    ...defaultDecisionFields()
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
  let filtered = state.items.filter(item => [item.name, item.commune, item.siret, item.rna, item.activity, item.activityLabel, item.object].join(" ").toLowerCase().includes(query.toLowerCase()));
  if (hideLow) filtered = filtered.filter(item => item.priority !== "Faible");
  filtered = sortItems(filtered, sortColumn, sortDirection);
  const { pageItems, currentPage, totalPages, total } = paginate(filtered, page, pageSize);
  document.querySelector("#last-sync").textContent = state.lastSync ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.lastSync)) : "Jamais";
  const lastSyncSinceEl = document.querySelector("#last-sync-since");
  if (lastSyncSinceEl) lastSyncSinceEl.textContent = state.lastSearchSince ? `Structures depuis le ${formatDate(state.lastSearchSince)}` : "";
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
      <td>${escapeHtml(item.activityLabel || item.activity)}</td>
      <td>${item.object ? escapeHtml(item.object) : '<span class="identifier">—</span>'}</td>
      <td>${formatDate(item.creationDate)}${isFutureDate(item.creationDate) ? '<br><span class="future-flag">Date à venir — pas encore en activité</span>' : ""}</td>
      <td><select class="decision-select" data-key="${escapeHtml(itemKey(item))}" aria-label="Décision pour ${escapeHtml(item.name)}">${DECISIONS.map(decision => `<option${decision === item.decision ? " selected" : ""}>${escapeHtml(decision)}</option>`).join("")}</select>${item.decidedBy ? `<br><span class="identifier">Par ${escapeHtml(item.decidedBy)} le ${formatDate(item.decidedAt)}</span>` : ""}</td>
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
  const rows = [["Niveau de confiance", "Source", "Type", "Nom", "SIRET", "RNA", "Commune", "Code postal", "Activité", "Description", "Motif", "Date de création", "Décision", "Décidée par", "Décidée le"], ...items.map(item => [item.priority, item.source || "Sirene", item.association ? "Association" : "Établissement", item.name, item.siret, item.rna, item.commune, item.postalCode, item.activityLabel || item.activity, item.object || "", item.reason || "", item.creationDate, item.decision, item.decidedBy || "", item.decidedAt || ""])];
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
  veilleSportsTestApi: { defaultSince, isAfter, normalizeResult, extractItems, deduplicate, requestWithRetry, parseDelimited, findSportKeywords, extractRnaItems, priorityForCode, flagProbableDuplicates, markKeywordFallback, daysSince, isFutureDate, normalizeJoafeRecord, sortItems, isInDepartments, departmentsLabel, paginate, joafeWhereClause, geocodeCommune, DEPARTMENTS, formatDuration, CONFIRM_THRESHOLD_PAGES, ESTIMATED_MS_PER_PAGE, mergeItemLists, mergeDecision, itemKey, DECISIONS }
});

function readSelectedDepartments(checkboxes) {
  const values = Array.from(checkboxes).filter(checkbox => checkbox.checked).map(checkbox => checkbox.value);
  return values.length ? values : DEFAULT_DEPARTMENTS;
}

const PRIORITY_MAP_COLORS = { "Élevée": "#b42318", "Moyenne": "#9a6700", "Faible": "#667085" };

if (typeof document !== "undefined") {
  const state = loadState();
  const sinceInput = document.querySelector("#since-input");
  const filterInput = document.querySelector("#filter-input");
  const hideLowInput = document.querySelector("#hide-low-input");
  const departmentCheckboxes = document.querySelectorAll(".department-checkbox");
  const departmentSummary = document.querySelector("#department-summary");
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
    // La carte vit dans un bloc replié par défaut : Leaflet doit recalculer sa taille
    // une fois le bloc réellement visible, sinon les tuiles restent mal disposées.
    const mapBlock = document.querySelector("#map-block");
    if (mapBlock) mapBlock.addEventListener("toggle", () => { if (mapBlock.open) map.invalidateSize(); });
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
        .bindPopup(`<strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(item.commune)} (${escapeHtml(item.postalCode)})<br>${escapeHtml(item.activityLabel || item.activity)}<br>Créée le ${formatDate(item.creationDate)}`)
        .addTo(markerLayer);
    }
  }

  const renderNow = () => {
    const { currentPage, mapItems } = render(state, filterInput.value, { hideLow: hideLowInput.checked, sortColumn, sortDirection, page });
    page = currentPage;
    updateMap(mapItems);
  };

  // Chargement/enregistrement automatiques du fichier partagé, disponibles uniquement sur les
  // navigateurs qui savent lire/écrire un fichier local choisi une fois (Chrome, Edge...).
  // Sur les autres (Firefox notamment), les boutons manuels "Charger"/"Enregistrer sur le
  // partage" restent le seul moyen, exactement comme avant.
  const supportsFileHandles = typeof window !== "undefined" && typeof window.showOpenFilePicker === "function" && typeof indexedDB !== "undefined";
  let sharedFileHandle = null;
  const linkSharedButton = document.querySelector("#link-shared-button");
  if (linkSharedButton) linkSharedButton.hidden = !supportsFileHandles;

  async function saveToSharedHandle() {
    if (!sharedFileHandle || !state.items.length) return;
    try {
      const writable = await sharedFileHandle.createWritable();
      await writable.write(JSON.stringify({ exportedAt: new Date().toISOString(), items: state.items }, null, 2));
      await writable.close();
    } catch {
      // Écriture automatique en échec (droit révoqué, fichier déplacé...) : l'agent garde la
      // main via "Enregistrer sur le partage", rien n'est perdu localement.
    }
  }

  // Renvoie true si la lecture a réussi. Un fichier vide (première liaison, fichier tout
  // juste créé par l'agent) compte comme réussi, avec zéro structure à fusionner.
  async function loadFromSharedHandle(sourceLabel) {
    if (!sharedFileHandle) return false;
    try {
      const file = await sharedFileHandle.getFile();
      const text = (await file.text()).trim();
      const payload = text ? JSON.parse(text) : { items: [] };
      const incoming = Array.isArray(payload.items) ? payload.items : [];
      state.items = flagProbableDuplicates(mergeItemLists(state.items, incoming));
      saveState(state);
      page = 1;
      renderNow();
      if (sourceLabel) showMessage(`Partage rechargé automatiquement (${incoming.length} structure(s)).`);
      return true;
    } catch {
      if (sourceLabel) showMessage("Rechargement automatique du partage impossible — utilisez « Charger le partage ».", true);
      return false;
    }
  }

  if (linkSharedButton) {
    linkSharedButton.addEventListener("click", async () => {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "Fichier partagé JSON", accept: { "application/json": [".json"] } }]
        });
        sharedFileHandle = handle;
        await idbSetHandle(handle);
        const loaded = await loadFromSharedHandle();
        showMessage(loaded
          ? "Partage lié : rechargé à l'ouverture, réenregistré après chaque décision."
          : "Partage lié (fichier vide ou illisible pour l'instant) : il sera réenregistré après chaque décision.");
      } catch {
        // L'agent a annulé la sélection du fichier : rien à faire.
      }
    });
  }

  if (supportsFileHandles) {
    (async () => {
      try {
        const storedHandle = await idbGetHandle();
        if (!storedHandle) return;
        if ((await storedHandle.queryPermission({ mode: "readwrite" })) === "granted") {
          sharedFileHandle = storedHandle;
          await loadFromSharedHandle("ouverture");
        } else {
          showMessage("Autorisation du fichier partagé expirée — recliquez sur « Lier le partage (auto) ».");
        }
      } catch {
        // Pas de fichier lié précédemment, ou lecture IndexedDB indisponible : comportement manuel inchangé.
      }
    })();
    if (typeof window !== "undefined") window.addEventListener("pagehide", () => { saveToSharedHandle(); });
  }

  const updateDepartmentSummary = () => {
    departmentSummary.textContent = departmentsLabel(readSelectedDepartments(departmentCheckboxes));
  };

  if (Array.isArray(state.departments) && state.departments.length) {
    departmentCheckboxes.forEach(checkbox => { checkbox.checked = state.departments.includes(checkbox.value); });
  }
  updateDepartmentSummary();

  const departmentDropdown = document.querySelector("#department-dropdown");
  if (departmentDropdown) {
    document.addEventListener("click", event => {
      if (departmentDropdown.open && !departmentDropdown.contains(event.target)) departmentDropdown.open = false;
    });
  }

  sinceInput.value = state.lastSync ? new Date(new Date(state.lastSync).getTime() - RECOVERY_DAYS * 86400000).toISOString().slice(0, 10) : defaultSince();
  renderNow();

  hideLowInput.addEventListener("change", () => { page = 1; renderNow(); });
  filterInput.addEventListener("input", () => { page = 1; renderNow(); });
  departmentCheckboxes.forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      state.departments = readSelectedDepartments(departmentCheckboxes);
      saveState(state);
      updateDepartmentSummary();
    });
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
      showMessage("Date ancienne choisie : sur une aussi longue période, certains résultats peuvent manquer. Essayez une période plus courte si la liste semble incomplète.");
    }
  });

  document.querySelector("#search-button").addEventListener("click", async event => {
    const button = event.currentTarget;
    const departments = readSelectedDepartments(departmentCheckboxes);
    button.disabled = true;
    button.textContent = "Estimation de la durée…";
    showMessage("Estimation de la durée de la recherche…");
    try {
      // Le site des entreprises ne permet pas de ne demander que les nouveautés : il faut
      // parcourir toutes les pages de chaque activité pour ne rien manquer. On mesure donc
      // d'abord combien de pages ça représente, pour prévenir l'agent si c'est long.
      let totalPages = 0;
      for (const code of SPORTS_CODES) {
        totalPages += await probePageCount({ activite_principale: code }, departments);
        await wait(REQUEST_DELAY_MS);
      }
      totalPages += await probePageCount({ q: COMPLEMENTARY_KEYWORD }, departments);

      if (totalPages > CONFIRM_THRESHOLD_PAGES) {
        const proceed = confirm(
          `Cette recherche va devoir consulter environ ${totalPages} pages de résultats sur ${departmentsLabel(departments)}, ` +
          `ce qui prendra ${formatDuration(totalPages * ESTIMATED_MS_PER_PAGE)}. ` +
          "Voulez-vous continuer ? (Astuce : réduire le nombre de départements sélectionnés accélère la recherche.)"
        );
        if (!proceed) {
          showMessage("Recherche annulée — réduisez la période ou les départements pour aller plus vite.");
          return;
        }
      }

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
      // porte sur une période plus courte, et les nouveaux résultats (mêmes clé) les mettent à jour ;
      // la décision déjà prise sur une structure n'est jamais écrasée par le rafraîchissement.
      state.items = flagProbableDuplicates(mergeItemLists(state.items, [...keywordBatch, ...batches.flat(), ...joafeItems]));
      state.lastSync = new Date().toISOString();
      state.lastSearchSince = sinceInput.value;
      state.departments = departments;
      saveState(state);
      page = 1;
      renderNow();
      await saveToSharedHandle();
      let summary = `${state.items.length} structure(s) trouvée(s) depuis le ${formatDate(sinceInput.value)} en ${departmentsLabel(departments)} (dont ${joafeItems.length} au Journal officiel).`;
      if (incompleteCount > 0) summary += " Attention, liste peut-être incomplète (beaucoup de résultats sur au moins une source).";
      showMessage(summary);
    } catch (error) {
      showMessage(`Recherche impossible : ${error.message}. Vérifiez votre connexion.`, true);
    } finally {
      button.disabled = false;
      button.innerHTML = '<span aria-hidden="true">↻</span> Rechercher';
    }
  });

  document.querySelector("#rna-button").addEventListener("click", () => document.querySelector("#rna-input").click());
  document.querySelector("#rna-input").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    const departments = readSelectedDepartments(departmentCheckboxes);
    showMessage(`Analyse de « ${file.name} »…`);
    try {
      const imported = extractRnaItems(await file.text(), sinceInput.value, departments);
      for (const item of imported) {
        try {
          const coords = await geocodeCommune(item.commune, item.postalCode);
          if (coords) { item.lat = coords.lat; item.lon = coords.lon; }
        } catch { /* la géolocalisation est un confort, une erreur ici ne doit pas bloquer l'import */ }
        await wait(REQUEST_DELAY_MS);
      }
      state.items = flagProbableDuplicates(mergeItemLists(state.items, imported));
      state.lastRnaImport = new Date().toISOString();
      saveState(state);
      page = 1;
      renderNow();
      await saveToSharedHandle();
      showMessage(`${imported.length} association(s) candidate(s) trouvée(s) dans le fichier RNA.`);
    } catch (error) {
      showMessage(`Import RNA impossible : ${error.message}.`, true);
    } finally {
      event.target.value = "";
    }
  });
  document.querySelector("#export-button").addEventListener("click", () => state.items.length ? exportCsv(state.items) : showMessage("Aucun résultat à exporter.", true));

  document.querySelector("#results-body").addEventListener("change", async event => {
    if (!event.target.matches(".decision-select")) return;
    const item = state.items.find(candidate => itemKey(candidate) === event.target.dataset.key);
    if (!item) return;
    item.decision = event.target.value;
    item.decidedBy = getAgentName();
    item.decidedAt = new Date().toISOString();
    saveState(state);
    renderNow();
    await saveToSharedHandle();
  });

  document.querySelector("#load-shared-button").addEventListener("click", () => document.querySelector("#shared-input").click());
  document.querySelector("#shared-input").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    showMessage(`Lecture de « ${file.name} »…`);
    try {
      const payload = JSON.parse(await file.text());
      const incoming = Array.isArray(payload.items) ? payload.items : [];
      state.items = flagProbableDuplicates(mergeItemLists(state.items, incoming));
      saveState(state);
      page = 1;
      renderNow();
      showMessage(`${incoming.length} structure(s) fusionnée(s) depuis le partage.`);
    } catch (error) {
      showMessage(`Fichier partagé illisible : ${error.message}.`, true);
    } finally {
      event.target.value = "";
    }
  });

  document.querySelector("#save-shared-button").addEventListener("click", () => {
    if (!state.items.length) { showMessage("Aucun résultat à partager.", true); return; }
    const payload = { exportedAt: new Date().toISOString(), items: state.items };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    link.download = SHARED_FILE_NAME;
    link.click();
    URL.revokeObjectURL(link.href);
    showMessage(`« ${SHARED_FILE_NAME} » téléchargé — déposez-le sur le dossier partagé (en écrasant l'ancien).`);
  });
}
