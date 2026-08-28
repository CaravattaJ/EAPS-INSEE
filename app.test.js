import test from "node:test";
import assert from "node:assert/strict";
import "./app.js";

const { deduplicate, defaultSince, extractItems, isAfter, normalizeResult, requestWithRetry, parseDelimited, findSportKeywords, extractRnaItems, priorityForCode, flagProbableDuplicates, markKeywordFallback, daysSince, isFutureDate, normalizeJoafeRecord, sortItems, isInDepartments, departmentsLabel, paginate, joafeWhereClause, geocodeCommune, DEPARTMENTS } = globalThis.veilleSportsTestApi;

test("defaultSince returns thirty days before the reference date", () => {
  assert.equal(defaultSince(new Date("2026-08-27T12:00:00Z")), "2026-07-28");
});

test("isAfter includes the starting day", () => {
  assert.equal(isAfter("2026-08-01", "2026-08-01"), true);
  assert.equal(isAfter("2026-07-31", "2026-08-01"), false);
});

test("priorityForCode ranks sport NAF codes by confidence", () => {
  assert.equal(priorityForCode("93.12Z"), "Élevée");
  assert.equal(priorityForCode("85.51Z"), "Moyenne");
  assert.equal(priorityForCode("93.29Z"), "Faible");
  assert.equal(priorityForCode("47.11Z"), "Faible");
});

test("isInDepartments matches any of several selected departments", () => {
  assert.equal(isInDepartments("71000", ["21", "71"]), true);
  assert.equal(isInDepartments("75001", ["21", "71"]), false);
  assert.equal(isInDepartments("21000"), true);
});

test("departmentsLabel names one or two departments, and counts beyond that", () => {
  assert.equal(departmentsLabel(["21"]), "Côte-d'Or");
  assert.equal(departmentsLabel(["21", "71"]), "Côte-d'Or et Saône-et-Loire");
  assert.equal(departmentsLabel(["21", "71", "89"]), "3 départements sélectionnés");
  assert.equal(DEPARTMENTS.length, 8);
});

test("joafeWhereClause filters by creation announcements, date and one or more departments", () => {
  const clause = joafeWhereClause("2026-08-01", ["21", "71"]);
  assert.match(clause, /departement_code in \("21","71"\)/);
  assert.match(clause, /typeavis="Création"/);
  assert.match(clause, /dateparution>="2026-08-01"/);
});

test("paginate slices items and clamps an out-of-range page", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: i }));
  const firstPage = paginate(items, 1, 5);
  assert.equal(firstPage.pageItems.length, 5);
  assert.equal(firstPage.totalPages, 3);
  assert.equal(firstPage.total, 12);

  const outOfRange = paginate(items, 99, 5);
  assert.equal(outOfRange.currentPage, 3);
  assert.equal(outOfRange.pageItems.length, 2);

  const empty = paginate([], 1, 5);
  assert.equal(empty.currentPage, 1);
  assert.equal(empty.totalPages, 1);
});

test("geocodeCommune turns a BAN municipality match into lat/lon", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ features: [{ geometry: { coordinates: [5.033601, 47.331953] } }] })
  });
  const coords = await geocodeCommune("Dijon", "21000", fakeFetch);
  assert.deepEqual(coords, { lat: 47.331953, lon: 5.033601 });
});

test("geocodeCommune returns null when nothing matches", async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ features: [] }) });
  assert.equal(await geocodeCommune("Introuvable", "00000", fakeFetch), null);
});

test("normalizes an association returned by the API", () => {
  const item = normalizeResult({ siren: "123", nom_complet: "Club test", complements: { est_association: true }, identifiant_association: "W212345678", siege: {} }, { siret: "12300012", activite_principale: "93.12Z", date_creation: "2026-08-10", adresse: { code_postal: "21000", libelle_commune: "DIJON" } }, "93.12Z");
  assert.equal(item.association, true);
  assert.equal(item.rna, "W212345678");
  assert.equal(item.priority, "Élevée");
});

