/* Nova — lecteur des webradios Radio Nova.
 *
 * Contraintes qui expliquent la plupart des choix ci-dessous :
 *  - la PWA est servie en HTTPS, donc tous les flux doivent être en HTTPS et
 *    répondre 200 sans redirection (les mounts `*-128.mp3` de la plupart des
 *    stations renvoient un 302 vers du HTTP, ils sont inutilisables ici) ;
 *  - iOS ignore audio.volume, il n'y a donc pas de réglage de volume ;
 *  - un flux live coupé ne se rétablit jamais tout seul : on recrée la source.
 */

'use strict';

const STATIONS = [
  {
    id: 'nova', logo: 'logos/nova.png', thumb: 'thumbs/nova.png', name: 'Radio Nova', tagline: 'Le grand mix', accent: '#e5352a', meta: true,
    url: 'https://radionova.ice.infomaniak.ch/radionova-256.aac',
    fallback: 'https://novazz.ice.infomaniak.ch/novazz-128.mp3',
  },
  {
    id: 'nouvo', logo: 'logos/nouvo.png', thumb: 'thumbs/nouvo.png', name: 'Nouvo Nova', tagline: 'Les nouveautés', accent: '#f0e04f',
    url: 'https://nova-nouvo.ice.infomaniak.ch/nova-nouvo-256.aac',
    fallback: 'https://nova-nouvo.ice.infomaniak.ch/nova-nouvo-128.mp3',
  },
  {
    id: 'classics', logo: 'logos/classics.png', thumb: 'thumbs/classics.png', name: 'Nova Classics', tagline: 'Les classiques', accent: '#cf2b22',
    url: 'https://nova-vnt.ice.infomaniak.ch/nova-vnt-256.aac',
    fallback: 'https://nova-vnt.ice.infomaniak.ch/nova-vnt-128.mp3',
  },
  {
    id: 'danse', logo: 'logos/danse.png', thumb: 'thumbs/danse.png', name: 'Nova Danse', tagline: 'Club & électro', accent: '#8537ff',
    url: 'https://nova-dance.ice.infomaniak.ch/nova-dance-256.aac',
    fallback: 'https://nova-dance.ice.infomaniak.ch/nova-dance-128.mp3',
  },
  {
    id: 'hiphop', logo: 'logos/hiphop.png', thumb: 'thumbs/hiphop.png', name: 'Nova Hip-Hop', tagline: 'Rap & beats', accent: '#c25a25',
    url: 'https://nova-odn.ice.infomaniak.ch/nova-odn-256.aac',
    fallback: 'https://nova-odn.ice.infomaniak.ch/nova-odn-128.mp3',
  },
  {
    id: 'nuit', logo: 'logos/nuit.png', thumb: 'thumbs/nuit.png', name: 'Nova La Nuit', tagline: 'Nocturne', accent: '#6b6fe8',
    url: 'https://nova-ln.ice.infomaniak.ch/nova-ln-256.aac',
    fallback: 'https://nova-ln.ice.infomaniak.ch/nova-ln-128.mp3',
  },
  {
    id: 'reggae', logo: 'logos/reggae.png', thumb: 'thumbs/reggae.png', name: 'Nova Reggae', tagline: 'Dub & roots', accent: '#4a8a5c',
    url: 'https://nova-reggae.ice.infomaniak.ch/nova-reggae-256.aac',
    fallback: 'https://nova-reggae.ice.infomaniak.ch/nova-reggae-128.mp3',
  },
  {
    id: 'soul', logo: 'logos/soul.png', thumb: 'thumbs/soul.png', name: 'Nova Soul', tagline: 'Soul & funk', accent: '#f79a2e',
    url: 'https://nova-soul.ice.infomaniak.ch/nova-soul-256.aac',
    fallback: 'https://nova-soul.ice.infomaniak.ch/nova-soul-128.mp3',
  },
  {
    id: 'plage', logo: 'logos/plage.png', thumb: 'thumbs/plage.png', name: 'Nova La Plage', tagline: 'Saisonnière', accent: '#a7d5e0',
    url: 'https://novalaplage.ice.infomaniak.ch/nova-plage-128.mp3',
  },
];

