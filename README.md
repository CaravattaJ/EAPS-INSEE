# Veille Sports 21

Prototype sans installation et sans dépendance npm pour repérer les établissements sportifs récemment créés en Côte-d'Or.

## Lancer l'application

Sous Windows, double-cliquer sur `ouvrir-veille-sports.bat`. Il est également possible d'ouvrir directement `index.html` dans un navigateur récent. Aucun droit administrateur et aucune installation ne sont nécessaires.

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
- qualification locale et export CSV.

La recherche RNA par objet associatif n'est pas encore intégrée : elle nécessitera de confirmer la source et le format accessibles depuis le poste cible. L'adresse du siège d'une association ne doit pas être assimilée automatiquement à un lieu de pratique.

## Tests

```bash
npm test
```

La commande utilise uniquement le moteur de test inclus dans Node.js : `npm install` n'est pas nécessaire.
