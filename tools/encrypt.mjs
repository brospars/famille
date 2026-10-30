#!/usr/bin/env node
// Chiffre private/family.json, private/places.json et private/notes.json dans data/vault.json.
// Usage :  node tools/encrypt.mjs            (le mot de passe est demandé)
//          FAMILLE_MDP="..." node tools/encrypt.mjs
// Algorithme : PBKDF2-SHA256 (600 000 itérations) -> clé AES-256-GCM. Node 18 ou plus récent.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ITERATIONS = 600000;
const { subtle } = globalThis.crypto;

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.startsWith(question)) process.stdout.write(s); };
    rl.question(question, answer => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}
const b64 = buf => Buffer.from(buf).toString("base64");

const read = async name => JSON.parse(await readFile(join(root, "private", name), "utf8"));
const payload = {
  family: await read("family.json"),
  places: await read("places.json"),
  notes: await read("notes.json").catch(() => [])
};

let password = process.env.FAMILLE_MDP;
if (!password) {
  password = await ask("Mot de passe : ");
  const again = await ask("Confirmer : ");
  if (password !== again) { console.error("Les deux mots de passe sont différents."); process.exit(1); }
}
if (password.length < 16) { console.error("Mot de passe trop court : 16 caractères minimum (une phrase de 4 ou 5 mots, par exemple)."); process.exit(1); }

const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));

const vault = { v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, cipher: "AES-256-GCM", salt: b64(salt), iv: b64(iv), data: b64(ct) };
await writeFile(join(root, "data", "vault.json"), JSON.stringify(vault) + "\n");
console.log(`data/vault.json écrit (${payload.family.persons.length} personnes, ${Object.keys(payload.places).length} lieux).`);
