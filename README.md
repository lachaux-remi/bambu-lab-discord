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
- 📡 Connexion MQTT sécurisée aux imprimantes Bambu Lab
- 📸 Captures d'écran automatiques via protocole natif Bambu
- 🖼️ Extraction et affichage des images de prévisualisation du projet
- 🔔 Notifications Discord riches avec embeds dans des forum threads
- 🔄 Reconnexion automatique en cas de perte de connexion
- ⚙️ Configuration via commandes Discord slash

## Prérequis

- Node.js 24+ et pnpm
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
git clone https://github.com/votre-username/bambu-lab-discord.git
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


# Personnalisation des notifications (optionnel)
NOTIFICATION_PERCENT=5
NOTIFICATION_FOOTER_TEXT=Bambu Lab Discord
NOTIFICATION_COLOR=#24a543

# Mode debug (optionnel)
DEBUG=false
```

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
| `/printer start <name>`                                     | Démarrer la connexion à une imprimante |
| `/printer stop <name>`                                      | Arrêter la connexion                   |
| `/printer status <name>`                                    | Voir le statut d'une imprimante        |

### Exemple d'ajout d'imprimante

```
/printer add name:P1S Bureau ip:192.168.1.100 serial:01S00A000000000 access_code:12345678 channel:#impressions-3d
```

## Captures d'écran (RTC)

Le bot capture des screenshots directement depuis vos imprimantes via le protocole natif Bambu Lab :

- Connexion TLS directe sur le port 6000 de l'imprimante
- Pas de service externe nécessaire (ffmpeg, go2rtc, etc.)
- Utilise l'IP et le code d'accès de l'imprimante

Pour tester les captures :

```bash
pnpm run debug:rtc
```

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
pnpm run debug:mqtt      # Tester la connexion MQTT
pnpm run debug:discord   # Tester les notifications Discord
pnpm run debug:rtc       # Tester les captures RTC
```

## Déploiement Docker

```yaml
# docker-compose.yml
services:
  bambu-discord:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./config:/app/config  # Persistence des configs imprimantes
    network_mode: host  # Pour accéder aux imprimantes sur le réseau local
```

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

Les configurations sont stockées dans `config/printers.json` (créé automatiquement).
Ce fichier contient des données sensibles et est ignoré par Git.

## Forum Tags

Le bot crée automatiquement les tags suivants dans vos forum channels :

- **États** : En cours, Réussi, Échoué, En pause, Attention
- **Couleurs** : Multicolore, Monocolor
- **Imprimantes** : Un tag par imprimante configurée

Tous les tags sont modérés (seul le bot peut les modifier).

## Licence

ISC

