# Bambu Lab Discord Bot

Bot Discord pour notifications en temps réel de vos imprimantes 3D Bambu Lab.

## Description

Ce bot se connecte à vos imprimantes Bambu Lab via MQTT et envoie des notifications Discord automatiques pour :

- Démarrage d'impression
- Progression d'impression (par incréments configurables)
- Pause/Reprise d'impression
- Fin d'impression (succès ou échec)
- Arrêt d'impression

Les notifications concernées incluent des captures d'écran et des images de prévisualisation du projet.

## Fonctionnalités

- 🖨️ **Multi-imprimantes** : Gérez plusieurs imprimantes depuis un seul bot
- 📺 **Multi-channels** : Chaque imprimante peut avoir son propre forum channel
- 🏷️ **Tags automatiques** : Tags de statut et d'imprimante gérés automatiquement
- 📡 Connexion MQTT sécurisée avec validation du certificat Bambu Lab
- 📸 Captures d'écran automatiques via protocole natif Bambu et TLS vérifié
- 🖼️ Extraction et affichage des images de prévisualisation du projet
- 🔔 Notifications Discord riches avec embeds dans des forum threads
- 🔄 Reconnexion automatique en cas de perte de connexion
- 📨 File d'envoi persistante pour reprendre les notifications Discord après une erreur ou un redémarrage
- ⚙️ Configuration via commandes Discord slash

## Prérequis

- Node.js 24.x et pnpm 11 (`package.json` fixe actuellement pnpm 11.0.9)
- Une ou plusieurs imprimantes Bambu Lab sur votre réseau local
- Un bot Discord avec les permissions appropriées

### Ports réseau

Si le bot n'est pas exécuté localement (ex: serveur distant, Docker sur un autre réseau), assurez-vous que les ports
suivants sont accessibles vers vos imprimantes :

| Port | Protocole | Utilisation                                           |
| ---- | --------- | ----------------------------------------------------- |
| 8883 | TCP/TLS   | MQTT - Communication avec l'imprimante (configurable) |
| 6000 | TCP/TLS   | Caméra - Captures d'écran (configurable via rtc_port) |

## Installation

1. Clonez le dépôt :

```bash
git clone https://github.com/lachaux-remi/bambu-lab-discord.git
cd bambu-lab-discord
```

2. Installez les dépendances :

```bash
pnpm install
```

3. Créez un fichier `.env` à la racine du projet :

```env
# Token du bot Discord (requis)
DISCORD_BOT_TOKEN=votre_token_bot

# Clé AES-256 obligatoire dès qu'une imprimante est configurée
# Génération : openssl rand -base64 32
CONFIG_ENCRYPTION_KEY=votre_cle_base64_de_32_octets

# Personnalisation des notifications (optionnel, valeurs par défaut ci-dessous)
# Pourcentage : 1 à 100
NOTIFICATION_PERCENT=5
NOTIFICATION_FOOTER_TEXT=Bambu Lab Discord
NOTIFICATION_FOOTER_ICON=
NOTIFICATION_COLOR=#24a543

# Délais opérationnels (optionnel)
# Résumé des erreurs MQTT répétées : 1 à 1440 minutes
ERROR_LOG_COOLDOWN_MINUTES=1
# Délai de connexion MQTT en ms (1000 à 300000, défaut 30000 si invalide)
MQTT_CONNECT_TIMEOUT_MS=30000
# Extinction après une impression : 0 à 1440 minutes
CHAMBER_LIGHT_OFF_DELAY_MINUTES=5
# Attente avant une capture après allumage : 0 à 60000 ms
CHAMBER_LIGHT_WARMUP_MS=1500

# Validation des certificats MQTT et caméra (laisser désactivé)
BAMBU_TLS_INSECURE=false

# Mode debug (optionnel)
DEBUG=false

# Format des logs : auto (lisible sur terminal local, JSON sinon), pretty ou json
LOG_FORMAT=auto
```

Par défaut, les logs utilisent une présentation lisible dans un terminal local et restent en JSON structuré en
production ou lorsque la sortie n'est pas un TTY (notamment sous Docker). `LOG_FORMAT=pretty` ou `LOG_FORMAT=json`
permet de forcer explicitement le format.

