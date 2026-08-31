# Nova

PWA d'écoute des webradios de Radio Nova. Statique, sans dépendance, sans backend.

## Lancer en local

```bash
python3 -m http.server 8123
```

Puis <http://localhost:8123>. Le service worker exige un contexte sécurisé :
`localhost` en fait partie, mais **une IP locale type `192.168.x.x` non** — pour
tester depuis l'iPhone sur le réseau local, il faut passer par le déploiement
HTTPS ci-dessous.

## Déployer sur GitHub Pages

Le dépôt est <https://github.com/pedrolastiko/Nova-Direct>. Une fois les
modifications commitées :

```bash
git push origin main
```

Puis, une seule fois, dans le dépôt : **Settings → Pages → Source: Deploy from a
branch → `main` / `/ (root)`**. L'app est en ligne sous une minute à
<https://pedrolastiko.github.io/Nova-Direct/>.

Tous les chemins sont relatifs (`start_url: "."`, `register('sw.js')`), le
sous-répertoire du dépôt ne pose donc aucun problème.

## Installer sur l'iPhone

Ouvrir l'URL **dans Safari** (pas Chrome : lui ne sait pas installer de PWA sur
iOS), puis **Partager → Sur l'écran d'accueil**. L'app se lance ensuite en plein
écran, sans barre d'adresse.

## Choisir une station

Les neuf stations forment un carrousel de tuiles à aimantation, en bas de
l'écran. La tuile qui s'immobilise au centre devient la station courante ; elle
passe à pleine échelle et se cercle de sa couleur, les autres restent estompées.

Deux gestes, volontairement distincts :

| | Appui sur une tuile | Glissement |
|---|---|---|
| Change de station | oui | oui |
| Lance la lecture | oui | seulement si la radio jouait déjà |

Autrement dit, faire défiler les stations à l'arrêt n'allume pas la radio, et en
faire défiler pendant l'écoute enchaîne sans repasser par le bouton lecture.

Au clavier : les flèches ← et → changent de station, espace met en pause.

### Deux pièges de ce type de carrousel

- **La boucle de rétroaction.** Recentrer la tuile active provoque lui aussi des
  événements `scroll`, qui seraient relus comme un geste de l'utilisateur et
  rappelleraient la sélection en boucle. La garde est une **échéance** et non un
  booléen : si le défilement n'a pas lieu — tuile déjà centrée — elle expire
  d'elle-même au lieu de rester coincée et d'avaler le geste suivant.
- **La détection d'immobilisation.** `scrollend` n'est pas encore disponible
  partout, donc l'arrêt est détecté par absence d'événement `scroll` pendant
  150 ms. Cela fonctionne aussi avec l'inertie de défilement d'iOS, et évite de
  charger toutes les stations traversées pendant un geste rapide.
- **Le recentrage doit être instantané.** `scrollTo({behavior: 'smooth'})` ne
  défile pas du tout ici — mesuré : la position finale reste à 0, aimantation
  active ou non. Le recentrage utilise donc `behavior: 'auto'` ; l'aimantation
  replace de toute façon la tuile exactement au centre (écart mesuré : 0 px).
- **`offsetLeft` se mesure depuis l'`offsetParent`.** Le carrousel porte
  `position: relative` pour en être un. Sans ça, les tuiles se mesurent depuis
  `.app` et les calculs ne tombent juste que par coïncidence, tant que le
  carrousel commence à x=0.

## Pause et arrêt

Deux commandes distinctes, le petit bouton carré étant posé en pastille sur le
bord bas-droit du bouton principal :

| | Pause (bouton principal) | Arrêt (petit bouton) |
|---|---|---|
| Son | coupé | coupé |
| Flux réseau | libéré | libéré |
| Écran verrouillé | l'app y reste, relançable | l'app en disparaît |
| Minuteur de veille | conservé | annulé |
| État affiché | « En pause » | « Arrêté » |

