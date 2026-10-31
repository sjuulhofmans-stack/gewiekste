# Projectcontext voor Claude

Invul- en nakijkapp voor de stadskwis Genneps Gewiekste (Gennep). In Gennep zeggen ze "kwis", niet "quiz".

## Over de gebruiker
- Heeft weinig tot geen codeerervaring en werkt met vibecoding.
- Praat altijd Nederlands met de gebruiker.
- Geef na een grotere wijziging aan het eind een korte, simpele uitleg zonder vaktaal.

## Techniek
- Gewone HTML, CSS en JavaScript. Geen build-stap, geen npm, geen framework. Openen met Live Server.
- Gehost op GitHub Pages; gegevens in Firebase Firestore; inloggen met Google (Firebase Auth, compat-SDK via gstatic).
- `js/opslag.js` levert een `db` met `doc(path).get/set/update/onSnapshot` en `collection(path).onSnapshot`. `update` = samenvoegen (merge). Zonder Firebase-config valt de app terug op localStorage.
- `js/app.js` bouwt de hele pagina opnieuw op via `render()` uit de toestand `S`; klikken en invoer lopen via `data-act`-attributen.

## Belangrijke regels
- Alles wordt direct opgeslagen; nooit een opslaan-knop toevoegen.
- Alle invulregels hebben overal precies dezelfde hoogte en breedte (tokens `--row`, `--rowT` in `css/style.css`).
- Gebruikers zijn deels ouder en niet snel: grote knoppen, duidelijke Nederlandse teksten, vaste plekken.
- Alleen de beheerder mag teams, jokers, instellingen en toegang wijzigen (ook afgedwongen in `firestore.rules`).
- Wijzig je het beheerder-e-mailadres, doe dat dan in `js/firebase-config.js` én in `firestore.rules`.
- Kleuren alleen via de tokens in `:root` (licht en donker thema).
