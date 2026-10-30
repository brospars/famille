#!/usr/bin/env node
// Vérifie que data/vault.json se déchiffre avec FAMILLE_MDP. N'affiche aucune donnée.
// Utilisé par GitHub Actions avant le déploiement ; utilisable aussi en local.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = await readFile(join(root, ".env"), "utf8").catch(() => "");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
}
const password = process.env.FAMILLE_MDP;
if (!password) { console.error("FAMILLE_MDP n'est pas défini."); process.exit(1); }

const vault = JSON.parse(await readFile(join(root, "data", "vault.json"), "utf8"));
const b = s => Buffer.from(s, "base64");
const { subtle } = globalThis.crypto;
const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b(vault.salt), iterations: vault.iterations }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
try {
  const data = JSON.parse(new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv: b(vault.iv) }, key, b(vault.data))));
  if (!data.family || !Array.isArray(data.family.persons) || !data.places) throw new Error("structure");
  console.log(`vault.json valide : ${data.family.persons.length} personnes, ${Object.keys(data.places).length} lieux.`);
} catch (e) {
  console.error(e.message === "structure" ? "vault.json se déchiffre mais son contenu est incomplet." : "vault.json ne se déchiffre pas avec ce mot de passe.");
  process.exit(1);
}
