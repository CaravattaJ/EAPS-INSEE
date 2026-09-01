# Veille Sports 21

Prototype sans installation et sans dépendance npm pour repérer les établissements sportifs récemment créés en Côte-d'Or.

## Lancer l'application

Sous Windows, double-cliquer sur `ouvrir-veille-sports.bat`. Il est également possible d'ouvrir directement `index.html` dans un navigateur récent. Aucun droit administrateur et aucune installation ne sont nécessaires : l'application fonctionne sur un poste Windows standard sans droits administrateur (c'est un simple fichier HTML ouvert dans le navigateur).

> **Point à vérifier auprès de votre service informatique :** si un pare-feu ou un proxy d'entreprise bloque les appels sortants, il faudra faire autoriser les domaines suivants : `recherche-entreprises.api.gouv.fr`, `journal-officiel-datadila.opendatasoft.com`, `api-adresse.data.gouv.fr` (géolocalisation), ainsi que `unpkg.com` et `tile.openstreetmap.org` (bibliothèque et fond de carte).

`index.html` est autonome : sa mise en forme et son JavaScript sont intégrés dans le fichier. L'application continue donc de fonctionner même si `styles.css` ou `app.js` sont absents du dossier téléchargé.

Le JavaScript est chargé comme un script classique afin de fonctionner directement avec une adresse `file:///...`. Il ne faut pas ajouter `type="module"` au script : Chrome bloque les modules locaux avec une erreur CORS lorsque la page n'est pas servie en HTTP.

L'application appelle l'API publique Recherche d'entreprises depuis le navigateur, conserve les résultats et décisions dans le stockage local du navigateur, et permet de sauvegarder un fichier CSV daté compatible avec Excel.

> Si la politique du navigateur bloque les appels réseau depuis un fichier local, le prototype peut être servi avec `python3 -m http.server 8080` sur une machine disposant déjà de Python, puis ouvert sur <http://127.0.0.1:8080>. Cette solution n'installe aucun paquet.

## Périmètre de cette version

- un ou plusieurs départements de Bourgogne-Franche-Comté, au choix (par défaut, seule la Côte-d'Or) ;
- établissements actifs ;
- reprise sur trente jours au premier lancement ; ensuite, chaque recherche revérifie aussi les 15 jours précédant la dernière recherche, pour absorber le délai de publication des données Sirene (une structure peut être indexée plusieurs jours après sa création réelle) ;
- appels API séquentiels et nouvelle tentative automatique lorsque la source répond `429` ;
- détection des associations lorsque l'information est fournie par l'API ;
- recherche automatique complémentaire des créations d'associations au **Journal officiel des associations (JOAFE)**, en plus des codes NAF Sirene ;
- import local d'un export CSV du RNA, filtré sur la Côte-d'Or, la période et l'absence de dissolution, en complément (facultatif) ;
- qualification locale et sauvegarde en CSV.

### L'API Sirene ne filtre pas par date : recherche complète avec estimation de durée

Découverte importante (vérifiée sur la spécification officielle `openapi.json` de l'API Recherche d'entreprises) : **cette API ne propose aucun paramètre de filtre ni de tri par date de création**. Le paramètre `date_creation_min` qui semblait fonctionner dans une version précédente de l'application n'avait en réalité aucun effet — il était silencieusement ignoré par le serveur. L'application a donc toujours dû, et doit encore, parcourir **toutes les pages** de résultats de chaque code NAF/mot-clé pour ne rien manquer, puis filtrer les dates elle-même après coup.

Pour un code très courant (ex. `93.12Z` sur toute la Bourgogne-Franche-Comté), cela peut représenter plusieurs milliers de pages. Avant de lancer une recherche, l'application mesure donc désormais le nombre de pages réellement nécessaires et, si c'est significatif (plus de 40 pages), affiche une estimation de durée et demande confirmation avant de continuer — vous pouvez annuler et réduire la période ou le nombre de départements sélectionnés. En dessous de ce seuil, la recherche démarre directement sans interruption.

### Recherche automatique au Journal officiel des associations (JOAFE)

En plus de Sirene, chaque clic sur « Rechercher les nouveautés » interroge aussi l'**API publique du Journal officiel des associations** (`journal-officiel-datadila.opendatasoft.com`, jeu de données `jo_associations`), gratuite et sans clé, pour récupérer les créations d'associations en Côte-d'Or publiées depuis la date choisie. C'est la source la plus fraîche disponible : les annonces y apparaissent en général quelques jours après leur publication, bien avant que le fichier RNA (mis à jour périodiquement) ne les intègre.

Le niveau de confiance suit la même logique que pour le RNA : la catégorie d'activité renvoyée par le Journal officiel (`domaine_activite_categorise`) utilise la même nomenclature que WALDEC (préfixe `11000/` pour la famille « Sports, activités de plein air », équivalent du préfixe WALDEC `011`) et donne une confiance Élevée ; à défaut, un mot-clé sportif dans l'objet donne une confiance Moyenne ; sans aucun indice, la ligne reste visible en confiance Faible.

L'import RNA manuel reste utile en complément (recoupement, données plus anciennes), mais n'est plus la seule source pour les associations : sans lui, la recherche automatique couvre déjà les nouvelles créations.

### Libellé des codes NAF et description de l'activité

Le tableau des résultats affiche désormais, en plus du code NAF, le libellé correspondant (ex. « Activités de clubs de sports (93.12Z) ») pour les structures issues de Sirene. Une colonne « Description » complète l'information avec le texte libre de l'objet de l'association tel que publié au Journal officiel (source JOAFE), quand il est disponible ; Sirene ne fournit pas de description libre au niveau de l'établissement, la colonne reste alors vide (« — »).

### Codes NAF surveillés et raison de leur inclusion/exclusion

| Code | Libellé | Décision | Raison |
|---|---|---|---|
| 93.11Z | Gestion d'installations sportives | Inclus — confiance Élevée | Activité directement sportive |
| 93.12Z | Activités de clubs de sports | Inclus — confiance Élevée | Activité directement sportive |
| 93.13Z | Activités des centres de culture physique | Inclus — confiance Élevée | Activité directement sportive |
| 93.19Z | Autres activités liées au sport | Inclus — confiance Élevée | Activité directement sportive |
| 85.51Z | Enseignement de disciplines sportives et d'activités de loisirs | Inclus — confiance Moyenne | Peut aussi couvrir du loisir non sportif |
| 93.29Z | Autres activités récréatives et de loisirs | Inclus — confiance Faible | Catégorie résiduelle (peut inclure escape games, laser game...) mais peut aussi couvrir des structures de loisir sportif non classées ailleurs ; cohérent avec l'objectif de ne rien manquer |
| 93.21Z | Services de parcs et plages | Exclu | Gestion de parcs/plages, pas de pratique sportive encadrée |
| 96.04Z | Entretien corporel | Exclu | Bien-être/esthétique, pas une activité sportive |
| 91.02Z | Gestion des musées | Exclu | Sans rapport avec le sport |

### Recherche complémentaire par mot-clé

En plus des codes NAF ci-dessus, une recherche complémentaire est faite sur l'API Recherche d'entreprises avec le mot-clé « sport » dans le nom de l'entreprise (paramètre `q`, sans filtre d'activité), pour rattraper les structures dont le code NAF est mal renseigné à la création. Les résultats obtenus uniquement par ce biais (code NAF non reconnu comme sportif) sont classés en confiance Faible.

### Fiabilité affichée (niveau de confiance)

Le niveau de confiance affiché est un indice de pertinence automatique, il ne remplace jamais la qualification de l'agent :
- **Élevée** : code NAF directement sportif (`93.11Z` à `93.19Z`), ou association ayant déclaré un objet social sportif reconnu (nomenclature WALDEC, voir ci-dessous) ;
- **Moyenne** : enseignement sportif/loisir (`85.51Z`), ou mot-clé sportif détecté dans le nom/l'objet ;
- **Faible** : catégorie résiduelle (`93.29Z`), résultat obtenu seulement par le mot-clé complémentaire sur Sirene, ou association de Côte-d'Or dans la période mais sans indice sportif détecté automatiquement — à vérifier par l'agent avant d'écarter, ces lignes ne sont plus supprimées automatiquement.

### Import RNA et nomenclature WALDEC

L'import RNA accepte les noms de colonnes courants des exports officiels (`id`, `titre`, `objet`, `date_creat`, `date_disso`, `adrs_codepostal`, `adrs_libcommune`, `objet_social1`, `objet_social2`). Le fichier sélectionné est traité par le navigateur et n'est envoyé à aucun serveur. L'adresse du siège d'une association ne doit pas être assimilée automatiquement à un lieu de pratique.

Les colonnes `objet_social1` et `objet_social2` portent l'objet social de l'association selon la **nomenclature WALDEC** du ministère de l'Intérieur (codes à 6 chiffres). Tout code commençant par `011` appartient à la famille « Sports, activités de plein air » (ex. `011075` football, `011140` judo, `011125` natation, `011190` gestion d'équipements sportifs...) et donne une confiance Élevée. Si ces colonnes sont absentes ou vides dans l'export, l'application se rabat sur une recherche de mots-clés sportifs dans le titre/l'objet (confiance Moyenne). Les associations de Côte-d'Or dans la période, non dissoutes, mais sans aucun de ces deux indices sont désormais conservées avec une confiance Faible plutôt que d'être écartées silencieusement.

