/* Déchiffrement de data/vault.json dans le navigateur (Web Crypto).
   PBKDF2-SHA256 -> AES-256-GCM, identique à tools/encrypt.mjs. */
window.Vault = (function () {
  "use strict";
  const STORE = "famille-key";
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  let vaultPromise;
  const loadVault = () => (vaultPromise ||= fetch("data/vault.json", { cache: "no-store" }).then(r => {
    if (!r.ok) throw new Error("vault");
    return r.json();
  }));

  async function deriveKey(password, vault) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: fromB64(vault.salt), iterations: vault.iterations },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function decryptWith(key, vault) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(vault.iv) }, key, fromB64(vault.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  // The stored key is tied to the vault's salt: a re-encrypted vault invalidates it.
  function readStored(vault) {
    for (const s of [sessionStorage, localStorage]) {
      try {
        const v = JSON.parse(s.getItem(STORE) || "null");
        if (v && v.salt === vault.salt) return v.key;
      } catch (e) { /* storage unavailable */ }
    }
    return null;
  }
  function store(rawKey, vault, remember) {
    const v = JSON.stringify({ salt: vault.salt, key: rawKey });
    try { sessionStorage.setItem(STORE, v); } catch (e) {}
    if (remember) { try { localStorage.setItem(STORE, v); } catch (e) {} }
  }
  function forget() {
    try { sessionStorage.removeItem(STORE); } catch (e) {}
    try { localStorage.removeItem(STORE); } catch (e) {}
  }
  async function unlockWithPassword(password, remember) {
    const vault = await loadVault();
    const key = await deriveKey(password, vault);
    const data = await decryptWith(key, vault); // throws on wrong password
    store(toB64(await crypto.subtle.exportKey("raw", key)), vault, remember);
    return data;
  }
  async function unlockFromStorage() {
    const vault = await loadVault();
    const raw = readStored(vault);
    if (!raw) return null;
    try {
      const key = await crypto.subtle.importKey("raw", fromB64(raw), { name: "AES-GCM" }, false, ["decrypt"]);
      return await decryptWith(key, vault);
    } catch (e) { forget(); return null; }
  }
  return { unlockWithPassword, unlockFromStorage, forget };
})();