test("normalizeResult keeps the establishment's coordinates when Sirene provides them", () => {
  const item = normalizeResult({ siren: "123", nom_complet: "Club test", siege: {} }, { siret: "12300012", activite_principale: "93.12Z", latitude: "47.331953", longitude: "5.033601", adresse: { code_postal: "21000", libelle_commune: "DIJON" } }, "93.12Z");
  assert.equal(item.lat, 47.331953);
  assert.equal(item.lon, 5.033601);
});

test("extracts recent Côte-d'Or establishments only", () => {
  const payload = { results: [{ siren: "123", nom_complet: "Club test", matching_etablissements: [
    { siret: "12300012", date_creation: "2026-08-10", adresse: { code_postal: "21000", libelle_commune: "DIJON" } },
    { siret: "12300020", date_creation: "2026-08-10", adresse: { code_postal: "75001", libelle_commune: "PARIS" } },
    { siret: "12300038", date_creation: "2020-01-01", adresse: { code_postal: "21200", libelle_commune: "BEAUNE" } }
  ] }] };
  assert.deepEqual(extractItems(payload, "93.12Z", "2026-08-01").map(item => item.siret), ["12300012"]);
});

test("deduplicates establishments by SIRET", () => {
  assert.equal(deduplicate([{ siret: "1" }, { siret: "1" }, { siret: "2" }]).length, 2);
});

test("markKeywordFallback demotes results whose NAF code isn't already tracked as sport", () => {
  const tracked = markKeywordFallback({ activity: "93.12Z", priority: "Élevée" });
  assert.equal(tracked.priority, "Élevée");
  const untracked = markKeywordFallback({ activity: "47.11Z", priority: "Élevée" });
  assert.equal(untracked.priority, "Faible");
  assert.match(untracked.reason, /47\.11Z/);
});

test("retries a rate-limited request after the requested delay", async () => {
  const statuses = [429, 200];
  const waits = [];
  const response = await requestWithRetry(
    "https://example.test",
    async () => ({ status: statuses.shift(), headers: { get: () => "3" } }),
    async delay => waits.push(delay)
  );
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [3000]);
});

test("stops retrying after repeated rate limits", async () => {
  let calls = 0;
  await assert.rejects(
    requestWithRetry(
      "https://example.test",
      async () => { calls += 1; return { status: 429, headers: { get: () => null } }; },
      async () => {}
    ),
    /erreur 429/
  );
  assert.equal(calls, 5);
});

test("parses quoted CSV fields", () => {
  assert.deepEqual(parseDelimited('id;titre;objet\r\nW21;"Club; test";"Pratique du judo"'), [
    ["id", "titre", "objet"], ["W21", "Club; test", "Pratique du judo"]
  ]);
});

test("finds sports keywords without depending on accents", () => {
  assert.deepEqual(findSportKeywords("Pratique de l'equitation et de la randonnée"), ["equitation", "randonnee"]);
});

test("extracts active sports associations in Côte-d'Or from RNA CSV, keeping unmatched ones at low priority", () => {
  const csv = [
    "id;titre;objet;date_creat;date_disso;adrs_codepostal;adrs_libcommune",
    "W212345678;Judo Dijon;Pratique du judo;12/08/2026;;21000;DIJON",
    "W212345679;Culture Dijon;Promotion de la lecture;12/08/2026;;21000;DIJON",
    "W212345680;Football Paris;Pratique du football;12/08/2026;;75000;PARIS",
    "W212345681;Ancien tennis;Pratique du tennis;12/08/2026;15/08/2026;21200;BEAUNE"
  ].join("\n");
  const items = extractRnaItems(csv, "2026-08-01");
  assert.equal(items.length, 2);
  const judo = items.find(item => item.rna === "W212345678");
  assert.equal(judo.priority, "Moyenne");
  assert.equal(judo.source, "RNA");
  const culture = items.find(item => item.rna === "W212345679");
  assert.equal(culture.priority, "Faible");
  assert.match(culture.reason, /Aucun indice sportif/);
});