**Deux formats d'export officiels existent, avec des noms de colonnes différents** (fiche technique du ministère de l'Intérieur, `RNA_Liste_donnees_diffusees`) :
- `rna_waldec_...` (situation actuelle) : commune = `adrs_libcommune`.
- `rna_import_...` (historique cumulatif) : commune = `libcom`, et la date de création vaut `0001-01-01` quand elle est inconnue (l'application traite alors cette date comme absente, sans exclure la ligne).

L'application reconnaît les deux formats. Si un fichier utilise des noms de colonnes différents de ceux attendus (code postal, titre), un message d'erreur explicite liste les colonnes détectées dans le fichier, pour diagnostiquer rapidement un export non reconnu plutôt que d'afficher silencieusement 0 résultat.

**Délai de mise à jour du RNA :** l'export RNA n'est pas mis à jour en temps réel. Une association tout juste publiée au Journal officiel peut ne pas encore apparaître dans l'export téléchargé le même mois — c'est un délai propre à la source, pas un bug de l'application. En cas de doute, comparez la date de votre export avec la date de publication au Journal officiel des associations que vous consultez.

**Date de création utilisée :** l'application utilise `date_creat` (date de dépôt du dossier en Préfecture), avec repli sur `date_publi` (date de publication au Journal officiel de l'avis de création) si `date_creat` est absente. Elle n'utilise **jamais** `date_decla` (date de la *dernière* déclaration, ex. changement de bureau ou d'adresse) comme date de création : une association ancienne peut avoir une déclaration très récente sans être nouvelle, ce qui la ferait apparaître à tort comme une création récente. Quand aucune date de création fiable n'est disponible dans le fichier, la ligne reste visible (avec une date affichée « — ») plutôt que d'être perdue silencieusement.