/* Titres de l'antenne principale. CORS ouvert, aucun backend requis.
 *
 * Attention à ce que fournit réellement nova.fr : ce fil n'est PAS un « titre
 * en cours ». Il est alimenté au rythme d'environ une entrée par jour, et il
 * ne porte aucune date — impossible de savoir, depuis lui seul, si son premier
 * élément passe maintenant ou date d'une semaine. Affiché tel quel à côté de
 * l'indicateur « en direct », il finit par annoncer un titre périmé.
 *
 * D'où le second point d'entrée, daté, qui sert uniquement de garde : en
 * dessous de META_MAX_AGE on affiche le titre, au-delà on retombe sur
 * l'identité de la station. Si Nova rétablit un jour un vrai flux temps réel,
 * l'affichage se réactive tout seul.
 *
 * Le point d'entrée par webradio (/mobile-app/v1/cqct/<slug>) exige une
 * authentification (401) : les huit autres stations n'affichent que leur nom.
 */
const META_URL = 'https://www.nova.fr/wp-json/radio-tracks/v1/latests';
const META_DATE_URL =
  'https://www.nova.fr/wp-json/wp/v2/radio-track?per_page=1&orderby=date&order=desc&_fields=date_gmt';
const META_MAX_AGE = 30 * 60 * 1000; // au-delà, le titre n'est plus crédible
const META_INTERVAL = 20000;

const MAX_BACKOFF = 20000;
const STALL_GRACE = 8000; // délai avant de considérer un blocage comme une coupure

const $ = (id) => document.getElementById(id);
const el = {
  stationName: $('stationName'), stations: $('stations'),
  brandThumb: $('brandThumb'), brandLetter: $('brandLetter'),
  art: $('art'), artImg: $('artImg'), artFallback: $('artFallback'), backdropArt: $('backdropArt'),
  trackArtist: $('trackArtist'), trackTitle: $('trackTitle'), trackLink: $('trackLink'),
  playBtn: $('playBtn'), stopBtn: $('stopBtn'), status: $('status'), statusText: $('statusText'),
  sleepBtn: $('sleepBtn'), sleepBadge: $('sleepBadge'), sleepSheet: $('sleepSheet'),
  toast: $('toast'),
};

const audio = new Audio();
audio.preload = 'none';
audio.crossOrigin = null;
// Rattaché au document : iOS associe plus fiablement sa session « en cours de
// lecture » (écran verrouillé, Centre de contrôle) à un élément du DOM.
// Synchrone : le script est chargé en fin de <body>, qui existe donc déjà.
(document.body || document.documentElement).appendChild(audio);

// Déclare à iOS qu'il s'agit d'audio de lecture, et non d'un son d'interface.
// Conséquences concrètes : la lecture continue en arrière-plan et écran
// verrouillé, et elle ignore le bouton silencieux du téléphone.
// Safari 16.4+ ; ailleurs, l'absence de l'API est sans conséquence.
function claimAudioSession() {
  try {
    if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
  } catch (_) {}
}
claimAudioSession();

const state = {
  station: null,
  wantPlaying: false,   // intention de l'utilisateur, pas l'état réel du <audio>
  hadAudio: false,      // du son est-il déjà sorti depuis le dernier load() ?
  attempts: 0,          // échecs consécutifs, remis à zéro dès qu'un son sort
  gen: 0,               // n° du chargement en cours, incrémenté par loadAndPlay
  reconnectGen: -1,     // génération pour laquelle une reconnexion est déjà partie
  currentUrl: '',       // URL du chargement en cours, unique grâce à l'anti-cache
  useFallback: false,
  track: null,
  sleepUntil: 0,
};

let reconnectTimer = null;
let stallTimer = null;
let metaTimer = null;
let sleepTimer = null;
let toastTimer = null;
let watchdog = null;

/* ------------------------------------------------------------------ lecture */

function streamUrl(station) {
  const base = (state.useFallback && station.fallback) ? station.fallback : station.url;
  // Un flux live ne doit jamais être resservi depuis le cache : sans ce
  // paramètre, Safari peut reprendre un buffer périmé après une coupure.
  return base + (base.includes('?') ? '&' : '?') + 'nc=' + Date.now();
}

