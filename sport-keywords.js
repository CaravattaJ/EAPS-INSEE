// Mots-clés utilisés pour repérer un lien avec le sport dans le nom ou l'objet d'une
// association, quand aucun code officiel (WALDEC pour le RNA, famille 11000/ pour le Journal
// officiel) ne le confirme déjà — voir findSportKeywords() dans app.js. Un mot-clé trouvé ici
// donne une confiance "Moyenne", jamais "Élevée" : c'est une déduction depuis du texte libre,
// pas une déclaration officielle catégorisée.
//
// Construite à partir de la liste officielle des fédérations sportives agréées par le
// ministère des Sports (sports.gouv.fr) : une entrée par discipline reconnue, sous sa forme
// française la plus courante. Un seul orthographe par mot-clé suffit (accentuée ou non) :
// normalizeText retire les accents des deux côtés de la comparaison, donc "karaté" et
// "karate" sont déjà équivalents — inutile de lister les deux formes.
//
// Pour ajouter ou retirer une discipline : modifier la liste ci-dessous, relancer
// `npm test` (le test "finds sports keywords..." vérifie le comportement), puis
// `npm run build` pour régénérer index.html.
//
// Chargé comme un script classique (pas de import/export) afin de fonctionner directement
// avec une adresse file:///... comme le reste de l'application — voir README.md.
const SPORT_KEYWORDS = [
  "sport",
  // Sports collectifs et de raquette
  "football", "futsal", "rugby", "handball", "basket", "volley", "hockey", "water-polo",
  "baseball", "softball", "cricket", "bowling", "quilles", "ball-trap", "kin-ball", "frisbee",
  "tennis", "badminton", "squash", "ping-pong",
  // Sports de combat
  "judo", "karaté", "aïkido", "boxe", "kickboxing", "muay thaï", "taekwondo", "jujitsu", "kendo", "full-contact",
  // Gymnastique, force, danse
  "gymnastique", "fitness", "musculation", "haltérophilie", "trampoline", "danse",
  // Sports nautiques
  "natation", "plongée", "canoë", "kayak", "aviron", "voile", "surf", "wakeboard",
  // Cyclisme
  "cyclisme", "vtt", "bmx",
  // Équitation
  "équitation",
  // Plein air et montagne
  "randonnée", "escalade", "spéléologie", "parapente", "planeur", "parachutisme",
  "pelote basque", "pêche", "course d'orientation", "golf",
  // Athlétisme et sports d'endurance
  "athlétisme", "triathlon", "pentathlon",
  // Sports d'hiver
  "ski", "snowboard", "patinage",
  // Sports de précision
  "pétanque", "tir à l'arc", "tir sportif",
  // Autres disciplines reconnues
  "échecs", "handisport", "karting", "roller", "skateboard"
];

globalThis.SPORT_KEYWORDS = SPORT_KEYWORDS;