test("recognizes the rna_import file's 'libcom' column for the commune", () => {
  const csv = [
    "id;titre;objet;date_creat;date_disso;adrs_codepostal;libcom",
    "W212345695;Basket Dijon;Pratique du basket;12/08/2026;;21000;DIJON"
  ].join("\n");
  const items = extractRnaItems(csv, "2026-08-01");
  assert.equal(items.length, 1);
  assert.equal(items[0].commune, "DIJON");
});

test("treats the rna_import placeholder date 0001-01-01 as unknown rather than excluding the row", () => {
  const csv = [
    "id;titre;objet;date_creat;date_disso;adrs_codepostal;adrs_libcommune",
    "W212345696;Escrime Dijon;Pratique de l'escrime;0001-01-01;;21000;DIJON"
  ].join("\n");
  const items = extractRnaItems(csv, "2026-08-01");
  assert.equal(items.length, 1);
  assert.equal(items[0].creationDate, "");
});

test("never treats the last-declaration date (date_decla) as a creation date, to avoid flagging old associations as new", () => {
  const csv = [
    "id;titre;objet;date_decla;date_disso;adrs_codepostal;adrs_libcommune",
    "W212345697;Anciens combattants;Entraide et devoir de mémoire;18/08/2026;;21000;DIJON"
  ].join("\n");
  const items = extractRnaItems(csv, "2026-08-01");
  // La ligne reste visible (date de création inconnue n'est jamais un motif d'exclusion silencieuse),
  // mais elle ne doit surtout pas hériter de la date de dernière déclaration comme fausse date de création.
  assert.equal(items.length, 1);
  assert.equal(items[0].creationDate, "");
});

test("falls back to the JO publication date (date_publi) when date_creat is missing", () => {
  const csv = [
    "id;titre;objet;date_publi;date_disso;adrs_codepostal;adrs_libcommune",
    "W212345698;Rugby Dijon;Pratique du rugby;18/08/2026;;21000;DIJON"
  ].join("\n");
  const items = extractRnaItems(csv, "2026-08-01");
  assert.equal(items.length, 1);
  assert.equal(items[0].creationDate, "2026-08-18");
});

test("throws a clear error naming the detected headers when the file's columns aren't recognized", () => {
  const csv = ["nom;description;departement", "Club X;Un club;21"].join("\n");
  assert.throws(() => extractRnaItems(csv, "2026-08-01"), /Colonnes trouvées/);
});

test("recognizes a sport WALDEC code even without a keyword match in the title/object", () => {
  const csv = [
    "id;titre;objet;date_creat;date_disso;adrs_codepostal;adrs_libcommune;objet_social1;objet_social2",
    "W212345690;Les Amis du Stade;Activités diverses;12/08/2026;;21000;DIJON;011075;"
  ].join("\n");
  const items = extractRnaItems(csv, "2026-08-01");
  assert.equal(items.length, 1);
  assert.equal(items[0].priority, "Élevée");
  assert.match(items[0].reason, /WALDEC|011075/);
});

test("flagProbableDuplicates links an RNA entry to a matching Sirene association sharing name and postal code", () => {
  const sireneItem = { name: "Judo Dijon", postalCode: "21000", siret: "12300012", association: true, source: undefined };
  const rnaItem = { name: "Judo Dijon", postalCode: "21000", siret: "", rna: "W21", source: "RNA" };
  const flagged = flagProbableDuplicates([sireneItem, rnaItem]);
  const flaggedRna = flagged.find(item => item.source === "RNA");
  assert.match(flaggedRna.possibleDuplicateOf, /12300012/);
});