function selectStation(station, { autoplay = false } = {}) {
  const changed = state.station?.id !== station.id;
  state.station = station;
  state.useFallback = false;
  state.attempts = 0;
  state.track = null;

  document.documentElement.style.setProperty('--accent', station.accent);
  document.documentElement.style.setProperty('--accent-ink', inkFor(station.accent));
  el.stationName.textContent = station.name;

  // Initiale de secours, visible tant que la miniature n'est pas chargée et
  // définitivement si elle échoue.
  const initial = station.name.replace(/^Nova\s+|^Radio\s+/i, '').charAt(0) || 'N';
  el.artFallback.textContent = initial;
  el.brandLetter.textContent = initial;
  setBrandThumb(station);
  renderStations();
  renderTrack();

  try { localStorage.setItem('nova.station', station.id); } catch (_) {}

  if (changed || autoplay) {
    if (state.wantPlaying || autoplay) start();
    else setStatus('idle', 'Prêt');
  }
  refreshMeta();
}

function start() {
  if (!state.station) return;
  claimAudioSession(); // (re)pris dans le geste utilisateur, c'est là qu'iOS l'accorde
  clearTimeout(reconnectTimer);
  state.reconnectGen = -1;
  state.wantPlaying = true;
  setStatus('loading', 'Connexion');
  setPlayMode('loading');
  setStopVisible(true);
  loadAndPlay();
  startWatchdog();
}

// load() sur un élément en cours de lecture émet un « pause » : le drapeau
// hadAudio évite que ce pause volontaire soit pris pour une coupure de flux.
function loadAndPlay() {
  state.gen += 1; // nouvelle génération de chargement (voir scheduleReconnect)
  state.hadAudio = false;
  state.currentUrl = streamUrl(state.station);
  audio.src = state.currentUrl;
  audio.load();
  audio.play().catch((err) => {
    // NotAllowedError = pas de geste utilisateur ; inutile de réessayer en boucle.
    if (err && err.name === 'NotAllowedError') {
      state.wantPlaying = false;
      setStatus('idle', 'Touchez pour lancer');
      setPlayMode('paused');
      return;
    }
    scheduleReconnect();
  });
  armStallWatch();
}

