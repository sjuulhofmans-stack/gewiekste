/*
  FIREBASE-INSTELLINGEN

  Plak hieronder de gegevens uit de Firebase-console:
  Projectinstellingen (tandwiel) -> "Je apps" -> web-app (</>) -> firebaseConfig.

  Deze gegevens zijn NIET geheim: ze staan altijd zichtbaar in een website.
  De echte beveiliging zit in de regels (firestore.rules).

  Zolang apiKey begint met "VUL", werkt de app LOKAAL (alleen in je eigen browser).
*/
window.GG_FIREBASE = {
  config: {
    apiKey: "AIzaSyBPindU-o9VuB7-5zHbLsKFxv1hFSPFx30",
    authDomain: "gewiekste-uitslagen.firebaseapp.com",
    projectId: "gewiekste-uitslagen",
    storageBucket: "gewiekste-uitslagen.firebasestorage.app",
    messagingSenderId: "129459625390",
    appId: "1:129459625390:web:08cdb2d30d66577631fc3f"
  },

  // Het Google-account van de beheerder (alleen dit account mag teams,
  // jokers en instellingen wijzigen). Moet hetzelfde zijn als in firestore.rules.
  beheerder: "sjuulhofmans@gmail.com"
};
