# Gewiekste Uitslagen

Invul- en nakijkapp voor de stadskwis **Genneps Gewiekste**.
Het bestuur vult hier de vragen, antwoorden en scores in. De app rekent zelf de totalen, jokers en de einduitslag uit.
Alles wordt direct opgeslagen: er is geen opslaan-knop.

## Mappen en bestanden

| Bestand | Wat staat erin |
|---|---|
| `index.html` | De pagina zelf (laadt alle andere bestanden) |
| `css/style.css` | Kleuren, lettertypes en opmaak |
| `js/app.js` | De app: tabbladen, rekenen, invullen |
| `js/opslag.js` | Hoe gegevens bewaard worden (Firebase online, of lokaal om te testen) |
| `js/firebase-config.js` | **Hier vul je je Firebase-gegevens in** |
| `firestore.rules` | Beveiliging: wie mag wat. Plak je in de Firebase-console |
| `CLAUDE.md` | Uitleg voor Claude Code als je verder bouwt met AI |

## 1. Lokaal testen in VS Code

1. Pak de zip uit en open de map in VS Code (**Bestand → Map openen**).
2. Installeer de extensie **Live Server** (VS Code stelt dit zelf voor).
3. Klik rechtsonder op **Go Live**. De app opent in je browser.

Zolang Firebase niet is ingevuld, werkt de app **lokaal**: alles blijft alleen in jouw browser. Handig om te oefenen.

## 2. Firebase koppelen (online, gedeeld)

1. Ga naar <https://console.firebase.google.com> en maak een project (bijv. `gewiekste-uitslagen`).
2. **Build → Firestore Database → Database maken**, locatie `europe-west`, productiemodus.
3. **Build → Authentication → Aan de slag →** zet **Google** aan.
4. **Projectinstellingen (tandwiel) → Je apps → web (`</>`)**. Kopieer de `firebaseConfig` naar `js/firebase-config.js`.
5. **Firestore Database → Regels**: plak de inhoud van `firestore.rules` en klik **Publiceren**.
6. **Authentication → Instellingen → Geautoriseerde domeinen**: voeg `JOUWNAAM.github.io` toe (`localhost` staat er al).

Log daarna in als beheerder. Ga naar **Instellingen → Toegang bestuur** en zet daar de Google-adressen van de bestuursleden neer.

## 3. Online zetten met GitHub Pages

1. Zet de bestanden in je GitHub-repository (bijv. via **Source Control** in VS Code: *Commit* en *Push*).
2. Ga op GitHub naar de repository: **Settings → Pages → Branch: `main`, map `/ (root)` → Save**.
3. Na een minuut staat de app op `https://JOUWNAAM.github.io/REPONAAM/`.

## Spelregels in de app

- Elke rubriek heeft 7 vragen of opdrachten en maximaal 1000 punten (aan te passen bij Instellingen).
- Goed/fout-vragen: score van 0 tot het maximum van die regel. Deelpunten mogen.
- Creatieve opdrachten: meerdere juryleden geven een score. Het gemiddelde wordt naar boven afgerond.
- Joker: verdubbelt de score van één rubriek. Niet op de sponsorrubriek of de geheime opdracht.
- Gelijke stand: het team met de hoogste score op de creatieve opdrachten staat hoger.