Les deux libèrent le flux : il n'y a aucune raison de continuer à télécharger un
direct que personne n'écoute. La différence tient à la session média — après une
pause, la lecture peut repartir depuis les commandes de l'écran verrouillé ;
après un arrêt, l'app disparaît de l'écran verrouillé et du Centre de contrôle.

Le bouton d'arrêt n'apparaît qu'une fois la lecture lancée, pour ne pas afficher
une commande sans objet au premier démarrage.

## Les flux

Neuf webradios, toutes vérifiées en HTTPS avec réponse 200 directe.

| Station | Mount |
|---|---|
| Radio Nova | `radionova.ice.infomaniak.ch/radionova-256.aac` |
| Nouvo Nova | `nova-nouvo.ice.infomaniak.ch/nova-nouvo-256.aac` |
| Nova Classics | `nova-vnt.ice.infomaniak.ch/nova-vnt-256.aac` |
| Nova Danse | `nova-dance.ice.infomaniak.ch/nova-dance-256.aac` |
| Nova Hip-Hop | `nova-odn.ice.infomaniak.ch/nova-odn-256.aac` |
| Nova La Nuit | `nova-ln.ice.infomaniak.ch/nova-ln-256.aac` |
| Nova Reggae | `nova-reggae.ice.infomaniak.ch/nova-reggae-256.aac` |
| Nova Soul | `nova-soul.ice.infomaniak.ch/nova-soul-256.aac` |
| Nova La Plage | `novalaplage.ice.infomaniak.ch/nova-plage-128.mp3` |

Deux pièges, si vous ajoutez une station dans `STATIONS` (en haut de `app.js`) :

- **Le mount doit répondre 200 sans redirection.** La plupart des `*-128.mp3`
  renvoient un 302 vers `http://plainmaster.bcast.infomaniak.ch:8000`, donc vers
  du HTTP en clair, que Safari bloque depuis une page HTTPS. À vérifier avec
  `curl -s -D - -o /dev/null <url> | head -1`.
- Le nom du mount ne dit pas le format réel : `radionova-256.aac` sert en fait
  du MP3 128 kbps.

## Icône de l'app

L'icône officielle de Radio Nova — carré noir, « n » blanc — récupérée depuis
l'`apple-touch-icon` déclaré par nova.fr et conservée dans
`tools/nova-icon-source.png`. `tools/make-icons.py` en dérive les quatre
fichiers de `icons/`.

Deux traitements sont indispensables, et aucun n'est faisable avec `sips` :

- **Aplatissement sur noir.** La source a un canal alpha : ses coins arrondis
  sont transparents. Ils feraient des trous dans l'icône « maskable », qu'Android
  recadre lui-même. Et pour iOS on veut justement un carré plein bord à bord :
  iOS applique son propre arrondi, un arrondi déjà présent laisserait des angles
  morts visibles.
- **Zone de sécurité.** Android peut recadrer l'icône « maskable » jusqu'au
  cercle inscrit ; le contenu doit tenir dans les 80 % centraux. Le « n » est
  donc réduit à 66 % et recentré sur fond noir.

D'où le décodeur PNG minimal dans le script. Il ne gère que le RVBA 8 bits non
entrelacé — le format de la source — et **échoue explicitement** sur tout autre
format, plutôt que de produire une image fausse silencieusement.

> Le logo Nova est une marque de Radio Nova. Cet usage convient à un lecteur
> personnel ; ne redistribuez pas l'app comme si elle était officielle.

## Logos des stations

Les neuf logos officiels, récupérés depuis <https://www.nova.fr/radios/> et
stockés dans `logos/` (806×1000, ~460 Ko au total). Ils sont précachés par le
service worker, donc disponibles hors ligne.

**L'image affichée est toujours celle de la station**, jamais la pochette du
morceau — y compris sur l'antenne principale, et y compris si un titre récent
est disponible. C'est un choix délibéré : l'identité visuelle de la radio reste
stable pendant l'écoute au lieu de changer à chaque morceau. La même image
alimente l'arrière-plan flouté et l'écran verrouillé.

