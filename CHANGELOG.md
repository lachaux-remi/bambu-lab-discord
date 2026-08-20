# Changelog

All notable changes to this project will be documented in this file.

## [2.4.1](https://github.com/lachaux-remi/bambu-lab-discord/compare/v2.4.0...v2.4.1) (2026-08-20)


### Bug Fixes

* make configuration errors actionable ([#40](https://github.com/lachaux-remi/bambu-lab-discord/issues/40)) ([e7dcd82](https://github.com/lachaux-remi/bambu-lab-discord/commit/e7dcd82875e4f63e2d8fe5ae7dd5bf75010382ef))
* recover printers unavailable at startup ([#41](https://github.com/lachaux-remi/bambu-lab-discord/issues/41)) ([6056478](https://github.com/lachaux-remi/bambu-lab-discord/commit/6056478b439bb9ee4eba039f75e6e8c8a1401993))
* summarize repeated MQTT connection errors ([#37](https://github.com/lachaux-remi/bambu-lab-discord/issues/37)) ([5b3a18c](https://github.com/lachaux-remi/bambu-lab-discord/commit/5b3a18c5de1281cb18b7d069c5acbffc1bc296a5))

## [2.4.0](https://github.com/lachaux-remi/bambu-lab-discord/compare/v2.3.0...v2.4.0) (2026-08-19)


### Features

* add Discord camera test command ([#35](https://github.com/lachaux-remi/bambu-lab-discord/issues/35)) ([75987c1](https://github.com/lachaux-remi/bambu-lab-discord/commit/75987c198a40105c70d5dbf5fe3521cfa52994c6))

## [2.3.0](https://github.com/lachaux-remi/bambu-lab-discord/compare/v2.2.2...v2.3.0) (2026-08-19)


### Features

* verify Bambu printer TLS certificates ([#34](https://github.com/lachaux-remi/bambu-lab-discord/issues/34)) ([b845f88](https://github.com/lachaux-remi/bambu-lab-discord/commit/b845f88527e2b34642189f3f4df16b4cc11f1b06))


### Bug Fixes

* bound project DNS resolution ([#31](https://github.com/lachaux-remi/bambu-lab-discord/issues/31)) ([19ef5e9](https://github.com/lachaux-remi/bambu-lab-discord/commit/19ef5e9e7ecde87b61975c6d2ba6861313c3bb2d))
* harden print recovery reliability ([#33](https://github.com/lachaux-remi/bambu-lab-discord/issues/33)) ([3856628](https://github.com/lachaux-remi/bambu-lab-discord/commit/38566282db340c3a73ffcd5ca53a13d65804fc83))

## [2.2.2](https://github.com/lachaux-remi/bambu-lab-discord/compare/v2.2.1...v2.2.2) (2026-08-19)


### Bug Fixes

* authenticate release pull requests ([#28](https://github.com/lachaux-remi/bambu-lab-discord/issues/28)) ([f410839](https://github.com/lachaux-remi/bambu-lab-discord/commit/f4108398489708babb2c06cc1827e7283eb0bc9e))

## [2.2.1](https://github.com/lachaux-remi/bambu-lab-discord/compare/v2.2.0...v2.2.1) (2026-08-19)


### Bug Fixes

* gate releases on CI validation ([#23](https://github.com/lachaux-remi/bambu-lab-discord/issues/23)) ([1ede5d2](https://github.com/lachaux-remi/bambu-lab-discord/commit/1ede5d219aab05d25307d8c3e13cff0730d7cc0e))
* harden MQTT startup and print recovery ([#25](https://github.com/lachaux-remi/bambu-lab-discord/issues/25)) ([467ba7e](https://github.com/lachaux-remi/bambu-lab-discord/commit/467ba7e388a673182a4e5393afbff6616ec62bb2))
* harden project downloads and error logging ([#24](https://github.com/lachaux-remi/bambu-lab-discord/issues/24)) ([0d67b9c](https://github.com/lachaux-remi/bambu-lab-discord/commit/0d67b9c6e655bb560e0b05b1489ad1c8659283b0))

## [2.2.0](https://github.com/lachaux-remi/bambu-lab-discord/compare/v2.1.0...v2.2.0) (2026-08-19)

### Features

- Add MQTT printer emulator for development ([6c71985](https://github.com/lachaux-remi/bambu-lab-discord/commit/6c7198550adbabe2f5451a95576f2f4a14e2f276))
- Harden printer monitoring and add automated tests ([f80b7c5](https://github.com/lachaux-remi/bambu-lab-discord/commit/f80b7c565307be6bb2b8100971ec958c0c7b9858))

### Bug Fixes

- Include pnpm workspace configuration in Docker builds ([638646b](https://github.com/lachaux-remi/bambu-lab-discord/commit/638646b4ba59c1263d996f07601c1a053925ba5a))
- Persist Docker runtime configuration with non-root write access ([8052ee3](https://github.com/lachaux-remi/bambu-lab-discord/commit/8052ee375f394a1785fe5138017b589a0ccf0113))
- Shut down Discord and MQTT services cleanly ([0fe4f0a](https://github.com/lachaux-remi/bambu-lab-discord/commit/0fe4f0af12e37bf2b94dc81d28914ede91923a69))
- Encrypt printer access codes and migrate plaintext configuration automatically ([5f9de00](https://github.com/lachaux-remi/bambu-lab-discord/commit/5f9de00122c857339e2745a14beeba3380285d95))

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
