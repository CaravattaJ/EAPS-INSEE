import { readFile, writeFile } from "node:fs/promises";

const [template, styles, application] = await Promise.all([
  readFile("index.template.html", "utf8"),
  readFile("styles.css", "utf8"),
  readFile("app.js", "utf8")
]);

if (!template.includes("<!-- INLINE_CSS -->") || !template.includes("<!-- INLINE_JS -->")) {
  throw new Error("Les emplacements INLINE_CSS ou INLINE_JS sont absents du modèle HTML.");
}

const output = template
  .replace("<!-- INLINE_CSS -->", `<style>\n${styles}</style>`)
  .replace("<!-- INLINE_JS -->", `<script>\n${application}</script>`);

await writeFile("index.html", output, "utf8");
console.log("index.html autonome généré : CSS et JavaScript intégrés.");