### Doublons entre Sirene et le fichier RNA

La fusion automatique des résultats se fait sur le SIRET (ou le numéro RNA à défaut). Une association présente à la fois dans les résultats Sirene et dans un import RNA sans SIRET renseigné dans l'export apparaît donc comme deux lignes distinctes. Pour limiter le risque d'oubli, l'application compare aussi le nom et le code postal des associations : en cas de correspondance probable, un avertissement « Peut-être déjà vue ailleurs » s'affiche sur la ligne RNA concernée, pointant vers l'autre ligne — sans jamais fusionner automatiquement (pour éviter de mélanger deux structures différentes portant un nom proche).

### Dates de création postérieures à aujourd'hui

L'INSEE enregistre parfois une « date de création » qui correspond à une date de début d'activité **déclarée à l'avance** par le créateur (ex. immatriculation en juillet avec un début d'activité prévu en septembre). Ces structures apparaissent donc dans les résultats avant que la date en question soit atteinte. L'application ne les exclut pas (l'objectif reste de ne rien manquer), mais affiche un repère « Date à venir — pas encore en activité » sur ces lignes pour que l'agent sache qu'un contrôle sur place risque d'être prématuré.

### Recherches successives : rien n'est perdu si vous changez la date

À chaque nouvelle recherche, les structures déjà connues (Sirene ou RNA) sont conservées même si la nouvelle date choisie est plus tardive que celle d'une recherche précédente — seules les décisions déjà prises restent inchangées, la liste ne fait que grandir. Vous pouvez donc utiliser la recherche Sirene et l'import RNA dans l'ordre que vous voulez, aussi souvent que vous voulez : les deux sources se combinent toujours automatiquement.

