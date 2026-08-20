# Changelog

All notable changes to this project will be documented in this file.

## [2.5.0](https://github.com/lachaux-remi/bambu-lab-discord/compare/v2.4.2...v2.5.0) (2026-08-20)


### Features

* add configurable cooldown for MQTT error log deduplication ([eb85bc9](https://github.com/lachaux-remi/bambu-lab-discord/commit/eb85bc97c7bd8f330f1bbfb5ee84a026a0b8e9fc))
* add Discord camera test command ([#35](https://github.com/lachaux-remi/bambu-lab-discord/issues/35)) ([75987c1](https://github.com/lachaux-remi/bambu-lab-discord/commit/75987c198a40105c70d5dbf5fe3521cfa52994c6))
* add MQTT printer emulator for development ([6c71985](https://github.com/lachaux-remi/bambu-lab-discord/commit/6c7198550adbabe2f5451a95576f2f4a14e2f276))
* auto chamber light control around screenshots and after print end ([ddee3a0](https://github.com/lachaux-remi/bambu-lab-discord/commit/ddee3a06752d3a45fcd71275b8495f23d4ea397e))
* auto chamber light control around screenshots and after print end ([504e38b](https://github.com/lachaux-remi/bambu-lab-discord/commit/504e38b02b55a4815d15267f154b5e19a67f314c))
* configurable RTC port and code cleanup ([b5a4af1](https://github.com/lachaux-remi/bambu-lab-discord/commit/b5a4af11547b914ec47f9e4199dad6ef25265bd2))
* configurable RTC port and code cleanup ([4cea674](https://github.com/lachaux-remi/bambu-lab-discord/commit/4cea674555da32328a281ed0ffefd06ea0897524))
* Discord forum threads with multicolor detection and auto-updating tags ([#2](https://github.com/lachaux-remi/bambu-lab-discord/issues/2)) ([adef74e](https://github.com/lachaux-remi/bambu-lab-discord/commit/adef74e690d33682f94dab260208aad50dabd700))
* harden printer monitoring and add tests ([f80b7c5](https://github.com/lachaux-remi/bambu-lab-discord/commit/f80b7c565307be6bb2b8100971ec958c0c7b9858))
* verify Bambu printer TLS certificates ([#34](https://github.com/lachaux-remi/bambu-lab-discord/issues/34)) ([b845f88](https://github.com/lachaux-remi/bambu-lab-discord/commit/b845f88527e2b34642189f3f4df16b4cc11f1b06))


### Bug Fixes

* allow esbuild build scripts and fix CMD JSON form ([eca14d4](https://github.com/lachaux-remi/bambu-lab-discord/commit/eca14d4b6e3150d765abdaebdca94e0b856d3226))
* allow esbuild build scripts and fix CMD JSON form ([70c3485](https://github.com/lachaux-remi/bambu-lab-discord/commit/70c34859160f4786eaa723d9bcb36048f8ad0568))
* authenticate release pull requests ([#28](https://github.com/lachaux-remi/bambu-lab-discord/issues/28)) ([f410839](https://github.com/lachaux-remi/bambu-lab-discord/commit/f4108398489708babb2c06cc1827e7283eb0bc9e))
* bound project DNS resolution ([#31](https://github.com/lachaux-remi/bambu-lab-discord/issues/31)) ([19ef5e9](https://github.com/lachaux-remi/bambu-lab-discord/commit/19ef5e9e7ecde87b61975c6d2ba6861313c3bb2d))
* bypass pnpm 11 dep check on container startup ([9e208f8](https://github.com/lachaux-remi/bambu-lab-discord/commit/9e208f85d583c7d8ce21b0831b465559374b8677))
* bypass pnpm 11 dep check on container startup ([5b635b9](https://github.com/lachaux-remi/bambu-lab-discord/commit/5b635b9b2f7a3077c3d495e9a3c0a00d780b2818))
* classify successful stop as print cancellation ([#43](https://github.com/lachaux-remi/bambu-lab-discord/issues/43)) ([3127a7b](https://github.com/lachaux-remi/bambu-lab-discord/commit/3127a7bdec6141d7dfa2e26dfefd3cba8247817d))
* gate releases on CI validation ([#23](https://github.com/lachaux-remi/bambu-lab-discord/issues/23)) ([1ede5d2](https://github.com/lachaux-remi/bambu-lab-discord/commit/1ede5d219aab05d25307d8c3e13cff0730d7cc0e))
* harden MQTT startup and print recovery ([#25](https://github.com/lachaux-remi/bambu-lab-discord/issues/25)) ([467ba7e](https://github.com/lachaux-remi/bambu-lab-discord/commit/467ba7e388a673182a4e5393afbff6616ec62bb2))
* harden print recovery reliability ([#33](https://github.com/lachaux-remi/bambu-lab-discord/issues/33)) ([3856628](https://github.com/lachaux-remi/bambu-lab-discord/commit/38566282db340c3a73ffcd5ca53a13d65804fc83))
* harden project downloads and error logging ([#24](https://github.com/lachaux-remi/bambu-lab-discord/issues/24)) ([0d67b9c](https://github.com/lachaux-remi/bambu-lab-discord/commit/0d67b9c6e655bb560e0b05b1489ad1c8659283b0))
* include pnpm workspace config in Docker build ([638646b](https://github.com/lachaux-remi/bambu-lab-discord/commit/638646b4ba59c1263d996f07601c1a053925ba5a))
* make configuration errors actionable ([#40](https://github.com/lachaux-remi/bambu-lab-discord/issues/40)) ([e7dcd82](https://github.com/lachaux-remi/bambu-lab-discord/commit/e7dcd82875e4f63e2d8fe5ae7dd5bf75010382ef))
* persist Docker runtime configuration ([c0daf4c](https://github.com/lachaux-remi/bambu-lab-discord/commit/c0daf4c92aa52b3045d1267417a99a69b028c2c1))
* persist Docker runtime configuration ([8052ee3](https://github.com/lachaux-remi/bambu-lab-discord/commit/8052ee375f394a1785fe5138017b589a0ccf0113))
* prevent raw MQTT payload debug logging ([#48](https://github.com/lachaux-remi/bambu-lab-discord/issues/48)) ([52baa76](https://github.com/lachaux-remi/bambu-lab-discord/commit/52baa7638a6bf33f1f445993981b756bdf938a7b))
* recover printers unavailable at startup ([#41](https://github.com/lachaux-remi/bambu-lab-discord/issues/41)) ([6056478](https://github.com/lachaux-remi/bambu-lab-discord/commit/6056478b439bb9ee4eba039f75e6e8c8a1401993))
* redact residual MQTT capture identifiers ([#47](https://github.com/lachaux-remi/bambu-lab-discord/issues/47)) ([aa87a33](https://github.com/lachaux-remi/bambu-lab-discord/commit/aa87a333f1570a66fc743d63a7ea06edd3700d34))
* remove deprecated baseUrl from tsconfig for TypeScript 6.0 ([e32f3f9](https://github.com/lachaux-remi/bambu-lab-discord/commit/e32f3f980fd66c7138491dbc8b43cd28cba8abde))
* remove deprecated baseUrl from tsconfig for TypeScript 6.0 ([5d57f2a](https://github.com/lachaux-remi/bambu-lab-discord/commit/5d57f2a59c784030cc0af5b23945d0befd4736d5))
* require encrypted printer configuration ([199a748](https://github.com/lachaux-remi/bambu-lab-discord/commit/199a7480ad9f3d9e00450de13f62530df2ef3bdd))
* require encrypted printer configuration ([5f9de00](https://github.com/lachaux-remi/bambu-lab-discord/commit/5f9de00122c857339e2745a14beeba3380285d95))
* sanitize MQTT debug captures ([#44](https://github.com/lachaux-remi/bambu-lab-discord/issues/44)) ([ff3ccd6](https://github.com/lachaux-remi/bambu-lab-discord/commit/ff3ccd630097278651f5f79336c316330df3ab4b))
* shut down application cleanly ([2f54f17](https://github.com/lachaux-remi/bambu-lab-discord/commit/2f54f17fbaf8b192fe382e2efad6bb4900b0bf57))
* shut down application cleanly ([0fe4f0a](https://github.com/lachaux-remi/bambu-lab-discord/commit/0fe4f0af12e37bf2b94dc81d28914ede91923a69))
* summarize repeated MQTT connection errors ([#37](https://github.com/lachaux-remi/bambu-lab-discord/issues/37)) ([5b3a18c](https://github.com/lachaux-remi/bambu-lab-discord/commit/5b3a18c5de1281cb18b7d069c5acbffc1bc296a5))
* use --ignore-scripts to bypass pnpm 11 build approval in Docker ([0273893](https://github.com/lachaux-remi/bambu-lab-discord/commit/027389350c3fbea569af874d659520a7d038d337))
* use --ignore-scripts to bypass pnpm 11 build approval in Docker ([813d448](https://github.com/lachaux-remi/bambu-lab-discord/commit/813d448adfad9b01eeea57263933abcd23c74497))

## [2.4.2](https://github.com/lachaux-remi/bambu-lab-discord/compare/v2.4.1...v2.4.2) (2026-08-20)


### Bug Fixes

* classify successful stop as print cancellation ([#43](https://github.com/lachaux-remi/bambu-lab-discord/issues/43)) ([3127a7b](https://github.com/lachaux-remi/bambu-lab-discord/commit/3127a7bdec6141d7dfa2e26dfefd3cba8247817d))
* prevent raw MQTT payload debug logging ([#48](https://github.com/lachaux-remi/bambu-lab-discord/issues/48)) ([52baa76](https://github.com/lachaux-remi/bambu-lab-discord/commit/52baa7638a6bf33f1f445993981b756bdf938a7b))
* redact residual MQTT capture identifiers ([#47](https://github.com/lachaux-remi/bambu-lab-discord/issues/47)) ([aa87a33](https://github.com/lachaux-remi/bambu-lab-discord/commit/aa87a333f1570a66fc743d63a7ea06edd3700d34))
* sanitize MQTT debug captures ([#44](https://github.com/lachaux-remi/bambu-lab-discord/issues/44)) ([ff3ccd6](https://github.com/lachaux-remi/bambu-lab-discord/commit/ff3ccd630097278651f5f79336c316330df3ab4b))

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
