# Guide de dépannage - Problèmes d'événements MQTT

## Problèmes récents avec les nouvelles versions firmware

Depuis les mises à jour récentes du firmware Bambu Lab, certains champs des messages MQTT peuvent être absents ou modifiés, causant des problèmes avec la détection des événements d'impression.

### ⚠️ Problème critique identifié et corrigé

**Symptôme :** Les notifications ne se déclenchent plus ou sont très irrégulières.

**Cause :** Le firmware moderne de Bambu Lab utilise un **système de messages incrémentaux** :
- Premier message (`"msg": 0`) : État complet avec tous les champs
- Messages suivants (`"msg": 1`) : Seulement les champs qui ont changé

L'ancienne version du bot attendait que chaque message contienne `gcode_state`, `layer_num`, etc., mais ces champs ne sont envoyés que dans le premier message ou quand ils changent !

**Solution :** Version corrigée (voir CHANGELOG). Le bot maintient maintenant un état cumulatif et met à jour les champs présents dans chaque message incrémental.

## Améliorations apportées

### 1. Logs de débogage détaillés

Des logs ont été ajoutés à tous les niveaux du système pour mieux comprendre ce qui se passe :

- **BambuLabClient** : Log de tous les messages MQTT reçus avec leur type
- **PrinterStatus** : Log de chaque mise à jour de statut avec les champs reçus
- **Application principale** : Log de toutes les transitions d'état

### 2. Types plus permissifs

Les interfaces TypeScript ont été rendues plus flexibles :
- Tous les champs de `PushStatusCommand` sont maintenant optionnels
- Tous les champs de `ProjectFileCommand` sont maintenant optionnels
- Le code vérifie l'existence de chaque champ avant de l'utiliser

### 3. Script de débogage MQTT

Un nouveau script `debug-mqtt.ts` permet de capturer et afficher tous les messages MQTT bruts.

## Comment diagnostiquer les problèmes

### Étape 1 : Activer le mode debug

Ajoutez dans votre `.env` :
```env
DEBUG=true
```

### Étape 2 : Lancer l'application avec logs

```bash
pnpm run local
```

Vous verrez maintenant des logs détaillés comme :
```
[BambuLab] Received message - key: print, command: push_status
[PrinterStatus] Push status received - state: RUNNING, layer: 45/120, percent: 37
[Application] State transition detected - PREPARE → RUNNING
```

### Étape 3 : Utiliser le script de débogage MQTT

Pour voir les messages MQTT bruts sans filtrage :

```bash
pnpm run debug:mqtt
```

Ce script affiche :
- Tous les messages MQTT reçus en format JSON complet
- Les détails des messages `print` de manière lisible
- Les champs exactement tels qu'envoyés par l'imprimante

**Exemple de sortie :**
```
================================================================================
📨 Message received - Key: print
================================================================================
{
  "print": {
    "command": "push_status",
    "gcode_state": "RUNNING",
    "mc_percent": 42,
    "layer_num": 128,
    "total_layer_num": 301,
    "mc_remaining_time": 145,
    "subtask_name": "my_print_job"
  }
}
────────────────────────────────────────────────────────────────────────────

📋 Print message details:
   Command: push_status
   State: RUNNING
   Progress: 42%
   Layer: 128/301
   Project: my_print_job
   Remaining: 145min
────────────────────────────────────────────────────────────────────────────
```

## Problèmes courants et solutions

### Les événements ne se déclenchent pas

**Symptômes :** Aucune notification Discord même quand l'imprimante imprime

**Diagnostic :**
1. Lancez `pnpm run debug:mqtt`
2. Vérifiez que vous recevez bien des messages
3. Regardez le champ `command` dans les messages

**Solutions possibles :**
- Si vous ne recevez aucun message : problème de connexion MQTT (vérifier IP, serial, access code)
- Si vous recevez des messages mais avec un `command` différent de `push_status` ou `project_file` : le firmware utilise de nouvelles commandes

### Les transitions d'état ne fonctionnent pas

**Symptômes :** Messages reçus mais pas de notifications Discord

**Diagnostic :**
1. Activez `DEBUG=true`
2. Cherchez dans les logs : `State transition detected`
3. Vérifiez les valeurs de `gcode_state`

**Solutions possibles :**
- Si `gcode_state` a de nouvelles valeurs : ajoutez-les dans `src/enums.ts`
- Si les transitions ne correspondent pas : vérifiez la logique dans `src/index.ts`

### Les images de projet ne s'affichent pas

**Symptômes :** Notifications envoyées mais sans image de prévisualisation

**Diagnostic :**
1. Vérifiez les logs : `Project file received`
2. Regardez si `url`, `model_id`, `subtask_name`, `plate_idx` sont présents

**Solutions possibles :**
- Si l'URL est manquante ou ne commence pas par `https://` : l'imprimante n'envoie plus l'URL
- Vérifiez que votre configuration S3 est correcte

### Nouveaux champs ou commandes MQTT

**Symptômes :** Messages inconnus dans `debug:mqtt`

**Solution :**
1. Notez la nouvelle commande dans les logs
2. Ajoutez-la dans `src/enums.ts` :
   ```typescript
   export enum MessageCommand {
     PUSH_STATUS = "push_status",
     PROJECT_FILE = "project_file",
     NOUVELLE_COMMANDE = "nouvelle_commande"  // Ajoutez ici
   }
   ```
3. Créez un nouveau type dans `src/types/`
4. Gérez-le dans `src/services/printer-status/index.ts`

## Vérifications de base

### Connexion MQTT
```bash
# Dans les logs, cherchez :
[BambuLab] Connected to printer
```

Si vous ne voyez pas ce message, vérifiez :
- `PRINTER_ADDRESS` : IP correcte ?
- `PRINTER_SERIAL_NUMBER` : Serial exact ?
- `PRINTER_ACCESS_CODE` : Code valide ?
- Port 8883 accessible ?

### Messages reçus
```bash
# Lancez le debug et lancez une impression
pnpm run debug:mqtt
```

Vous devriez voir plusieurs messages `project_file` suivis de `push_status` régulièrement.

## Rapporter un problème

Si le problème persiste, ouvrez une issue avec :
1. Version du firmware de l'imprimante
2. Logs complets de `pnpm run debug:mqtt` pendant une impression
3. Logs de l'application avec `DEBUG=true`
4. Description du comportement attendu vs réel

## Informations utiles

### États d'impression possibles
- `UNKNOWN` : État initial à la connexion
- `PREPARE` : Préparation de l'impression
- `RUNNING` : Impression en cours
- `PAUSE` : Impression en pause
- `FINISH` : Impression terminée avec succès
- `FAILED` : Impression échouée
- `IDLE` : Imprimante inactive

### Commandes MQTT connues
- `push_status` : Mise à jour de statut en temps réel
- `project_file` : Métadonnées du projet avant impression

### Topics MQTT
- Subscribe : `device/{SERIAL}/report`
- Publish : `device/{SERIAL}/request`