Lorsqu'une imprimante déjà connectée devient indisponible, MQTT continue de tenter une reconnexion toutes les 5
secondes. Les trois premiers échecs sont journalisés immédiatement, puis les erreurs sont regroupées au maximum une fois
par `ERROR_LOG_COOLDOWN_MINUTES` (minimum et défaut : 1 minute). La reconnexion produit un résumé de la coupure et des
échecs masqués.

## Configuration du Bot Discord

1. Créez une application sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Créez un bot et copiez le token
3. Activez les intents nécessaires : `GUILDS`, `GUILD_MESSAGES`
4. Invitez le bot sur votre serveur avec les permissions :

- Voir les channels
- Envoyer des messages, y compris dans les threads
- Créer des threads publics
- Gérer les threads
- Intégrer des liens et joindre des fichiers
- Gérer les channels (pour réconcilier les tags des forums)

## Commandes Slash

Une fois le bot démarré, utilisez ces commandes Discord :

| Commande                                                                      | Description                        |
| ----------------------------------------------------------------------------- | ---------------------------------- |
| `/printer add <name> <ip> <serial> <access_code> <channel> [port] [rtc_port]` | Ajouter et démarrer une imprimante |
| `/printer remove <name>`                                                      | Supprimer une imprimante           |
| `/printer list`                                                               | Lister les imprimantes configurées |
| `/printer status <name>`                                                      | Afficher l'état détaillé           |
| `/printer reconnect <name>`                                                   | Forcer une reconnexion immédiate   |
| `/printer edit <name> [options]`                                              | Modifier et activer/désactiver     |
| `/printer screenshot <name>`                                                  | Publier une capture caméra de test |

Toutes les commandes nécessitent la permission Discord **Gérer le serveur**. `/printer edit` peut modifier le nom,
l'adresse IP, le numéro de série, le code d'accès, le forum, les ports MQTT/RTC et l'état activé. Les changements réseau
d'une imprimante active sont appliqués immédiatement par un redémarrage de sa connexion. `/printer reconnect` redémarre
le client MQTT d'une imprimante activée sans modifier sa configuration.

### Exemple d'ajout d'imprimante

```
/printer add name:Imprimante Bureau ip:192.0.2.10 serial:VOTRE_NUMERO_DE_SERIE access_code:VOTRE_CODE_D_ACCES channel:#impressions-3d
```

## Captures d'écran (RTC)

Le bot capture des screenshots directement depuis vos imprimantes via le protocole natif Bambu Lab :

- Connexion TLS vérifiée sur le port 6000 de l'imprimante
- Pas de service externe nécessaire (ffmpeg, go2rtc, etc.)
- Utilise l'IP comme destination et le serial déjà configuré comme identité TLS

Pour les notifications automatiques et `/printer screenshot`, les captures d'une même imprimante sont sérialisées. Si
la lumière de la chambre est éteinte, le bot l'allume, attend `CHAMBER_LIGHT_WARMUP_MS`, puis restaure son état initial,
même en cas d'échec de la capture. Après la fin d'une impression, il programme son extinction au bout de
`CHAMBER_LIGHT_OFF_DELAY_MINUTES`; une nouvelle impression annule ce délai.

Pour tester les captures :

```bash
pnpm run debug:rtc
```

L'outil teste toutes les imprimantes configurées. Il peut aussi cibler directement une imprimante avec
`PRINTER_ADDRESS`, `PRINTER_ACCESS_CODE`, `PRINTER_SERIAL_NUMBER` et, si nécessaire, `PRINTER_RTC_PORT`. Chaque réussite
écrit un fichier brut `rtc-debug-<timestamp>.jpg` dans le répertoire courant, avec des permissions limitées au
propriétaire. Ce fichier est ignoré par Git, mais peut montrer l'intérieur de l'imprimante : vérifiez-le avant de le
partager. Contrairement aux captures pilotées par le bot, cet outil RTC direct ne commande pas la lumière.

Depuis Discord, `/printer screenshot <name>` capture une image réelle et crée une notification publique de test dans
le forum configuré pour l'imprimante. Cette commande nécessite la permission **Gérer le serveur** ou **Administrateur**.

