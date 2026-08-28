# Veille Sports 21

Prototype sans installation et sans dépendance npm pour repérer les établissements sportifs récemment créés en Côte-d'Or.

## Lancer l'application

Sous Windows, double-cliquer sur `ouvrir-veille-sports.bat`. Il est également possible d'ouvrir directement `index.html` dans un navigateur récent. Aucun droit administrateur et aucune installation ne sont nécessaires : l'application fonctionne sur un poste Windows standard sans droits administrateur (c'est un simple fichier HTML ouvert dans le navigateur).

> **Point à vérifier auprès de votre service informatique :** si un pare-feu ou un proxy d'entreprise bloque les appels sortants, il faudra faire autoriser le domaine `recherche-entreprises.api.gouv.fr` (seule dépendance réseau de l'application).

`index.html` est autonome : sa mise en forme et son JavaScript sont intégrés dans le fichier. L'application continue donc de fonctionner même si `styles.css` ou `app.js` sont absents du dossier téléchargé.

Le JavaScript est chargé comme un script classique afin de fonctionner directement avec une adresse `file:///...`. Il ne faut pas ajouter `type="module"` au script : Chrome bloque les modules locaux avec une erreur CORS lorsque la page n'est pas servie en HTTP.

L'application appelle l'API publique Recherche d'entreprises depuis le navigateur, conserve les résultats et décisions dans le stockage local du navigateur, et permet de sauvegarder un fichier CSV daté compatible avec Excel.

> Si la politique du navigateur bloque les appels réseau depuis un fichier local, le prototype peut être servi avec `python3 -m http.server 8080` sur une machine disposant déjà de Python, puis ouvert sur <http://127.0.0.1:8080>. Cette solution n'installe aucun paquet.

## Périmètre de cette version

- département 21 ;
- établissements actifs ;
- reprise sur trente jours au premier lancement ; ensuite, chaque recherche revérifie aussi les 15 jours précédant la dernière recherche, pour absorber le délai de publication des données Sirene (une structure peut être indexée plusieurs jours après sa création réelle) ;
- appels API séquentiels et nouvelle tentative automatique lorsque la source répond `429` ;
- détection des associations lorsque l'information est fournie par l'API ;
- recherche automatique complémentaire des créations d'associations au **Journal officiel des associations (JOAFE)**, en plus des codes NAF Sirene ;
- import local d'un export CSV du RNA, filtré sur la Côte-d'Or, la période et l'absence de dissolution, en complément (facultatif) ;
- qualification locale et sauvegarde en CSV.

### Recherche automatique au Journal officiel des associations (JOAFE)

En plus de Sirene, chaque clic sur « Rechercher les nouveautés » interroge aussi l'**API publique du Journal officiel des associations** (`journal-officiel-datadila.opendatasoft.com`, jeu de données `jo_associations`), gratuite et sans clé, pour récupérer les créations d'associations en Côte-d'Or publiées depuis la date choisie. C'est la source la plus fraîche disponible : les annonces y apparaissent en général quelques jours après leur publication, bien avant que le fichier RNA (mis à jour périodiquement) ne les intègre.

Le niveau de confiance suit la même logique que pour le RNA : la catégorie d'activité renvoyée par le Journal officiel (`domaine_activite_categorise`) utilise la même nomenclature que WALDEC (préfixe `11000/` pour la famille « Sports, activités de plein air », équivalent du préfixe WALDEC `011`) et donne une confiance Élevée ; à défaut, un mot-clé sportif dans l'objet donne une confiance Moyenne ; sans aucun indice, la ligne reste visible en confiance Faible.

L'import RNA manuel reste utile en complément (recoupement, données plus anciennes), mais n'est plus la seule source pour les associations : sans lui, la recherche automatique couvre déjà les nouvelles créations.

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

### Alertes de fraîcheur

Deux avertissements s'affichent indépendamment si vous n'avez pas relancé les recherches depuis plus de 10 jours : un pour la recherche automatique (Sirene), un pour l'import manuel du fichier RNA.

### Autres sources envisagées, non encore intégrées

Le Recensement des équipements sportifs (RES, `equipements.sports.gouv.fr`) recense les lieux de pratique physiques et pourrait servir de recoupement supplémentaire (un équipement récent sans structure exploitante identifiée serait un signal à vérifier). Cette piste n'a pas encore été implémentée : la structure exacte d'un export RES Côte-d'Or (colonnes disponibles, présence ou non d'une date exploitable) doit être vérifiée sur un fichier réel avant de développer cette fonctionnalité.

## Tests

```bash
npm test
```

La commande utilise uniquement le moteur de test inclus dans Node.js : `npm install` n'est pas nécessaire. Après une modification de `index.template.html`, `styles.css` ou `app.js`, lancer `npm run build` pour régénérer le fichier autonome `index.html`.