// Coupe le son et libère le flux. On vide la source dans les deux cas : il n'y
// a aucune raison de continuer à télécharger un direct que personne n'écoute.
function releaseStream() {
  state.wantPlaying = false;
  state.hadAudio = false;
  state.reconnectGen = -1;
  clearTimeout(reconnectTimer);
  clearTimeout(stallTimer);
  clearInterval(watchdog);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

// Pause : la station reste affichée et l'app reste présente sur l'écran
// verrouillé, d'où la lecture peut être relancée.
function pause() {
  releaseStream();
  setPlayMode('paused');
  setStatus('idle', 'En pause');
  updateMediaSession();
}

// Arrêt complet : en plus de la pause, retire l'app de l'écran verrouillé et du
// Centre de contrôle, et annule le minuteur de veille devenu sans objet.
function stop() {
  releaseStream();
  setSleep(0, { silent: true });
  setStopVisible(false);
  setPlayMode('paused');
  setStatus('idle', 'Arrêté');
  clearMediaSession();
}

function toggle() {
  if (state.wantPlaying) pause();
  else start();
}

// Un flux figé n'émet pas toujours d'événement : on vérifie que currentTime
// avance réellement, plutôt que de se fier au seul drapeau `paused`.
function armStallWatch() {
  clearTimeout(stallTimer);
  const mark = audio.currentTime;
  stallTimer = setTimeout(() => {
    if (!state.wantPlaying) return;
    if (audio.paused || audio.currentTime === mark) scheduleReconnect();
  }, STALL_GRACE);
}

// Filet de sécurité : iOS n'émet pas toujours 'error'/'stalled' quand l'app
// revient d'une longue mise en veille.
function startWatchdog() {
  clearInterval(watchdog);
  let last = -1;
  watchdog = setInterval(() => {
    if (!state.wantPlaying) return;
    const now = audio.currentTime;
    if (state.hadAudio && !audio.paused && now === last) scheduleReconnect();
    last = now;
  }, 10000);
}

function scheduleReconnect() {
  if (!state.wantPlaying) return;

  // Une même coupure émet plusieurs événements ('error', 'pause', 'stalled').
  // On n'accepte qu'une reconnexion par génération de chargement : les doublons
  // sont ignorés, mais l'échec d'une re-tentative (qui a, lui, incrémenté la
  // génération) passe et fait bien escalader le backoff.
  // Un simple verrou booléen ne suffisait pas : relâché trop tôt, il laissait
  // une seconde reconnexion avorter la première alors qu'elle allait aboutir.
  if (state.reconnectGen === state.gen) return;
  state.reconnectGen = state.gen;

  clearTimeout(reconnectTimer);
  clearTimeout(stallTimer);

  state.attempts += 1;
  // Après deux échecs, on tente le mount de secours (MP3 128) de la station.
  if (state.attempts >= 3 && state.station.fallback && !state.useFallback) {
    state.useFallback = true;
    toast('Passage au flux de secours');
  }

  // La première tentative est immédiate, et surtout : sans minuteur. iOS gèle
  // les setTimeout en arrière-plan mais continue d'exécuter les gestionnaires
  // d'événements média — c'est donc le seul chemin de reconnexion qui puisse
  // aboutir écran verrouillé. Les tentatives suivantes repassent en backoff,
  // ce qui borne cette voie rapide à un seul essai par coupure (`attempts` ne
  // retombe à zéro que sur un 'playing' réussi).
  if (state.attempts === 1) {
    setStatus('loading', 'Reconnexion…');
    setPlayMode('loading');
    loadAndPlay();
    return;
  }

  const delay = Math.min(1000 * Math.pow(1.7, state.attempts - 1), MAX_BACKOFF);
  state.reconnectAt = Date.now() + delay;
  setStatus('error', navigator.onLine ? 'Reconnexion…' : 'Hors ligne');
  setPlayMode('loading');

  reconnectTimer = setTimeout(() => {
    if (state.wantPlaying) loadAndPlay();
  }, delay);
}

// Les événements média sont livrés en file d'attente : ceux d'un chargement
// abandonné arrivent APRÈS le début du suivant. Un simple drapeau ne survit pas
// à ce réordonnancement — un 'playing' périmé faisait passer le 'pause' du
// nouveau chargement pour une pause utilisateur, ce qui coupait la radio à
// chaque changement de station (de façon intermittente).
// L'URL, elle, est unique à chaque chargement grâce au paramètre anti-cache.
// Attention à la portée de ce test : il répond à « l'élément est-il sur cette
// source ? », pas à « cet événement concerne-t-il cette source ? ». Un
// événement périmé, traité après que la source a changé, le passe donc.
const isCurrentSource = () => audio.currentSrc === state.currentUrl;

// D'où ce second garde-fou pour 'playing'. load() remet synchroniquement
// readyState à 0 : un 'playing' resté en file depuis le chargement précédent
// est donc forcément vu avec un readyState bas, alors qu'un vrai 'playing'
// exige HAVE_FUTURE_DATA. Sans ce test, un 'playing' périmé remettait
// hadAudio à true, et le 'pause' émis par notre propre load() était alors pris
// pour une pause utilisateur : changer de station en cours d'écoute coupait le
// son au lieu de suivre sur la nouvelle station.
const isStaleMediaEvent = () => audio.readyState < 3;

audio.addEventListener('playing', () => {
  if (!isCurrentSource() || isStaleMediaEvent()) return;
  clearTimeout(stallTimer);
  // Une reconnexion planifiée pendant la coupure doit être annulée : sans ça,
  // elle se déclenche après le rétablissement et relance un flux déjà sain,
  // ce qui provoque une coupure d'une à deux secondes en pleine écoute.
  clearTimeout(reconnectTimer);
  state.attempts = 0;
  state.hadAudio = true;
  setPlayMode('playing');
  setStatus('live', 'En direct');
  updateMediaSession();
  refreshMeta();
});

audio.addEventListener('waiting', () => {
  if (!state.wantPlaying || !isCurrentSource()) return;
  setPlayMode('loading');
  setStatus('loading', 'Mise en mémoire tampon');
  armStallWatch();
});

audio.addEventListener('pause', () => {
  if (!state.wantPlaying || !isCurrentSource()) return;
  if (!state.hadAudio) return; // pause provoquée par notre propre load()

  // Une coupure réseau laisse une trace : erreur, tampon vide, ou perte de
  // connectivité. On reconnecte.
  if (audio.error || audio.readyState < 3 || !navigator.onLine) {
    scheduleReconnect();
    return;
  }

  // Sinon la pause vient du système : Centre de contrôle, écran verrouillé,
  // écouteurs débranchés, appel entrant. Relancer ici ferait redémarrer la
  // radio toute seule dans la poche de l'utilisateur — on obéit. C'est une
  // pause, pas un arrêt : le bouton d'arrêt reste offert.
  pause();
});

audio.addEventListener('error', () => {
  if (state.wantPlaying && isCurrentSource()) scheduleReconnect();
});
audio.addEventListener('ended', () => {
  if (state.wantPlaying && isCurrentSource()) scheduleReconnect();
});
audio.addEventListener('stalled', () => {
  if (state.wantPlaying && isCurrentSource()) armStallWatch();
});

// 'online' est un événement, pas un minuteur : il passe donc en arrière-plan.
// On teste aussi readyState, car un flux coupé peut rester « non-paused » tout
// en ayant un tampon vide.
window.addEventListener('online', () => {
  if (state.wantPlaying && (audio.paused || audio.readyState < 3)) {
    state.attempts = 0;
    start();
  }
});
window.addEventListener('offline', () => {
  if (state.wantPlaying) setStatus('error', 'Hors ligne');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  // iOS gèle les minuteurs en arrière-plan : le chien de garde n'a pas pu
  // tourner pendant tout ce temps. Au retour, on rattrape nous-mêmes.
  if (state.wantPlaying) {
    if (audio.paused) {
      state.attempts = 0;
      start();
    } else {
      // Flux « zombie » : l'élément se croit en lecture mais rien n'avance.
      const mark = audio.currentTime;
      setTimeout(() => {
        if (state.wantPlaying && document.visibilityState === 'visible'
            && !audio.paused && audio.currentTime === mark) {
          scheduleReconnect();
        }
      }, 1500);
      startWatchdog();
    }
  }

  refreshMeta(); // le titre a forcément changé pendant l'absence
});

/* ------------------------------------------------------------- métadonnées */

async function refreshMeta() {
  clearTimeout(metaTimer);
  const station = state.station;
  if (!station) return;

  if (!station.meta) {
    state.track = null;
    renderTrack();
    updateMediaSession();
    return;
  }

  // Inutile de solliciter l'API quand l'app est cachée et à l'arrêt — sauf s'il
  // n'y a encore rien à afficher, auquel cas on veut ce premier titre.
  if (!state.wantPlaying && state.track && document.visibilityState !== 'visible') {
    metaTimer = setTimeout(refreshMeta, META_INTERVAL);
    return;
  }

  try {
    // Le fil de titres de nova.fr ne porte aucune date : impossible de savoir,
    // depuis lui seul, si son premier élément passe à l'antenne maintenant ou
    // date d'il y a une semaine. On interroge donc d'abord le point d'entrée
    // daté, et on n'affiche un titre que s'il est réellement récent.
    const dated = await fetch(META_DATE_URL, { cache: 'no-store' });
    if (!dated.ok) throw new Error(dated.status);
    const posts = await dated.json();
    // date_gmt est en UTC mais sans suffixe de fuseau : sans le « Z », les
    // navigateurs l'interpréteraient en heure locale.
    const publishedAt = posts?.[0]?.date_gmt ? Date.parse(posts[0].date_gmt + 'Z') : NaN;
    const fresh = Number.isFinite(publishedAt) && (Date.now() - publishedAt) < META_MAX_AGE;

    if (!fresh) {
      // Rien de fiable à annoncer : on retombe sur l'identité de la station
      // plutôt que de présenter un vieux titre comme étant en cours.
      if (state.station?.id === station.id && state.track) {
        state.track = null;
        renderTrack();
        updateMediaSession();
      }
      return;
    }

    const res = await fetch(META_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const list = await res.json();
    const item = Array.isArray(list) ? list[0] : null;
    if (item && state.station?.id === station.id) {
      // Pas de `media_url` ici : la pochette du morceau n'est plus affichée,
      // l'image reste celle de la station (voir renderTrack).
      state.track = {
        artist: titleCase(item.artiste || ''),
        title: titleCase(item.titre || ''),
        link: item.deezer_url || item.spotify_url || null,
      };
      renderTrack();
      updateMediaSession();
    }
  } catch (_) {
    // Pas de métadonnées : l'app reste parfaitement utilisable sans.
  } finally {
    if (state.station?.id === station.id) {
      metaTimer = setTimeout(refreshMeta, META_INTERVAL);
    }
  }
}

// L'API renvoie tout en capitales, et joint les artistes par « [+] ».
function titleCase(str) {
  const lower = str.replace(/\s*\[\+\]\s*/g, ' & ').toLowerCase();

  // L'apostrophe n'est volontairement pas une frontière de mot : sinon
  // « i'm » deviendrait « I'M ».
  let out = lower.replace(/(^|[\s(\[\/\-–—])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

  // Élisions françaises, elles : « l'été » → « L'Été ».
  out = out.replace(/\b(l|d|j|n|s|c|m|t|qu)(['’])(\p{L})/giu,
    (_, pre, apo, ch) => pre + apo + ch.toUpperCase());

  return out;
}

/* -------------------------------------------------------------------- rendu */

// Les couleurs viennent des logos : certaines sont claires (jaune de Nouvo,
// bleu de La Plage) et illisibles sous du texte blanc. On choisit l'encre selon
// la luminosité perçue plutôt que d'imposer du blanc partout.
function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#17151a' : '#ffffff';
}

// Miniature de la station dans l'en-tête, avec repli sur l'initiale.
function setBrandThumb(station) {
  const src = station.thumb;
  if (!src || brokenArt.has(src)) {
    el.brandThumb.hidden = true;
    el.brandThumb.removeAttribute('src');
    el.brandLetter.hidden = false;
    return;
  }
  el.brandThumb.src = src;
  el.brandThumb.hidden = false;
  el.brandLetter.hidden = true;
}

el.brandThumb.addEventListener('error', () => {
  const src = el.brandThumb.getAttribute('src');
  if (!src) return;
  brokenArt.add(src);
  if (state.station) setBrandThumb(state.station);
});

function renderStations() {
  if (el.stations.children.length !== STATIONS.length) {
    el.stations.innerHTML = '';
    for (const s of STATIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tile';
      btn.dataset.id = s.id;
      btn.style.setProperty('--chip', s.accent);

      const art = document.createElement('span');
      art.className = 'tile-art';
      if (s.thumb) {
        const img = document.createElement('img');
        img.src = s.thumb;
        img.alt = '';
        img.loading = 'lazy';
        art.appendChild(img);
      }

      const name = document.createElement('span');
      name.className = 'tile-name';
      name.textContent = s.name;

      btn.append(art, name);
      // Un appui direct lance la station ; le glissement, lui, ne fait que
      // suivre l'état de lecture en cours (voir onTilesSettled).
      btn.addEventListener('click', () => selectStation(s, { autoplay: true }));
      el.stations.appendChild(btn);
    }
  }
  for (const btn of el.stations.children) {
    const active = btn.dataset.id === state.station?.id;
    btn.setAttribute('aria-current', active ? 'true' : 'false');
    if (active) centerTile(btn);
  }
}

/* Carrousel : la tuile immobilisée au centre devient la station courante.
 *
 * Le recentrage programmé déclenche lui aussi des événements 'scroll'. Sans
 * garde, il serait relu comme un geste de l'utilisateur et rappellerait
 * selectStation en boucle. La garde est une échéance plutôt qu'un booléen :
 * si le défilement n'a pas lieu (tuile déjà centrée), elle expire d'elle-même
 * au lieu de rester coincée et d'avaler le geste suivant. */
let tileSettleTimer = null;
let suppressTileSelectUntil = 0;

function centerTile(btn) {
  suppressTileSelectUntil = Date.now() + 700;
  const target = btn.offsetLeft + btn.offsetWidth / 2 - el.stations.clientWidth / 2;
  // Volontairement 'auto' et non 'smooth' : un défilement doux programmé est
  // annulé ici et ne bouge pas du tout, aimantation active ou non. Avec 'auto',
  // l'aimantation replace de toute façon la tuile exactement au centre.
  el.stations.scrollTo({ left: target, behavior: 'auto' });
}

function nearestTile() {
  const mid = el.stations.scrollLeft + el.stations.clientWidth / 2;
  let best = null;
  let bestGap = Infinity;
  for (const btn of el.stations.children) {
    const gap = Math.abs(btn.offsetLeft + btn.offsetWidth / 2 - mid);
    if (gap < bestGap) { bestGap = gap; best = btn; }
  }
  return best;
}

function onTilesSettled() {
  if (Date.now() < suppressTileSelectUntil) return;
  const btn = nearestTile();
  if (!btn || btn.dataset.id === state.station?.id) return;
  const station = STATIONS.find((s) => s.id === btn.dataset.id);
  // Glisser change de station sans forcer la lecture : si la radio jouait,
  // elle continue sur la nouvelle ; si elle était à l'arrêt, elle le reste.
  if (station) selectStation(station, { autoplay: state.wantPlaying });
}

el.stations.addEventListener('scroll', () => {
  clearTimeout(tileSettleTimer);
  // 'scrollend' n'est pas encore disponible partout (Safari récent seulement) :
  // on détecte l'immobilisation par absence d'événement, ce qui marche aussi
  // avec l'inertie de défilement d'iOS.
  tileSettleTimer = setTimeout(onTilesSettled, 150);
}, { passive: true });

function renderTrack() {
  const t = state.track;
  const s = state.station;

  el.trackArtist.textContent = t?.artist || s?.name || 'Radio Nova';
  el.trackTitle.textContent = t?.title || s?.tagline || '';

  if (t?.link) {
    el.trackLink.href = t.link;
    el.trackLink.hidden = false;
  } else {
    el.trackLink.hidden = true;
  }

  // L'image est TOUJOURS celle de la station, jamais la pochette du morceau.
  // C'est un choix explicite : l'identité visuelle de la radio reste stable
  // pendant l'écoute, au lieu de changer à chaque titre. Le repli sur
  // l'initiale ne sert que si le logo lui-même ne charge pas.
  const art = s?.logo && !brokenArt.has(s.logo) ? s.logo : null;

  // Les logos sont en portrait, avec leur contenu dans la moitié haute :
  // cadrés depuis le haut, rien d'important n'est rogné (voir styles.css).
  el.artImg.classList.toggle('is-logo', !!art);

  if (art) {
    el.artImg.src = art;
    el.artImg.hidden = false;
    el.artFallback.hidden = true;
    el.backdropArt.style.backgroundImage = `url("${art}")`;
    el.backdropArt.classList.add('on');
  } else {
    el.artImg.hidden = true;
    el.artImg.removeAttribute('src');
    el.artFallback.hidden = false;
    el.backdropArt.classList.remove('on');
  }
}

// Une image qui ne charge pas est mémorisée pour ne pas être retentée en
// boucle : le rendu suivant descend d'un niveau tout seul.
const brokenArt = new Set();

el.artImg.addEventListener('error', () => {
  const src = el.artImg.getAttribute('src');
  if (!src) return; // src vidé volontairement
  brokenArt.add(src);
  renderTrack();
});

function setStatus(kind, text) {
  el.status.dataset.state = kind;
  el.statusText.textContent = text;
}

function setPlayMode(mode) {
  el.playBtn.dataset.mode = mode;
  el.playBtn.setAttribute('aria-label', mode === 'playing' ? 'Pause' : 'Lecture');
}

// Le bouton d'arrêt n'apparaît que s'il y a quelque chose à arrêter : inutile
// d'afficher une commande morte au premier lancement.
function setStopVisible(visible) {
  el.stopBtn.hidden = !visible;
}

function toast(msg) {
  clearTimeout(toastTimer);
  el.toast.textContent = msg;
  el.toast.hidden = false;
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

/* ----------------------------------------------- contrôles écran verrouillé */

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const s = state.station;
  const t = state.track;
  if (!s) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t?.title || s.name,
      artist: t?.artist || s.tagline,
      album: 'Nova',
      // Comme à l'écran : toujours l'image de la station. L'écran verrouillé
      // doit montrer la même chose que l'app, pas une pochette de morceau.
      // MediaSession exige des URL absolues.
      artwork: s.logo
        ? [{ src: new URL(s.logo, location.href).href, sizes: '806x1000', type: 'image/png' }]
        : [
            { src: new URL('icons/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' },
            { src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' },
          ],
    });
    navigator.mediaSession.playbackState = state.wantPlaying ? 'playing' : 'paused';
  } catch (_) {}
}

// Retire l'app de l'écran verrouillé et du Centre de contrôle.
function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  } catch (_) {}
}

function hopStation(delta) {
  const i = STATIONS.findIndex((s) => s.id === state.station?.id);
  const next = STATIONS[(i + delta + STATIONS.length) % STATIONS.length];
  selectStation(next, { autoplay: state.wantPlaying });
}

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => start(),
    pause: () => pause(),  // bouton pause de l'écran verrouillé
    stop: () => stop(),    // fermeture de la session par le système
    previoustrack: () => hopStation(-1),
    nexttrack: () => hopStation(1),
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch (_) {}
  }
}

/* --------------------------------------------------------- minuteur de veille */

function setSleep(minutes, { silent = false } = {}) {
  clearInterval(sleepTimer);
  if (!minutes) {
    const wasSet = state.sleepUntil > 0;
    state.sleepUntil = 0;
    el.sleepBadge.hidden = true;
    if (!silent && wasSet) toast('Minuteur désactivé');
    return;
  }
  state.sleepUntil = Date.now() + minutes * 60000;
  el.sleepBadge.hidden = false;
  tickSleep();
  sleepTimer = setInterval(tickSleep, 1000);
  toast(`Arrêt dans ${minutes} min`);
}

function tickSleep() {
  const left = state.sleepUntil - Date.now();
  if (left <= 0) {
    clearInterval(sleepTimer);
    state.sleepUntil = 0;
    el.sleepBadge.hidden = true;
    stop();
    toast('Bonne nuit');
    return;
  }
  const mins = Math.ceil(left / 60000);
  el.sleepBadge.textContent = mins > 99 ? '99+' : String(mins);
}

function openSleepSheet() {
  const active = state.sleepUntil > 0;
  for (const b of el.sleepSheet.querySelectorAll('[data-sleep]')) {
    b.setAttribute('aria-pressed', 'false');
  }
  el.sleepSheet.hidden = false;
  if (!active) el.sleepSheet.querySelector('.sheet-cancel').setAttribute('aria-pressed', 'true');
}

el.sleepBtn.addEventListener('click', openSleepSheet);
el.sleepSheet.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-sleep]');
  if (opt) {
    setSleep(Number(opt.dataset.sleep));
    el.sleepSheet.hidden = true;
  } else if (e.target.closest('[data-close]')) {
    el.sleepSheet.hidden = true;
  }
});