Le seul repli est l'**initiale de la station**, si le logo lui-même ne charge
pas. Une image en échec est mémorisée pour ne pas être retentée en boucle.

Quand un titre récent existe (voir la garde de fraîcheur plus bas), il n'apparaît
que sous forme de **texte** — artiste, titre et lien Deezer — sous l'image.

### Miniatures

`thumbs/` contient une miniature carrée de 128 px par station (96 Ko au total),
dérivée du logo correspondant. Elle remplace le monogramme « N » générique dans
l'en-tête, et bascule sur l'initiale de la station si elle ne charge pas.

Le cadrage est **le même que celui de la grande pochette** : la miniature en est
la réduction exacte, pas un cadrage différent. À 26 px le lettrage n'est pas
lisible — c'est la couleur qui identifie la station, et le nom est de toute
façon écrit juste à côté ; dès 44 px le lettrage redevient lisible.

Régénérer après un changement de logo :

```bash
sh tools/make-thumbs.sh
```

Le script n'utilise que `sips`, fourni par macOS. Il est déterministe : relancé
sur les mêmes logos, il produit des fichiers identiques.

### Détails de mise en œuvre

- Les logos sont en **portrait**, avec leur composition dans la moitié haute et
  le bas vide. Ils sont donc cadrés depuis le haut (`object-position: center
  top`) et non au centre : le lettrage reste entier et le vide part hors champ.
  Aucun fichier n'est recadré ni ré-encodé, tout se joue en CSS.
- Les **couleurs d'accent** sont reprises des logos. Certaines sont claires (le
  jaune de Nouvo, le bleu de La Plage) et deviendraient illisibles sous du texte
  blanc : l'encre posée sur un fond d'accent — monogramme de l'en-tête, badge du
  minuteur, option active du minuteur — est donc choisie selon la luminosité
  perçue de la couleur, au lieu d'être blanche partout (`inkFor` dans `app.js`).
- Les teintes ont été **arbitrées à l'œil**, pas appliquées telles quelles.
  L'extraction automatique se trompait : elle donnait du jaune pour Nova Reggae,
  dont le fond est vert, parce que le lettrage jaune sature davantage que le
  fond.

## Titres

`https://www.nova.fr/wp-json/radio-tracks/v1/latests` (CORS ouvert, aucun proxy
requis) fournit artiste, titre, pochette et lien Deezer.

**Ce n'est pas un flux « titre en cours ».** Il faut le savoir avant de bâtir
quoi que ce soit dessus :

- il est alimenté au rythme d'environ **une entrée par jour**, pas à chaque
  morceau ;
- il ne porte **aucune date**, donc rien en lui ne permet de distinguer un titre
  diffusé à l'instant d'un autre vieux d'une semaine ;
- il s'arrête pour de longues périodes. Constaté le 31/08/2026 : dernière
  entrée datée du 25/08, soit plus de cinq jours de retard.

Affiché tel quel à côté de l'indicateur « en direct », il finit donc
inévitablement par annoncer un morceau qui ne passe pas.

### La garde de fraîcheur

`https://www.nova.fr/wp-json/wp/v2/radio-track?per_page=1&orderby=date&order=desc&_fields=date_gmt`
renvoie la date de la dernière entrée en 38 octets. L'app l'interroge d'abord :

- entrée plus récente que `META_MAX_AGE` (30 min) → le titre est affiché ;
- sinon → repli sur le logo et le nom de la station.

En pratique le fil est aujourd'hui trop lent pour franchir ce seuil, donc l'app
affiche l'identité de la station. Si Nova rétablit un vrai flux temps réel,
l'affichage se réactive de lui-même, sans modification.

> `date_gmt` est en UTC mais **sans suffixe de fuseau** : il faut concaténer un
> « Z » avant de le parser, sinon les navigateurs l'interprètent en heure locale.

### Ce qui n'existe pas comme source de rechange