## Capture de diagnostic MQTT

Renseignez `PRINTER_ADDRESS`, `PRINTER_ACCESS_CODE` et `PRINTER_SERIAL_NUMBER` dans `.env`; `PRINTER_PORT` est optionnel
et vaut 8883 par défaut. Ces variables sont réservées aux outils de diagnostic et ne remplacent pas la configuration
multi-imprimantes créée avec les commandes slash.

```bash
pnpm run debug:mqtt
```

Arrêtez le bot avant de lancer cette commande. Selon le modèle et le firmware, le broker de l'imprimante peut refuser
une seconde connexion MQTT simultanée ; le diagnostic afficherait alors des erreurs de connexion jusqu'à la fermeture
du premier client.

La commande affiche dans le terminal un résumé lisible des commandes, états, progressions et couches. Elle écrit en
parallèle `mqtt-debug-<timestamp>.ndjson` dans le répertoire courant : une ligne JSON compacte par message, avec
`timestamp`, `key` et `payload`, dans l'ordre de réception. Chaque ligne peut être parsée indépendamment et utilisée
directement comme fixture. Un message JSON invalide est remplacé par sa longueur et son SHA-256; son contenu brut n'est
jamais écrit.

La capture applique un filtre récursif fermé par défaut. Elle conserve la structure, les nombres, les booléens et une
liste minimale de valeurs textuelles du protocole nécessaires au diagnostic (commandes, états, résultats et états de
l'éclairage). Toute autre valeur textuelle est masquée ou reçoit un pseudonyme stable dérivé d'un sel aléatoire propre
à la capture. Les IP, serials, identifiants, noms de projets et chaînes inconnues restent ainsi corrélables pendant une
capture sans révéler leur valeur ; les credentials et URLs sont masqués.

Les variables de connexion, le broker et les topics ne sont jamais inclus dans le fichier ou les logs. Le fichier est
créé avec le mode `0600`, reste ignoré par Git et peut être partagé comme fixture sanitisée.

`pnpm run debug:discord-test` nécessite également `TEST_FORUM_CHANNEL_ID`. Il crée réellement un post de test public,
envoie un message et modifie ses tags dans ce forum ; ne l'utilisez pas sur un serveur où cet effet est indésirable.

## Validation TLS Bambu

Les connexions MQTT `mqtts` et caméra RTC vérifient automatiquement le certificat présenté par l'imprimante avec le
bundle CA public de Bambu Lab embarqué dans l'application. L'adresse IP reste la destination réseau et le serial de
l'imprimante est utilisé pour SNI et la vérification d'identité. Aucun certificat individuel ni autre champ de
configuration n'est demandé : les imprimantes déjà enregistrées et les nouvelles utilisent leur champ `serial`
existant. Les fichiers `printers.json` et `active-threads.json` ne sont ni migrés, ni réinitialisés, ni supprimés.

En dépannage temporaire uniquement, `BAMBU_TLS_INSECURE=true` désactive la validation des certificats pour MQTT et RTC.
Ce fallback est **dangereux et désactivé par défaut** : il permet une attaque de l'homme du milieu pouvant exposer le
code d'accès, les commandes de l'imprimante et le flux caméra. Un avertissement de sécurité très visible est loggué une
seule fois au démarrage lorsqu'il est activé. La variable accepte uniquement `true` ou `false`; toute autre valeur fait
échouer le chargement de la configuration TLS. Réactivez `BAMBU_TLS_INSECURE=false` dès le diagnostic terminé.

Le bundle couvre les autorités BBL d'origine et CA2 RSA/ECC actuellement publiées par BambuStudio. Une nouvelle CA ou
un nouveau modèle/firmware utilisant une autre chaîne nécessitera une mise à jour de ce bundle. Les ports pris en charge
restent les ports MQTT et RTC configurés pour l'imprimante (8883 et 6000 par défaut). La provenance, la licence amont et
les empreintes du bundle sont documentées dans [`src/libs/bambu-tls/README.md`](src/libs/bambu-tls/README.md). Un
workflow hebdomadaire signale dans une issue tout changement du fichier officiel BambuStudio, sans remplacer ni faire
confiance automatiquement à de nouveaux certificats.

## Utilisation

### Mode développement avec watch :

```bash
pnpm run local:watch
```

### Mode développement simple :

```bash
pnpm run local
```

### Mode production :

```bash
pnpm run build
pnpm run start
```

### Outils de debug :

```bash
pnpm run debug:mqtt           # Tester la connexion MQTT
pnpm run debug:discord-test   # Tester les notifications Discord
pnpm run debug:rtc            # Tester les captures RTC
```

### Émulateur MQTT pour le développement

Le banc de fausse imprimante utilise des scénarios JSON versionnés dans `scenarios/mock-mqtt-printer/`. Un scénario
enchaîne les actions `project`, `status`, `stop`, `raw`, `burst`, `outage`, `restart` et `wait`; l'outil fabrique les
enveloppes `PROJECT_FILE`/`PUSH_STATUS`, gère Aedes, les `pushall`, les coupures, la reconnexion et le redémarrage du
gestionnaire. Les champs de `payload` restent partiels comme les vrais rapports Bambu.

Pour servir le scénario par défaut à un bot lancé séparément :

```bash
pnpm run dev:mqtt-emulator
# ou un scénario précis
pnpm run dev:mqtt-emulator -- --serve scenarios/mock-mqtt-printer/stop-success.json
```

Il expose une fausse imprimante Bambu Lab sur `mqtt://127.0.0.1:1883`. Configurez le bot avec :

- IP : `127.0.0.1`
- port MQTT : `1883`
- numéro de série : `DEV_SERIAL`
- code d'accès : `mock-access-code`
- variable d'environnement : `MQTT_PROTOCOL=mqtt`

Chaque `pushall` rejoue le scénario; un `pushall` de reconnexion pendant une coupure poursuit le scénario en cours. Le
MQTT sécurisé (`mqtts`) reste utilisé par défaut pour le bot lorsque `MQTT_PROTOCOL` n'est pas défini.
En mode CI, `restart` recrée le gestionnaire et le coordinateur; en mode serveur, cette action attend le prochain
`pushall` d'un bot redémarré séparément avant de publier l'état de reprise choisi.

Le mode non interactif démarre lui-même le vrai `BambuLabClient` et le vrai `PrinterManager`, mais remplace la livraison
Discord par un adaptateur déterministe et utilise un stockage temporaire :

```bash
pnpm run test:mqtt-scenario -- scenarios/mock-mqtt-printer/long-outage-running.json
pnpm run test:mqtt-scenario -- --all
```

Les coupures et le seuil d'alerte de 60 secondes utilisent la même échelle de temps (`0.01` par défaut en CI). Chaque
exécution écrit une ligne `SCENARIO_RESULT` JSON. `status: "passed"`, `shutdown: "clean"` et le code de sortie `0`
indiquent le succès; une assertion ou un arrêt incomplet produit `status: "failed"` et un code non nul.

Scénarios fournis : impression réussie, coupure courte avec reprise `RUNNING`, coupure longue avec reprise `RUNNING`,
`PAUSE` ou terminale et restauration des tags, redémarrage pendant une impression sans second thread, brut malformé
puis valide, statut partiel puis valide, `STOP success`, rafale/backlog borné et arrêt contrôlé. Le mode CI par défaut ne
charge pas `.env` et ne contacte jamais Discord.

Un smoke test Discord réel est disponible uniquement sur activation explicite et requiert aussi `DISCORD_BOT_TOKEN`
dans l'environnement. Les deux IDs restent hors du dépôt et la cible est vérifiée comme forum de la guilde avant toute
écriture :

```bash
MOCK_DISCORD_GUILD_ID=<guild-id> \
MOCK_DISCORD_FORUM_CHANNEL_ID=<forum-id> \
pnpm run test:mqtt-scenario -- --discord-e2e scenarios/mock-mqtt-printer/discord-e2e-smoke.json
```

Ce banc ne simule pas RTC : les captures sont remplacées par `null` pour isoler MQTT/notifications, car les tests socket
de `src/libs/rtc/` couvrent déjà le protocole, les trames et les erreurs. Il ne valide donc pas une image caméra ni la
restauration physique de l'éclairage sans imprimante.

## Déploiement Docker

Créez le fichier `.env` décrit plus haut, puis lancez le service fourni dans `compose.yaml` :

```bash
docker compose up -d --build
```

Le conteneur s'exécute avec un utilisateur non-root et stocke tout le répertoire `config` dans le volume Docker
`printer-config`, monté dans `/usr/src/app/config`. Ce volume conserve la configuration, la récupération des impressions
et les notifications en attente lors des mises à jour ou recréations du conteneur. Le mode réseau `host` permet au bot
d'accéder aux imprimantes présentes sur le réseau local et nécessite un hôte Linux. L'image finale n'embarque pas pnpm :
il sert uniquement à construire l'application, ensuite exécutée directement avec Node.js.

Ne supprimez pas le volume sans avoir sauvegardé la configuration. Si `CONFIG_ENCRYPTION_KEY` est définie, conservez
également cette clé : les codes d'accès chiffrés ne peuvent pas être récupérés sans elle.

## Structure du projet

```
src/
├── index.ts                    # Point d'entrée principal
├── application.ts              # Démarrage et arrêt ordonnés
├── constants.ts                # Variables d'environnement
├── enums.ts                    # Énumérations
├── libs/                       # Utilitaires stateless
│   ├── bambu-tls/              # Autorités de certification Bambu
│   ├── logger/                 # Logger Pino
│   ├── project/                # Extraction images projet
│   └── rtc/                    # Capture d'écran (protocole natif Bambu)
├── services/
│   ├── bambu-lab/              # Client MQTT Bambu Lab
│   ├── database/               # Persistence JSON
│   ├── discord/                # Service Discord complet
│   │   ├── bot.ts              # Client Discord
│   │   ├── commands/           # Commandes slash
│   │   └── embeds/             # Builders d'embeds
│   ├── printer-manager/        # Gestion multi-imprimantes et notifications
│   └── printer-status/         # Gestionnaire d'état
├── types/                      # Types TypeScript
└── tools/                      # Outils de debug
```

## Configuration des imprimantes

Les configurations sont stockées dans `config/printers.json` (créé automatiquement). Dès qu'une imprimante est configurée,
`CONFIG_ENCRYPTION_KEY` est obligatoire et les codes d'accès sont chiffrés avec AES-256-GCM. Au démarrage, un ancien
fichier contenant des codes d'accès en clair est migré automatiquement et atomiquement si une clé valide est disponible.
Sans cette clé, le bot refuse de charger ou d'enregistrer des imprimantes afin de ne jamais conserver leurs codes d'accès
en clair. Conservez toujours la même clé : une configuration chiffrée ne peut pas être chargée sans elle.

Les associations des impressions actives avec leurs threads Discord sont sauvegardées dans
`config/active-threads.json` afin de rattacher une impression en cours après redémarrage sans créer de thread en double.
Les notifications sont d'abord journalisées dans `config/notification-outbox.json`; leurs images en attente sont
conservées sous `config/notification-attachments/`. Le bot réessaie les erreurs Discord transitoires et réconcilie les
envois dont le résultat est incertain avant de renvoyer, puis reprend ce travail après un redémarrage.

Pendant une impression active, une coupure MQTT de moins de 60 secondes reste silencieuse. Au-delà, le thread reçoit une
alerte **Attention**; lorsque la communication revient et que l'impression continue, le bot annonce la reprise et
restaure les tags correspondant à l'état courant. Cet état est lui aussi conservé dans l'outbox pour survivre à un
redémarrage.

Le répertoire `config` et les captures de diagnostic peuvent contenir des données sensibles et sont ignorés par Git.
Sauvegardez ensemble ce répertoire et `CONFIG_ENCRYPTION_KEY`; ne publiez ni l'un ni l'autre.

## Forum Tags

Le bot crée automatiquement les tags suivants dans vos forum channels :

- **États** : En cours, Réussi, Échoué, En pause, Attention
- **Couleurs** : Multicolore, Monocolor
- **Imprimantes** : Un tag par imprimante configurée

Les tags gérés par le bot sont modérés. Les autres tags déjà présents dans un forum sont préservés.

## Licence

ISC
