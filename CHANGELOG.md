# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [2.0.0] - 2026-01-16

### Added

- **Multi-imprimantes** : Support de plusieurs imprimantes Bambu Lab
- **Multi-channels** : Chaque imprimante peut poster dans son propre forum channel
- **Commandes slash Discord** : `/printer add|remove|list|edit|start|stop|status`
- **Tags dynamiques** : Un tag est créé automatiquement pour chaque imprimante
- **Service database** : Persistence des configurations dans `config/printers.json`
- **PrinterManager** : Gestion centralisée de plusieurs instances BambuLabClient
- **Script debug:rtc** : Outil pour tester les connexions RTC
- Types `.d.ts` dédiés pour une meilleure organisation du code

### Changed

- **BREAKING** : Les variables d'environnement pour l'imprimante unique sont supprimées
- **BREAKING** : Le mode webhook est supprimé, seul le mode bot est supporté
- Architecture réorganisée : `services/discord/` contient le bot et les embeds
- `BambuLabClient` accepte maintenant une `PrinterConfig` en paramètre
- `takeScreenshotBuffer()` et `uploadScreenshot()` acceptent l'URL RTC en paramètre
- Les embeds affichent maintenant le nom de l'imprimante dans le titre

### Removed

- Support webhook Discord (remplacé par le bot complet)
- Variables d'environnement : `PRINTER_*`, `DISCORD_WEBHOOK_*`, `RTC_URL`, `DISCORD_PARENT_CHANNEL_ID`
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