- **Métadonnées ICY du flux.** Les serveurs annoncent bien `icy-metaint: 16000`,
  mais Nova y envoie un titre vide (`StreamTitle='';`). Vérifié sur les mounts
  `radionova`, `nova-soul` et `nova-vnt`.
- **Point d'entrée par webradio.** `/wp-json/mobile-app/v1/cqct/<slug>` renvoie
  401 : réservé à l'application officielle.

Les huit autres stations n'affichent donc que leur identité, d'où le drapeau
`meta: true` sur la seule station `nova`.

## Résilience

Un flux live coupé ne se rétablit jamais tout seul, c'est le défaut principal des
lecteurs web. Le traitement :

- détection d'une coupure par `error`, `pause` involontaire, `ended`, et par un
  chien de garde qui vérifie toutes les 10 s que `currentTime` avance vraiment
  (iOS n'émet pas toujours d'événement) ;
- reconnexion en backoff exponentiel, plafonné à 20 s ;
- après 3 échecs, bascule sur le mount MP3 128 de secours de la station ;
- reconnexion immédiate au retour du réseau (`online`) et au retour au premier
  plan (`visibilitychange`) ;
- paramètre `?nc=<timestamp>` sur chaque connexion, sinon Safari peut reprendre
  un buffer périmé après une coupure.

Testé en conditions dégradées : mount volontairement invalide → détection,
backoff, bascule sur le flux de secours et retour à l'antenne en ~10 s.

## Lecture en arrière-plan

C'est l'exigence principale du projet. Quatre choix la servent :

1. **`navigator.audioSession.type = 'playback'`** (Safari 16.4+). Déclare à iOS
   qu'il s'agit d'audio de lecture et non d'un son d'interface. Conséquences :
   la lecture continue en arrière-plan et écran verrouillé, et elle ignore le
   bouton silencieux du téléphone. C'est le levier décisif.
2. **Élément `<audio>` classique, jamais l'API Web Audio.** Un `AudioContext`
   est suspendu par iOS dès la mise en arrière-plan — ce serait rédhibitoire.
   L'élément est aussi rattaché au DOM, ce à quoi iOS associe plus fiablement sa
   session « en cours de lecture ».
3. **MediaSession** avec métadonnées et gestionnaires play/pause/piste
   précédente/suivante, pour que l'écran verrouillé affiche la station et que
   ses boutons fonctionnent.
4. **Aucune pause sur `visibilitychange`.** Passer en arrière-plan ne déclenche
   rien du tout.

5. **Une voie de reconnexion sans minuteur.** iOS gèle les `setTimeout` en
   arrière-plan, mais continue d'exécuter les gestionnaires d'événements média
   et l'événement `online`. La première re-tentative après une coupure part donc
   immédiatement depuis le gestionnaire d'erreur, sans passer par un minuteur —
   c'est le seul chemin capable d'aboutir écran verrouillé. Les tentatives
   suivantes repassent en backoff, ce qui borne cette voie rapide à un essai par
   coupure. Mesuré : 1 ms entre l'erreur et la re-tentative, son rétabli 277 ms
   après la coupure.

Ce qui reste hors de portée, minuteurs gelés obligent : si la coupure résiste au
premier essai, les tentatives suivantes attendent le retour au premier plan. Le
titre affiché sur l'écran verrouillé ne se rafraîchit pas non plus pendant la
lecture en arrière-plan, pour la même raison.

### Vérifier sur l'iPhone

Ouvrir l'app avec `#diag` à la fin de l'URL. Le panneau contrôle les conditions
nécessaires — app lancée depuis l'écran d'accueil, API `audioSession` présente
et en mode `playback`, MediaSession, contexte sécurisé, service worker.

Puis le test qui compte : lancer la lecture, verrouiller l'écran, attendre 30 s.

### Si le son coupe quand même

Le projet reste en PWA, sans coquille native. Dans l'ordre, les causes réelles :

1. **L'app est ouverte dans un onglet Safari, pas depuis l'écran d'accueil.**
   C'est de loin la première cause. En onglet, iOS ne garantit rien ; en mode
   standalone, la session `playback` s'applique. Le panneau `#diag` le dit
   à la première ligne.
