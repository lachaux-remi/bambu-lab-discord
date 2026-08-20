# Bambu Lab Discord Bot

Bot Discord pour notifications en temps réel de vos imprimantes 3D Bambu Lab.

## Description

Ce bot se connecte à vos imprimantes Bambu Lab via MQTT et envoie des notifications Discord automatiques pour :

- Démarrage d'impression
- Progression d'impression (par incréments configurables)
- Pause/Reprise d'impression
- Fin d'impression (succès ou échec)
- Arrêt d'impression

Les notifications incluent des captures d'écran en temps réel et des images de prévisualisation du projet.

## Fonctionnalités

- 🖨️ **Multi-imprimantes** : Gérez plusieurs imprimantes depuis un seul bot
- 📺 **Multi-channels** : Chaque imprimante peut avoir son propre forum channel
- 🏷️ **Tags automatiques** : Tags de statut et d'imprimante gérés automatiquement
- 📡 Connexion MQTT sécurisée avec validation du certificat Bambu Lab
- 📸 Captures d'écran automatiques via protocole natif Bambu et TLS vérifié
- 🖼️ Extraction et affichage des images de prévisualisation du projet
- 🔔 Notifications Discord riches avec embeds dans des forum threads
- 🔄 Reconnexion automatique en cas de perte de connexion
- ⚙️ Configuration via commandes Discord slash

## Prérequis

- Node.js 24.x et pnpm
- Une ou plusieurs imprimantes Bambu Lab sur votre réseau local
- Un bot Discord avec les permissions appropriées

### Ports réseau

Si le bot n'est pas exécuté localement (ex: serveur distant, Docker sur un autre réseau), assurez-vous que les ports
suivants sont accessibles vers vos imprimantes :

| Port | Protocole | Utilisation                                            |
|------|-----------|--------------------------------------------------------|
| 8883 | TCP/TLS   | MQTT - Communication avec l'imprimante (configurable)  |
| 6000 | TCP/TLS   | Caméra - Captures d'écran (configurable via rtc_port)  |

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

# Personnalisation des notifications (optionnel)
NOTIFICATION_PERCENT=5
NOTIFICATION_FOOTER_TEXT=Bambu Lab Discord
NOTIFICATION_FOOTER_ICON=
NOTIFICATION_COLOR=#24a543

# Délais opérationnels (optionnel)
ERROR_LOG_COOLDOWN_MINUTES=1
# Délai de connexion MQTT en ms (1000 à 300000, défaut 30000 si invalide)
MQTT_CONNECT_TIMEOUT_MS=30000
CHAMBER_LIGHT_OFF_DELAY_MINUTES=5
CHAMBER_LIGHT_WARMUP_MS=1500

# Validation des certificats MQTT et caméra (laisser désactivé)
BAMBU_TLS_INSECURE=false

# Mode debug (optionnel)
DEBUG=false
```

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
  - Envoyer des messages
  - Créer des threads publics
  - Gérer les threads
  - Gérer les tags (pour les forums)

## Commandes Slash

Une fois le bot démarré, utilisez ces commandes Discord :

| Commande                                                    | Description                            |
|-------------------------------------------------------------|----------------------------------------|
| `/printer add <name> <ip> <serial> <access_code> <channel>` | Ajouter une imprimante                 |
| `/printer remove <name>`                                    | Supprimer une imprimante               |
| `/printer list`                                             | Lister les imprimantes configurées     |
| `/printer edit <name> [options]`                            | Modifier une imprimante                |
| `/printer screenshot <name>`                                | Publier une capture caméra de test     |

### Exemple d'ajout d'imprimante

```
/printer add name:P1S Bureau ip:192.168.1.100 serial:01S00A000000000 access_code:12345678 channel:#impressions-3d
```

## Captures d'écran (RTC)

Le bot capture des screenshots directement depuis vos imprimantes via le protocole natif Bambu Lab :

- Connexion TLS vérifiée sur le port 6000 de l'imprimante
- Pas de service externe nécessaire (ffmpeg, go2rtc, etc.)
- Utilise l'IP comme destination et le serial déjà configuré comme identité TLS

Pour tester les captures :

```bash
pnpm run debug:rtc
```

Depuis Discord, `/printer screenshot <name>` capture une image réelle et crée une notification publique de test dans
le forum configuré pour l'imprimante. Cette commande nécessite la permission **Gérer le serveur** ou **Administrateur**.

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
les empreintes du bundle sont documentées dans [`src/libs/bambu-tls/README.md`](src/libs/bambu-tls/README.md).

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

Pour développer sans imprimante accessible sur le réseau, démarrez l'émulateur dans un premier terminal :

```bash
pnpm run dev:mqtt-emulator
```

Il expose une fausse imprimante Bambu Lab sur `mqtt://127.0.0.1:1883`. Configurez le bot avec :

- IP : `127.0.0.1`
- port MQTT : `1883`
- numéro de série : `DEV_SERIAL`
- code d'accès : `mock-access-code`
- variable d'environnement : `MQTT_PROTOCOL=mqtt`

Au premier `pushall` du bot, l'émulateur joue automatiquement un scénario complet : préparation, démarrage,
progression, pause, reprise et fin réussie. Le MQTT sécurisé (`mqtts`) reste utilisé par défaut lorsque
`MQTT_PROTOCOL` n'est pas défini.

## Déploiement Docker

Créez le fichier `.env` décrit plus haut, puis lancez le service fourni dans `compose.yaml` :

```bash
docker compose up -d --build
```

Le conteneur s'exécute avec un utilisateur non-root et stocke `printers.json` ainsi que `active-threads.json` dans le
volume Docker `printer-config`, monté dans `/usr/src/app/config`. Ce volume conserve la configuration lors des mises à
jour ou recréations du conteneur. Le mode réseau `host` permet au bot d'accéder aux imprimantes présentes sur le réseau
local et nécessite un hôte Linux.

Ne supprimez pas le volume sans avoir sauvegardé la configuration. Si `CONFIG_ENCRYPTION_KEY` est définie, conservez
également cette clé : les codes d'accès chiffrés ne peuvent pas être récupérés sans elle.

## Structure du projet

```
src/
├── index.ts                    # Point d'entrée principal
├── constants.ts                # Variables d'environnement
├── enums.ts                    # Énumérations
├── libs/                       # Utilitaires stateless
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
│   ├── printer-manager/        # Gestion multi-imprimantes
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
`config/active-threads.json` afin de permettre une reprise après redémarrage. Ces fichiers contiennent des données
sensibles et sont ignorés par Git.

## Forum Tags

Le bot crée automatiquement les tags suivants dans vos forum channels :

- **États** : En cours, Réussi, Échoué, En pause, Attention
- **Couleurs** : Multicolore, Monocolor
- **Imprimantes** : Un tag par imprimante configurée

Tous les tags sont modérés (seul le bot peut les modifier).

## Licence

ISC
