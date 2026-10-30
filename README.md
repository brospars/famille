# Arbre familial

Arbre généalogique interactif et carte des lieux de vie. Site statique, sans compilation, prévu pour GitHub Pages.

**Tout le contenu est chiffré.** Le dépôt ne contient que `data/vault.json`, illisible sans le mot de passe.
Le site le déchiffre dans le navigateur une fois le mot de passe saisi.

- **Arbre** : ascendance avec zoom et déplacement ; un clic ouvre la fiche d'une personne.
- **Carte** : naissances, mariages et décès par lieu, trajets parent → enfant, curseur dans le temps.
- **Personnes** : liste par nom de famille, avec recherche.
- **Notes** : points à vérifier et sources.

## Chiffrement

- Clé dérivée du mot de passe par PBKDF2-SHA256 (600 000 itérations, sel aléatoire), chiffrement AES-256-GCM.
- Même algorithme côté navigateur (`assets/vault.js`, Web Crypto) et côté script (`tools/encrypt.mjs`, Node 18+).
- « Se souvenir sur cet appareil » garde la clé dérivée dans le navigateur ; « Verrouiller » l'efface.
  Changer le mot de passe invalide automatiquement les clés mémorisées.
- Le fichier chiffré est public : choisir un mot de passe long (16 caractères minimum, imposé par le script).
- Un accès donné ne se retire pas : ce qui a été déchiffré a pu être copié. Changer le mot de passe protège les versions suivantes.

## Les données en clair

Elles vivent dans `private/`, **ignoré par Git** (`.gitignore`) et jamais publié :

```
private/family.json   personnes, unions, sources, réglages
private/places.json   lieux et coordonnées
private/notes.json    points à vérifier
```

Garder une sauvegarde de ce dossier hors du dépôt : sans lui, il faut repartir du fichier chiffré.

### Mettre à jour le site

```sh
# 1. modifier les fichiers de private/
# 2. chiffrer (le mot de passe est demandé deux fois)
node tools/encrypt.mjs
# 3. publier uniquement le fichier chiffré
git add data/vault.json && git commit -m "Mise à jour de l'arbre" && git push
```

Changer de mot de passe : relancer `node tools/encrypt.mjs` avec le nouveau, puis pousser.

### Format d'une personne (`private/family.json`)

```json
{
  "id": "prenom-nom",
  "given": "Prénom(s)",
  "surname": "Nom",
  "sex": "F",
  "birth": { "date": "1850-03-01", "place": "id-du-lieu" },
  "death": { "date": "1920" },
  "father": "id-du-pere",
  "mother": "id-de-la-mere",
  "status": "doc",
  "notes": "Texte libre"
}
```

- `date` : `AAAA`, `AAAA-MM` ou `AAAA-MM-JJ` ; pour une date républicaine, ajouter `"original": "1er vendémiaire an III"`.
- `status` : `doc` (acte ou relevé), `oral` (transmis sans acte), `unknown` (à rechercher).
- Un mariage se déclare dans `unions` : `{ "husband": "…", "wife": "…", "date": "…", "place": "…" }`.
- Un lieu (`private/places.json`) : `"id-du-lieu": { "name": "…", "dept": "…", "lat": 49.6, "lon": 0.7 }`,
  avec `"uncertain": true` pour l'afficher en pointillé.
- `settings.hideLivingDetails` masque en plus les dates et lieux des personnes vivantes, même après déverrouillage.

## Voir le site en local

```sh
python3 -m http.server 8000   # puis http://localhost:8000
```

## Publier sur famille.rospars.me

1. Rendre le dépôt public (ou utiliser GitHub Pro pour un dépôt privé).
2. Settings → Pages → « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. Le fichier `CNAME` contient déjà `famille.rospars.me`.
4. DNS de rospars.me : `famille  CNAME  brospars.github.io.`
5. Une fois le certificat émis, cocher « Enforce HTTPS ».

## Bibliothèques

- [d3](https://d3js.org) 7.9.0 (ISC) dans `vendor/d3`
- [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2) dans `vendor/leaflet`
- Fonds de carte © contributeurs OpenStreetMap