test("flagProbableDuplicates does not flag distinct clubs in different communes", () => {
  const sireneItem = { name: "Club de football", postalCode: "21000", siret: "111", association: true, source: undefined };
  const rnaItem = { name: "Club de football", postalCode: "21200", siret: "", rna: "W22", source: "RNA" };
  const flagged = flagProbableDuplicates([sireneItem, rnaItem]);
  const flaggedRna = flagged.find(item => item.source === "RNA");
  assert.equal(flaggedRna.possibleDuplicateOf, undefined);
});

test("daysSince returns Infinity for a missing date and a positive count otherwise", () => {
  assert.equal(daysSince(null), Infinity);
  assert.ok(daysSince(new Date(Date.now() - 5 * 86400000).toISOString()) >= 4.9);
});

test("normalizeJoafeRecord recognizes the sport family code (11000/...) from the Journal officiel", () => {
  const record = {
    titre: "BADMINTON CLUB SAINT SEINE L'ABBAYE",
    objet: "promouvoir la pratique du badminton",
    domaine_activite_categorise: ["11000/11030"],
    commune_actuelle: "Saint-Seine-l'Abbaye",
    codepostal_actuel: "21440",
    dateparution: "2026-08-25",
    numero_rna: "W212000001",
    geo_point: { lat: 47.439498, lon: 4.788477 }
  };
  const item = normalizeJoafeRecord(record);
  assert.equal(item.priority, "Élevée");
  assert.equal(item.source, "JOAFE");
  assert.equal(item.commune, "Saint-Seine-l'Abbaye");
  assert.equal(item.creationDate, "2026-08-25");
  assert.equal(item.lat, 47.439498);
  assert.equal(item.lon, 4.788477);
});

test("normalizeJoafeRecord doesn't crash when geo_point is missing or null", () => {
  const withoutGeoPoint = normalizeJoafeRecord({ titre: "LECLERC", objet: "commerce", domaine_activite_categorise: [] });
  assert.equal(withoutGeoPoint.lat, null);
  assert.equal(withoutGeoPoint.lon, null);
  const withNullGeoPoint = normalizeJoafeRecord({ titre: "LECLERC", objet: "commerce", domaine_activite_categorise: [], geo_point: null });
  assert.equal(withNullGeoPoint.lat, null);
  assert.equal(withNullGeoPoint.lon, null);
});

test("normalizeJoafeRecord falls back to keywords, then to low priority, for non-sport activity codes", () => {
  const withKeyword = normalizeJoafeRecord({
    titre: "NGR SPORT", objet: "association sportive", domaine_activite_categorise: ["11000/11192"], codepostal_actuel: "21000"
  });
  assert.equal(withKeyword.priority, "Élevée");

  const noIndicator = normalizeJoafeRecord({
    titre: "UNION FRATERNELLE DES ANCIENS COMBATTANTS", objet: "entraide et devoir de mémoire", domaine_activite_categorise: ["36000/36510"], codepostal_actuel: "21000"
  });
  assert.equal(noIndicator.priority, "Faible");
});

test("sortItems orders by priority level, not alphabetically, and respects direction", () => {
  const items = [{ priority: "Faible" }, { priority: "Élevée" }, { priority: "Moyenne" }];
  assert.deepEqual(sortItems(items, "priority", "asc").map(i => i.priority), ["Faible", "Moyenne", "Élevée"]);
  assert.deepEqual(sortItems(items, "priority", "desc").map(i => i.priority), ["Élevée", "Moyenne", "Faible"]);
});

test("sortItems orders text columns case-insensitively and leaves the list unchanged without a column", () => {
  const items = [{ name: "Zèbre" }, { name: "avion" }, { name: "Banane" }];
  assert.deepEqual(sortItems(items, "name", "asc").map(i => i.name), ["avion", "Banane", "Zèbre"]);
  assert.deepEqual(sortItems(items, null).map(i => i.name), ["Zèbre", "avion", "Banane"]);
});

test("isFutureDate flags a declared creation date that hasn't happened yet", () => {
  assert.equal(isFutureDate(null), false);
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  assert.equal(isFutureDate(tomorrow), true);
  assert.equal(isFutureDate(yesterday), false);
});
