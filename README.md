# Bambu Lab Discord Bot

Bot Discord pour notifications en temps réel de votre imprimante 3D Bambu Lab.

## Description

Ce bot se connecte à votre imprimante Bambu Lab via MQTT et envoie des notifications Discord automatiques pour :
- Démarrage d'impression
- Progression d'impression (par incréments configurables)
- Pause/Reprise d'impression
- Fin d'impression (succès ou échec)
- Arrêt d'impression

Les notifications incluent des captures d'écran en temps réel et des images de prévisualisation du projet.

## Fonctionnalités

- 📡 Connexion MQTT sécurisée à l'imprimante Bambu Lab
- 📸 Captures d'écran automatiques via RTC
- 🖼️ Extraction et affichage des images de prévisualisation du projet
- ☁️ Stockage des médias sur S3 (compatible avec tous les services S3)
- 🔔 Notifications Discord riches avec embeds
- 🔄 Reconnexion automatique en cas de perte de connexion
- 📊 Suivi de progression avec pourcentages personnalisables

## Prérequis

- Node.js 18+ et pnpm
- Une imprimante Bambu Lab sur votre réseau local
- Un webhook Discord
- Un stockage S3 ou compatible (AWS S3, MinIO, etc.)
- Accès au flux RTC de l'imprimante

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
# Configuration de l'imprimante
PRINTER_ADDRESS=192.168.1.100
PRINTER_PORT=8883
PRINTER_SERIAL_NUMBER=01S00A000000000
PRINTER_ACCESS_CODE=12345678
PRINTER_USERNAME=bblp

# Webhook Discord
DISCORD_WEBHOOK_NOTIFICATION_ID=123456789012345678
DISCORD_WEBHOOK_NOTIFICATION_TOKEN=votre_token_webhook

# URL RTC pour les captures d'écran
RTC_URL=http://192.168.1.100/rtc/screenshot

# Configuration S3
AWS_ENDPOINT=https://s3.eu-west-3.amazonaws.com
AWS_ACCESS_KEY_ID=votre_access_key
AWS_SECRET_ACCESS_KEY=votre_secret_key
AWS_REGION=eu-west-3
AWS_BUCKET=bambu-lab-notifications

# Personnalisation des notifications (optionnel)
NOTIFICATION_PERCENT=5
NOTIFICATION_FOOTER_TEXT=Bambu Lab Discord
NOTIFICATION_COLOR=#24a543

# Mode debug (optionnel)
DEBUG=false
```

## Configuration

### Configuration de l'imprimante

1. **PRINTER_ADDRESS** : Adresse IP de votre imprimante sur le réseau local
2. **PRINTER_SERIAL_NUMBER** : Numéro de série visible dans l'interface de l'imprimante
3. **PRINTER_ACCESS_CODE** : Code d'accès LAN généré dans les paramètres de l'imprimante
   - Allez dans Paramètres → Réseau → Code d'accès LAN

### Configuration du Webhook Discord

1. Sur votre serveur Discord, allez dans Paramètres du serveur → Intégrations → Webhooks
2. Créez un nouveau webhook et copiez l'URL
3. L'URL sera au format : `https://discord.com/api/webhooks/{ID}/{TOKEN}`
4. Extrayez l'ID et le TOKEN pour les variables d'environnement

### Configuration S3

Vous pouvez utiliser n'importe quel service compatible S3 :
- AWS S3
- MinIO (self-hosted)
- DigitalOcean Spaces
- Backblaze B2
- etc.

Assurez-vous que le bucket est configuré en lecture publique pour les objets uploadés.

### Personnalisation des notifications

- **NOTIFICATION_PERCENT** : Intervalle de progression pour les notifications (défaut : 5%)
  - Valeur de 5 = notifications à 5%, 10%, 15%, etc.
- **NOTIFICATION_FOOTER_TEXT** : Texte du footer des embeds Discord
- **NOTIFICATION_FOOTER_ICON** : URL de l'icône du footer
- **NOTIFICATION_COLOR** : Couleur des embeds au format hexadécimal (ex: #24a543)

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

## Déploiement

### Docker (recommandé)

Créez un `Dockerfile` :
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Installation de pnpm
RUN npm install -g pnpm

# Copie des fichiers de dépendances
COPY package.json pnpm-lock.yaml ./

# Installation des dépendances
RUN pnpm install --frozen-lockfile

# Copie du code source
COPY . .

# Build
RUN pnpm run build

# Démarrage
CMD ["pnpm", "run", "start"]
```

Avec Docker Compose :
```yaml
version: '3.8'
services:
  bambu-discord:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    networks:
      - host
```

### PM2

```bash
pm2 start dist/index.js --name bambu-discord
pm2 save
pm2 startup
```

## Structure du projet

```
.
├── src/
│   ├── index.ts                    # Point d'entrée principal
│   ├── constants.ts                # Variables d'environnement
│   ├── enums.ts                    # Énumérations (états, commandes)
│   ├── libs/                       # Bibliothèques réutilisables
│   │   ├── discord/                # Client webhook Discord
│   │   ├── logger/                 # Logger Pino
│   │   ├── rtc/                    # Capture d'écran RTC
│   │   └── s3-storage/             # Upload S3
│   ├── services/
│   │   ├── bambu-lab/              # Client MQTT Bambu Lab
│   │   ├── printer-status/         # Gestionnaire d'état
│   │   └── messages/               # Handlers de notifications
│   └── types/                      # Types TypeScript
├── dist/                           # Code compilé
├── package.json
├── tsconfig.json
└── .env
```

## Dépannage

### L'imprimante ne se connecte pas
- Vérifiez que l'adresse IP est correcte
- Assurez-vous que le code d'accès LAN est valide
- Vérifiez que le port 8883 est accessible

### Les captures d'écran ne s'affichent pas
- Vérifiez l'URL RTC (testez-la dans un navigateur)
- Vérifiez la configuration S3 et les permissions du bucket

### Les notifications ne s'envoient pas
- Vérifiez que le webhook Discord est valide
- Consultez les logs pour plus de détails (`DEBUG=true`)

### Les événements MQTT ne fonctionnent pas correctement

Si vous rencontrez des problèmes avec les notifications d'événements (surtout après une mise à jour firmware), consultez le [Guide de dépannage MQTT détaillé](./TROUBLESHOOTING.md).

**Outil de diagnostic rapide :**
```bash
# Voir tous les messages MQTT bruts
pnpm run debug:mqtt
```

Ce script vous permet de voir exactement ce que l'imprimante envoie et d'identifier les changements dans les messages MQTT.

## Contribuer

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une pull request.

## Licence

ISC

## Auteur

Développé pour automatiser les notifications d'impression 3D Bambu Lab.