### Décisions par structure, et liste partagée entre agents

Chaque structure a de nouveau une décision (menu déroulant : À qualifier, À contrôler, Déjà connu, Pas un lieu de pratique, Hors périmètre). Au premier changement de décision sur un poste, l'application demande une fois le nom ou les initiales de l'agent (mémorisé ensuite sur ce poste) ; chaque décision garde ensuite trace de qui l'a prise et quand (affiché sous le menu, et exporté dans le CSV).

Pour travailler à plusieurs sur le même espace de veille, sans serveur ni base de données commune, le fonctionnement est **volontairement le même pour tout le monde, sur tous les navigateurs** (Chrome, Edge, Firefox...) :
- **« Charger le partage »** ouvre un fichier `veille-sports-partage.json` (par exemple depuis un dossier réseau partagé) et fusionne son contenu avec vos résultats locaux : rien n'est perdu, et pour chaque structure connue des deux côtés, c'est la décision la **plus récente** (par date, peu importe qui l'a prise) qui est conservée.
- **« Enregistrer le partage »** télécharge un fichier `veille-sports-partage.json` avec l'ensemble de vos structures et décisions actuelles, à déposer manuellement dans le dossier partagé (en écrasant l'ancien).

Le réflexe à prendre : charger le partage avant de commencer à qualifier des structures, et l'enregistrer en fin de session (ou après un lot de décisions), pour rester synchronisé avec vos collègues.

> Une version précédente proposait, en plus, une liaison automatique du dossier partagé sur Chrome/Edge (rechargement/réenregistrement sans clic, sauvegardes horodatées, détection des écritures concurrentes). Elle a été retirée : le comportement différait selon le navigateur et créait un risque de confusion (deux systèmes de partage à comprendre selon le poste). Le fonctionnement manuel, identique partout, est plus simple à expliquer et à vérifier pour l'agent.

**Limite à connaître** : il n'y a aucun verrou. Si deux agents enregistrent presque simultanément sans avoir rechargé entre-temps, le second fichier déposé remplace le premier dans le dossier partagé (même si la fusion interne des décisions, elle, reste correcte tant que chacun recharge avant de modifier). D'où l'importance du réflexe charger/enregistrer ci-dessus.

### Réinitialisation des données locales

Chaque navigateur (Chrome, Firefox...), sur chaque poste, garde ses propres résultats et décisions en mémoire locale (`localStorage`) — ce sont des espaces de stockage totalement indépendants les uns des autres, même sur le même ordinateur. L'application ne les vide jamais toute seule : au démarrage, elle affiche systématiquement ce qui a été accumulé lors des recherches précédentes sur ce navigateur.

Le bouton **« Réinitialiser les données locales »** (dans le bloc Aide) vide ce stockage local — après confirmation, en rappelant de sauvegarder sur le partage avant si besoin. Il ne touche jamais au fichier partagé réseau : après une réinitialisation, cliquer sur « Charger le partage » permet de retrouver les données communes de l'équipe.

### Alertes de fraîcheur

