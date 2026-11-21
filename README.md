# Harta locațiilor de filmare (Luna)

Site static (GitHub Pages) cu harta Moldovei și locațiile de filmare găsite de Luna.

**Datele sunt criptate.** Tot ce e în `data/` e text cifrat cu AES-256-GCM; cheia se obține din parolă cu
PBKDF2-SHA256 (600.000 de iterații, sare aleatorie din `data/meta.json`). Decriptarea se face doar în browser
(WebCrypto). Fără parolă, fișierele de aici nu dezvăluie nici locațiile, nici pozele. Parola nu e în acest repo.

- `index.html`, `assets/` — aplicația (hartă Leaflet, card, pagina locației). Datele sunt afișate doar ca text (fără HTML).
- `vendor/leaflet/` — Leaflet 1.9.4 (licență BSD-2, vezi `LICENSE`), inclus local: fără scripturi de pe alte servere.
- `data/` — scris DOAR de Luna (`core/MapSite.ps1` din `luna-vps`), un commit la fiecare actualizare.

Hărți de fundal: © OpenStreetMap, Esri World Imagery, © OpenTopoMap.
