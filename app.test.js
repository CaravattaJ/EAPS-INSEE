import test from "node:test";
import assert from "node:assert/strict";
import "./app.js";

const { deduplicate, defaultSince, extractItems, isAfter, normalizeResult, requestWithRetry, parseDelimited, findSportKeywords, extractRnaItems, priorityForCode, flagProbableDuplicates, markKeywordFallback, daysSince } = globalThis.veilleSportsTestApi;

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

test("normalizes an association returned by the API", () => {
  const item = normalizeResult({ siren: "123", nom_complet: "Club test", complements: { est_association: true }, identifiant_association: "W212345678", siege: {} }, { siret: "12300012", activite_principale: "93.12Z", date_creation: "2026-08-10", adresse: { code_postal: "21000", libelle_commune: "DIJON" } }, "93.12Z");
  assert.equal(item.association, true);
  assert.equal(item.rna, "W212345678");
  assert.equal(item.priority, "Élevée");
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