Deux avertissements s'affichent indépendamment si vous n'avez pas relancé les recherches depuis plus de 10 jours : un pour la recherche automatique (Sirene), un pour l'import manuel du fichier RNA.

### Départements et évolution régionale

Le menu déroulant « Départements » (à côté du champ de date) permet de cocher un ou plusieurs départements parmi les huit de la région Bourgogne-Franche-Comté (21, 25, 39, 58, 70, 71, 89, 90). Par défaut, seule la Côte-d'Or (21) est sélectionnée. La sélection est mémorisée d'une session à l'autre. Les recherches Sirene et Journal officiel interrogent tous les départements choisis en un seul appel ; l'import RNA filtre également sur ces départements. Attention : plus vous sélectionnez de départements, plus le nombre de pages à parcourir augmente (voir la section sur l'estimation de durée ci-dessus).

### Carte et géolocalisation

Une carte (fond OpenStreetMap, bibliothèque Leaflet) affiche les structures actuellement visibles à l'écran (elle respecte le filtre de recherche et la case « Masquer les « Faible » », mais montre toutes les pages, pas seulement la page affichée). Un point coloré par niveau de confiance apparaît pour chaque structure dont la position est connue :
- Sirene fournit directement les coordonnées de l'établissement ;
- le Journal officiel fournit directement les coordonnées de l'association (`geo_point`) ;
- pour un import RNA (qui ne contient pas de coordonnées), l'application géolocalise chaque nouvelle association au niveau de sa commune via l'**API Adresse (BAN)** du gouvernement (`api-adresse.data.gouv.fr`, gratuite et sans clé). Cette position est celle du centre de la commune, pas l'adresse exacte du siège.

Une structure sans position connue (échec de géolocalisation, commune non reconnue) n'apparaît simplement pas sur la carte — elle reste visible normalement dans le tableau.

### Pagination

Le tableau affiche 25 résultats par page, avec des boutons Précédent/Suivant et un indicateur de page sous le tableau. Changer le filtre, le tri, la case « Masquer les « Faible » » ou relancer une recherche/un import ramène automatiquement à la première page.

### Autres sources envisagées, non encore intégrées

Le Recensement des équipements sportifs (RES, `equipements.sports.gouv.fr`) recense les lieux de pratique physiques et pourrait servir de recoupement supplémentaire (un équipement récent sans structure exploitante identifiée serait un signal à vérifier). Cette piste n'a pas encore été implémentée : la structure exacte d'un export RES Côte-d'Or (colonnes disponibles, présence ou non d'une date exploitable) doit être vérifiée sur un fichier réel avant de développer cette fonctionnalité.

### Interface : une page organisée par priorité d'usage

L'application reste une page unique, mais organisée pour que le geste quotidien (choisir une date, lancer la recherche, traiter les résultats) reste toujours visible en haut, tandis que ce qui ne sert qu'occasionnellement est replié par défaut dans trois blocs distincts (dépliables au clic) :

- **Équipe** — partage du fichier commun avec les collègues.
- **Carte** — localisation des structures détectées.
- **Aide** — explications détaillées (couverture de la recherche, calcul du niveau de confiance, limites connues), regroupées en un seul endroit plutôt que dispersées sous forme de notes au fil de la page.

Les textes visibles (boutons, libellés, messages) ont été raccourcis pour rester directs (« Importer RNA », « Exporter en CSV », « Lier le partage (auto) »...) ; les explications plus longues qui existaient auparavant en permanence à l'écran ont été déplacées dans le bloc Aide, accessible à la demande sans encombrer l'écran principal.

La palette de couleurs a aussi été revue (bleu pour l'action principale, teal pour distinguer les blocs secondaires, rouge/ambre réservés aux niveaux de confiance et aux alertes) pour mieux hiérarchiser visuellement l'écran.

## Tests

```bash
npm test
```

La commande utilise uniquement le moteur de test inclus dans Node.js : `npm install` n'est pas nécessaire. Après une modification de `index.template.html`, `styles.css` ou `app.js`, lancer `npm run build` pour régénérer le fichier autonome `index.html`.
