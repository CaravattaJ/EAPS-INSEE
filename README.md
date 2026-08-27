# Veille Sports 21

Prototype sans installation et sans dépendance npm pour repérer les établissements sportifs récemment créés en Côte-d'Or.

## Lancer l'application

Sous Windows, double-cliquer sur `ouvrir-veille-sports.bat`. Il est également possible d'ouvrir directement `index.html` dans un navigateur récent. Aucun droit administrateur et aucune installation ne sont nécessaires.

`index.html` est autonome : sa mise en forme et son JavaScript sont intégrés dans le fichier. L'application continue donc de fonctionner même si `styles.css` ou `app.js` sont absents du dossier téléchargé.

Le JavaScript est chargé comme un script classique afin de fonctionner directement avec une adresse `file:///...`. Il ne faut pas ajouter `type="module"` au script : Chrome bloque les modules locaux avec une erreur CORS lorsque la page n'est pas servie en HTTP.

L'application appelle l'API publique Recherche d'entreprises depuis le navigateur, conserve les résultats et décisions dans le stockage local du navigateur, et exporte un fichier CSV compatible avec Excel.

> Si la politique du navigateur bloque les appels réseau depuis un fichier local, le prototype peut être servi avec `python3 -m http.server 8080` sur une machine disposant déjà de Python, puis ouvert sur <http://127.0.0.1:8080>. Cette solution n'installe aucun paquet.

## Périmètre de cette première version

- département 21 ;
- établissements actifs ;
- activités NAF `93.11Z`, `93.12Z`, `93.13Z`, `93.19Z` et `85.51Z` ;
- reprise sur trente jours au premier lancement ;
- recouvrement de cinq jours après une synchronisation ;
- appels API séquentiels et nouvelle tentative automatique lorsque la source répond `429` ;
- détection des associations lorsque l'information est fournie par l'API ;
- import local d'un export CSV du RNA, filtré sur la Côte-d'Or, la période, l'absence de dissolution et des mots-clés sportifs dans le titre ou l'objet ;
- qualification locale et export CSV.

Le niveau de confiance affiché est un indice de pertinence : il est élevé pour les codes NAF directement sportifs (`93.11Z` à `93.19Z`) et moyen pour l'enseignement sportif ou de loisir (`85.51Z`). Il ne remplace jamais la qualification de l'agent.

L'import RNA accepte les noms de colonnes courants des exports officiels (`id`, `titre`, `objet`, `date_creat`, `date_disso`, `adrs_codepostal`, `adrs_libcommune`). Le fichier sélectionné est traité par le navigateur et n'est envoyé à aucun serveur. L'adresse du siège d'une association ne doit pas être assimilée automatiquement à un lieu de pratique.

## Tests

```bash
npm test
```

La commande utilise uniquement le moteur de test inclus dans Node.js : `npm install` n'est pas nécessaire. Après une modification de `index.template.html`, `styles.css` ou `app.js`, lancer `npm run build` pour régénérer le fichier autonome `index.html`.
