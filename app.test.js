import test from "node:test";
import assert from "node:assert/strict";
import "./app.js";

const { deduplicate, defaultSince, extractItems, isAfter, normalizeResult, requestWithRetry, parseDelimited, findSportKeywords, extractRnaItems } = globalThis.veilleSportsTestApi;

test("defaultSince returns thirty days before the reference date", () => {
  assert.equal(defaultSince(new Date("2026-08-27T12:00:00Z")), "2026-07-28");
});

test("isAfter includes the starting day", () => {
  assert.equal(isAfter("2026-08-01", "2026-08-01"), true);
  assert.equal(isAfter("2026-07-31", "2026-08-01"), false);
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

test("extracts active sports associations in Côte-d'Or from RNA CSV", () => {
  const csv = [
    "id;titre;objet;date_creat;date_disso;adrs_codepostal;adrs_libcommune",
    "W212345678;Judo Dijon;Pratique du judo;12/08/2026;;21000;DIJON",
    "W212345679;Culture Dijon;Promotion de la lecture;12/08/2026;;21000;DIJON",
    "W212345680;Football Paris;Pratique du football;12/08/2026;;75000;PARIS",
    "W212345681;Ancien tennis;Pratique du tennis;12/08/2026;15/08/2026;21200;BEAUNE"
  ].join("\n");
  const items = extractRnaItems(csv, "2026-08-01");
  assert.equal(items.length, 1);
  assert.equal(items[0].rna, "W212345678");
  assert.equal(items[0].source, "RNA");
});
