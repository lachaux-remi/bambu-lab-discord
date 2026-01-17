# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0] - 2026-01-17

### Added

- **Port RTC configurable** : Option `rtc_port` dans `/printer add` et `/printer edit` (défaut: 6000)
- Support de la variable d'environnement `PRINTER_RTC_PORT` dans l'outil debug-rtc

### Changed

- Utilisation de `PrinterConfig` partout (suppression du type `PrinterConnection` redondant)
- Documentation mise à jour (README.md, CLAUDE.md)

### Fixed

- Message d'erreur de `/printer add` ne référence plus `/printer start` (commande supprimée)

## [2.0.0] - 2026-01-17

### Added

- **Multi-imprimantes** : Support de plusieurs imprimantes Bambu Lab
- **Multi-channels** : Chaque imprimante peut poster dans son propre forum channel
- **Commandes slash Discord** : `/printer add|remove|list|edit`
- **Tags dynamiques** : Un tag est créé automatiquement pour chaque imprimante
- **Service database** : Persistence des configurations dans `config/printers.json`
- **PrinterManager** : Gestion centralisée de plusieurs instances BambuLabClient
- **Protocole natif Bambu** : Capture d'écran directe via TLS port 6000 (sans ffmpeg/go2rtc)
- **Discord attachments** : Images envoyées directement comme pièces jointes (sans S3)
- **Lib project** : Extraction des images de prévisualisation depuis les fichiers 3mf
- **Type EmbedResult** : Embeds avec fichiers attachés intégrés
- **Script debug:rtc** : Outil pour tester les connexions caméra
- Types `.d.ts` dédiés pour une meilleure organisation du code
- Documentation des ports réseau (8883, 6000) pour déploiements distants

### Changed

- **BREAKING** : Les variables d'environnement pour l'imprimante unique sont supprimées
- **BREAKING** : Le mode webhook est supprimé, seul le mode bot est supporté
- **BREAKING** : Les variables S3 (AWS_*) ne sont plus nécessaires
- **BREAKING** : Node.js 24+ requis
- Architecture réorganisée : `services/discord/` contient le bot et les embeds
- `BambuLabClient` accepte maintenant une `PrinterConfig` en paramètre
- Titres des embeds simplifiés (sans nom d'imprimante ni emoji, info dans le tag)
- Titre des threads simplifié : juste le nom du projet
- `projectImageUrl` remplacé par `projectImage` (Buffer)

### Removed

- Support webhook Discord (remplacé par le bot complet)
- Dépendance `aws-sdk` et stockage S3
- Lib `s3-storage` (remplacée par attachments Discord)
- Commandes `/printer start|stop|status` et option `enabled`
- Option `rtc_url` (protocole natif utilisé automatiquement)
- Support HTTP/go2rtc pour les captures d'écran
- Variables d'environnement : `PRINTER_*`, `DISCORD_WEBHOOK_*`, `RTC_URL`, `DISCORD_PARENT_CHANNEL_ID`, `AWS_*`
- Dossier `src/libs/discord/` (remplacé par `src/services/discord/`)
- Dossier `src/services/messages/` (remplacé par `src/services/discord/embeds/`)

## [1.1.0] - 2025-10-18

### Added

- Détection des impressions annulées vs terminées basée sur le pourcentage de progression
- Nouveau message `printCancelled` pour les impressions annulées avant 100%
- Script de débogage MQTT (`pnpm run debug:mqtt`) pour capturer les messages bruts de l'imprimante
- Logs de débogage détaillés à tous les niveaux (BambuLabClient, PrinterStatus, Application)
- Guide de dépannage complet (TROUBLESHOOTING.md) pour diagnostiquer les problèmes d'événements MQTT
- Documentation complète : README.md, CHANGELOG.md, CLAUDE.md
- Filtrage intelligent des événements non critiques (températures, wifi) pour éviter les notifications inutiles

### Changed

- Les champs des interfaces `PushStatusCommand` et `ProjectFileCommand` sont maintenant optionnels pour mieux gérer les
  variations du firmware
- Amélioration de la gestion des champs optionnels dans `PrinterStatus.onUpdate()`
- Logs plus verbeux lors des transitions d'état et de la réception de messages
- **BREAKING FIX:** Correction de la gestion des messages incrémentaux MQTT - les mises à jour de progression sont
  maintenant traitées indépendamment de l'état actuel
- État `FINISH` maintenant différencié : 100% = terminée, <100% = annulée

### Fixed

- **CRITIQUE:** Correction du bug de boucle infinie dans S3 storage où `attempt++` causait des retries infinies
- **CRITIQUE:** Correction du problème où les messages MQTT incrémentaux (`"msg": 1`) n'étaient pas correctement traités
- Correction de la syntaxe du logger pino (format métadonnées en premier)
- Les informations de progression (couches, pourcentage, temps restant) sont maintenant mises à jour même dans les
  messages partiels
- Problèmes de compatibilité avec les nouvelles versions du firmware Bambu Lab qui envoient des messages incrémentaux
- Meilleure gestion des cas où les messages MQTT sont incomplets
- Réduction du bruit dans les logs en filtrant les mises à jour non critiques

## [1.0.14] - 2025-10-18

### Fixed

- Correction du chemin d'image du projet
- Bump de version

## Versions antérieures

Les versions antérieures ne sont pas documentées dans ce changelog.