2. **iOS antérieur à 16.4** : `navigator.audioSession` n'existe pas, et avec
   elle le levier principal. Ligne 2 du diagnostic.
3. **Mode économie d'énergie actif** : iOS y restreint l'activité en
   arrière-plan de façon plus agressive. À tester une fois désactivé.
4. **Éviction pour pression mémoire** : après un long moment en arrière-plan
   avec d'autres apps gourmandes, iOS peut décharger la PWA. Rien à faire côté
   web ; au relancement, la dernière station est restaurée.

Si le son tient écran verrouillé mais s'arrête après une coupure réseau
prolongée en arrière-plan, ce n'est pas un défaut de configuration : c'est la
limite des minuteurs gelés décrite plus haut. La lecture repart au retour au
premier plan.

## Non vérifiable en local

L'API `navigator.audioSession` n'existe que dans WebKit : elle est absente des
navigateurs basés sur Chromium, où le panneau `#diag` la signalera donc comme
absente. C'est attendu — seul un vrai Safari fait foi.

L'enregistrement du service worker est également bloqué par certains panneaux de
prévisualisation intégrés, alors que le script est servi correctement (200, type
MIME `text/javascript`, syntaxe valide, contexte sécurisé). À confirmer dans
Safari une fois déployé.

> En développement local, `python3 -m http.server` laisse le navigateur mettre
> `app.js` et `styles.css` en cache : après modification, forcer un rechargement
> sans cache, sinon vous testerez l'ancienne version.

## Ce qu'il n'y a volontairement pas

- **Réglage du volume** : iOS ignore `audio.volume`, seuls les boutons physiques
  agissent. Un curseur à l'écran serait mort-né.
- **Historique des titres** : l'API le permettrait (elle renvoie les derniers
  passages), à ajouter si le besoin se confirme.

## Fichiers

```
index.html             structure
styles.css             thème sombre unique
app.js                 lecteur, reconnexion, métadonnées, carrousel, minuteur
sw.js                  cache de la coque (n'intercepte jamais flux ni API)
manifest.webmanifest   installation
icons/                 icônes de l'app, dérivées de l'icône officielle Nova
logos/                 logos des stations (806×1000, ~460 Ko)
thumbs/                miniatures 128 px, dérivées des logos (~96 Ko)
tools/make-icons.py    génère icons/ — Python seul, sans dépendance
tools/nova-icon-source.png  icône officielle Nova, source des icônes
tools/make-thumbs.sh   génère thumbs/ — sips seul, fourni par macOS
```

Les deux générateurs sont déterministes et sans dépendance externe : relancés
sur les mêmes sources, ils produisent des fichiers identiques.

```bash
python3 tools/make-icons.py    # après un changement de couleur de marque
sh tools/make-thumbs.sh        # après un remplacement de logo
```

Le service worker précache la coque, les neuf logos et les neuf miniatures.
**Après tout ajout d'un fichier à `SHELL`, incrémenter `CACHE` dans `sw.js`** —
sans ça, les visiteurs déjà installés gardent l'ancienne liste.

## Licence

Le **code** de ce dépôt — `index.html`, `styles.css`, `app.js`, `sw.js`,
`manifest.webmanifest` et les scripts de `tools/` — est publié sous licence MIT
(voir `LICENSE`).

**La licence MIT ne s'étend pas aux éléments de marque de Radio Nova** présents
dans le dépôt, qui restent leur propriété et sont seulement redistribués ici
pour identifier les stations dans le lecteur :

- `logos/` — visuels des neuf webradios ;
- `thumbs/` — miniatures dérivées de ces mêmes visuels ;
- `tools/nova-icon-source.png` et `icons/` — icône officielle et ses déclinaisons.

Ces fichiers proviennent de <https://www.nova.fr>. Ce projet est un lecteur
personnel, sans lien avec Radio Nova ; ne le redistribuez pas comme s'il était
officiel.
