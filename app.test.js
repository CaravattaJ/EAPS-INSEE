import test from "node:test";
import assert from "node:assert/strict";
import "./app.js";

const { deduplicate, defaultSince, extractItems, isAfter, normalizeResult } = globalThis.veilleSportsTestApi;

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