/* ------------------------------------------------------------------ diagnostic
 * Ouvrir l'app avec #diag pour vérifier, sur l'appareil et sans Web Inspector,
 * les conditions de la lecture en arrière-plan.
 */

function renderDiag() {
  const standalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;

  let sessionType = '—';
  let hasSession = false;
  try {
    hasSession = 'audioSession' in navigator;
    if (hasSession) sessionType = navigator.audioSession.type;
  } catch (_) {}

  const rows = [
    ['Lancée depuis l\'écran d\'accueil', standalone, standalone ? 'oui' : 'non'],
    ['API audioSession (iOS 16.4+)', hasSession, hasSession ? 'présente' : 'absente'],
    ['Session en mode « playback »', sessionType === 'playback', sessionType],
    ['MediaSession (écran verrouillé)', 'mediaSession' in navigator, 'mediaSession' in navigator ? 'oui' : 'non'],
    ['Contexte sécurisé', window.isSecureContext, location.protocol.replace(':', '')],
    ['Élément audio dans le DOM', document.body.contains(audio), String(document.body.contains(audio))],
  ];

  const box = document.createElement('div');
  box.className = 'diag';
  box.innerHTML = '<h2>Diagnostic arrière-plan</h2>'
    + rows.map(([label, ok, detail]) =>
        `<p class="${ok ? 'ok' : 'ko'}"><b>${ok ? '✓' : '✕'}</b> ${label}<span>${detail}</span></p>`).join('')
    + '<p class="diag-hint">Lancez la lecture, verrouillez l\'écran, attendez 30 s. '
    + 'Si le son continue, c\'est bon.</p>'
    + '<button type="button">Fermer</button>';

  box.querySelector('button').addEventListener('click', () => {
    box.remove();
    history.replaceState(null, '', location.pathname);
  });

  navigator.serviceWorker?.getRegistrations().then((regs) => {
    const ok = regs.length > 0;
    const p = document.createElement('p');
    p.className = ok ? 'ok' : 'ko';
    p.innerHTML = `<b>${ok ? '✓' : '✕'}</b> Service worker<span>${ok ? 'actif' : 'non enregistré'}</span>`;
    box.querySelector('.diag-hint').before(p);
  }).catch(() => {});

  document.body.appendChild(box);
}

if (location.hash === '#diag') renderDiag();
window.addEventListener('hashchange', () => {
  if (location.hash === '#diag' && !document.querySelector('.diag')) renderDiag();
});

/* ------------------------------------------------------------------ démarrage */

el.playBtn.addEventListener('click', toggle);
el.stopBtn.addEventListener('click', stop);

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowRight') hopStation(1);
  if (e.code === 'ArrowLeft') hopStation(-1);
});

let saved = null;
try { saved = localStorage.getItem('nova.station'); } catch (_) {}
selectStation(STATIONS.find((s) => s.id === saved) || STATIONS[0]);
setStatus('idle', 'Prêt');
setPlayMode('paused');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
