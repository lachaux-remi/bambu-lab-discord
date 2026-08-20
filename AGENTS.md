# AGENTS.md

This file provides guidance to all coding agents working in this repository.

## Git and Pull Request Policy

- Agents may create branches, commit changes, push branches, and open pull requests.
- Commit subjects and pull request titles must be written in English with a Conventional Commit prefix.
- Pull request descriptions must be written in French.
- Every pull request must be reviewed by the repository owner before it is merged.
- Only the repository owner may merge pull requests. Agents must never merge a pull request or enable auto-merge.
- Agents must not approve or close pull requests.
- After opening or updating a pull request, stop and wait for the repository owner's review.
- Never push directly to `master`.

## Project Overview

Bambu Lab Discord is a Discord bot that monitors Bambu Lab 3D printers via MQTT and sends real-time updates about print
jobs to Discord forum threads. It supports multiple printers, each with its own channel and automatic tag management.

The bot connects to printers' MQTT brokers, processes print status messages, and captures screenshots using the native
Bambu camera protocol. All images are attached directly to Discord messages (no external storage needed).

## Development Commands

### Build and Run

- `pnpm run build` - Clean and compile TypeScript to dist/
- `pnpm run start` - Run the compiled application from dist/
- `pnpm run local` - Run directly with tsx and load .env file
- `pnpm run local:watch` - Run with nodemon for auto-reload on file changes

### Debug Tools

- `pnpm run debug:mqtt` - Debug MQTT messages from printer
- `pnpm run debug:discord-test` - Test Discord notifications
- `pnpm run debug:rtc` - Test screenshot capture from printer
- `pnpm run dev:mqtt-emulator` - Run the local MQTT printer emulator

### Validation

- `pnpm run lint` - Run ESLint and Prettier checks
- `pnpm run test` - Run the Vitest suite
- `pnpm run test:coverage` - Run tests with coverage thresholds
- `pnpm run build` - Type-check and compile production output

## Project Structure

```
src/
├── index.ts                 # Composition root and process lifecycle
├── application.ts           # Ordered startup and idempotent shutdown
├── constants.ts             # Environment-backed settings
├── enums.ts                 # MessageCommand, PrintState, ForumTag
├── libs/
│   ├── bambu-tls/           # Trusted Bambu CA bundle and TLS helpers
│   ├── logger/              # Pino-based structured logging
│   ├── project/             # 3mf project preview extraction
│   └── rtc/                 # Native Bambu camera protocol
├── services/
│   ├── bambu-lab/           # MQTT client and camera/light control
│   ├── database/            # Encrypted, atomic JSON persistence
│   ├── discord/             # Discord client, commands, embeds, forum tags
│   ├── printer-manager/     # Printer lifecycle and notification coordinator
│   └── printer-status/      # Cumulative MQTT status model
├── tools/
│   ├── debug-discord-test.ts
│   ├── debug-mqtt.ts
│   ├── debug-rtc.ts
│   └── mock-mqtt-printer.ts
├── types/                   # Shared TypeScript declarations
└── utils/                   # Discord tag, print, and time utilities
```

## Architecture

### Core Components

**PrinterManager** (`src/services/printer-manager/index.ts`)

- Owns `BambuLabClient` instances and serializes start, stop, and restart operations per printer.
- Starts enabled printers; ordinary MQTT failures retry in the background, while startup TLS certificate failures fail
  closed.
- Owns print-state transitions, Discord delivery, progress thresholds, chamber-light timers, and active-thread recovery.
- Exposes live status and screenshot operations to Discord commands.

**BambuLabClient** (`src/services/bambu-lab/index.ts`)

- EventEmitter-based MQTT client connecting to a Bambu Lab printer
- Accepts PrinterConfig in constructor
- Subscribes to `device/{SERIAL}/report` topic
- Publishes "pushall" request to `device/{SERIAL}/request` on connection
- Emits `status` events with new and old status objects
- Serializes incoming MQTT processing through a promise queue.
- Camera captures for one client must remain serialized so light restoration completes before the next capture; the queue
  must continue after a failed capture.

**PrinterStatus** (`src/services/printer-status/index.ts`)

- State manager that processes MQTT messages and tracks printer state
- Handles two message types:
  - `PROJECT_FILE`: New print job metadata (downloads and extracts plate image from 3mf file)
  - `PUSH_STATUS`: Runtime updates (layers, progress, remaining time)
- Detects multicolor prints via AMS mapping
- Maintains cumulative status object and emits changes to BambuLabClient

**Application** (`src/application.ts`, `src/index.ts`)

- Loads and validates configuration before startup.
- Starts Discord before printers and stops printers before Discord.
- Rolls back started modules after startup failure and makes shutdown idempotent.
- Reconciles configured forum tags and registers slash commands before printer connections start.

### Print State Flow

```
UNKNOWN (initial) → PREPARE (job loaded) → RUNNING (printing) → FINISH/FAILED/IDLE
                                              ↓        ↑
                                           PAUSE ←──────┘
```

State transitions trigger specific Discord messages:

- IDLE/FINISH/FAILED/PREPARE → RUNNING: `printStarted` (creates new thread)
- RUNNING → FINISH (100%): `printFinished` (tags: Réussi)
- RUNNING → FINISH (<100%): `printCancelled` (tags: Échoué)
- RUNNING → FAILED: `printFailed` (tags: Échoué)
- RUNNING → IDLE: `printStopped` (tags: Échoué)
- RUNNING → PAUSE: `printPaused` (tags: En pause)
- PAUSE → RUNNING: `printResumed` (tags: En cours)
- UNKNOWN → PAUSE: `printRecovery`
- Progress updates sent every `NOTIFICATION_PERCENT` (default 5%)

### Discord Integration

The application uses Discord bot mode and requires `DISCORD_BOT_TOKEN`. Each printer stores its own forum channel; there
is no webhook fallback or global parent-channel setting.

- Creates a forum post per print job and persists the active thread for restart recovery.
- Reconciles canonical tags and configured printer-name tags at startup while preserving unrelated forum tags.
- Serializes forum tag mutations per channel to avoid lost concurrent updates.
- Updates thread tags based on print state.
- Canonical tags defined in `FORUM_TAG_DEFINITIONS`:
  - States: En cours, Réussi, Échoué, En pause, Attention
  - Colors: Multicolore, Monocolor

### Libraries

**Discord** (`src/services/discord/`)

- `bot.ts`: Discord.js client for forum/thread management
  - `initDiscordClient()`: Initialize the bot
  - `reconcileConfiguredForumTags()`: Reconcile canonical and printer tags on startup
  - `createPrintThread()`: Create forum post with initial embed
  - `sendToThread()`: Send message to existing thread
  - `updateThreadTags()`: Update thread tags based on state
  - `ensurePrinterTag()`: Create a tag for a printer in forum
- `commands/`: Administrative slash-command definitions and handlers
- `embeds/`: Notification embed builders

**RTC** (`src/libs/rtc/index.ts`)

- Captures JPEG screenshots from printer's camera using native Bambu protocol
- Direct TLS connection to printer on configurable port (default 6000)
- No external service required (ffmpeg, go2rtc, etc.)
- Functions:
  - `takeScreenshot(ip, accessCode, serial, port?)`: Captures a single JPEG frame from the printer
  - `takeScreenshotFromBambuStream(ip, accessCode, serial, port?)`: Low-level stream access
- Authentication uses username "bblp" and printer's access code
- The configured serial is used as the TLS server identity.

**Project** (`src/libs/project/index.ts`)

- Extracts project preview images from 3mf files
- Function:
  - `extractProjectImage(data)`: Downloads 3mf file, extracts `Metadata/plate_{N}.png` as Buffer
- Used to display project thumbnail in Discord embeds

**Logger** (`src/libs/logger/index.ts`)

- Pino-based logger with component-specific namespaces
- Debug mode controlled by `DEBUG=true` env var

**Database** (`src/services/database/index.ts`)

- Validated JSON persistence for printer configurations and active Discord threads.
- Uses atomic file replacement, restrictive permissions, file and directory synchronization, and fail-closed loading.
- Encrypts access codes with AES-256-GCM using `CONFIG_ENCRYPTION_KEY`; plaintext values are migrated on load.
- Stores printer configuration in `config/printers.json` and recovery mappings in `config/active-threads.json`.
- CRUD operations: `addPrinter`, `removePrinter`, `updatePrinter`, `getPrinter`, `getAllPrinters`

## Slash Commands

The bot supports the following Discord slash commands:

| Command                                                                       | Description                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------- |
| `/printer add <name> <ip> <serial> <access_code> <channel> [port] [rtc_port]` | Add and immediately start a printer          |
| `/printer remove <name>`                                                      | Stop and remove a printer                    |
| `/printer list`                                                               | List configured printers and runtime state   |
| `/printer status <name>`                                                      | Show connection and current print details    |
| `/printer screenshot <name>`                                                  | Post a real camera test in the printer forum |
| `/printer edit <name> [options]`                                              | Edit, enable, disable, or restart a printer  |

`/printer edit` supports display name, IP, serial, access code, forum channel, MQTT port, RTC port, and `enabled`.
Network ports are restricted to 1–65535. Configuration changes that affect a running connection restart the printer;
disabling it stops it immediately. All printer commands require Discord's **Manage Guild** permission.

## Environment Variables

Required configuration in `.env`:

```bash
# Discord bot token (required)
DISCORD_BOT_TOKEN=<bot token>

# Required as soon as at least one printer exists (base64-encoded 32-byte key)
CONFIG_ENCRYPTION_KEY=<openssl rand -base64 32>

# Notification customization
NOTIFICATION_PERCENT=5  # default
NOTIFICATION_FOOTER_TEXT=Bambu Lab Discord  # default
NOTIFICATION_FOOTER_ICON=<url>  # optional
NOTIFICATION_COLOR=#24a543  # default

# Operational delays
ERROR_LOG_COOLDOWN_MINUTES=1
MQTT_CONNECT_TIMEOUT_MS=30000
CHAMBER_LIGHT_OFF_DELAY_MINUTES=5
CHAMBER_LIGHT_WARMUP_MS=1500

# TLS validation; true is a temporary, dangerous diagnostic fallback only
BAMBU_TLS_INSECURE=false

# Debug logging
DEBUG=false  # default
LOG_FORMAT=auto
```

MQTT and RTC verify the printer certificate against the bundled Bambu CA set in `src/libs/bambu-tls/`. Keep certificate
validation enabled by default. The weekly `bambu-ca-bundle.yml` workflow reports upstream CA changes without trusting or
installing them automatically.

## TypeScript Configuration

- Target: ESNext with NodeNext module resolution
- Strict mode enabled
- Source: `src/**/*.ts` → Output: `dist/`
- Uses `tsx` for development, `tsc` for production builds

## Code Style

- Prettier enforced via ESLint plugin
- Import sorting with `@trivago/prettier-plugin-sort-imports`
- No console.log allowed (use logger instead)
- Curly braces required for all control structures
- Line width: 120 characters

## Pull Requests and Releases

- Release Please runs only after CI succeeds on `master`, maintains the release pull request, and publishes semver-tagged
  Docker images after the repository owner merges the release pull request.
- Release pull request titles must retain the conventional English Release Please format.
- Never replace a Release Please pull request body manually. Preserve both exact `---` separators and all generated
  content between them; Release Please reparses that machine-generated block to create the tag.
- Localize release text through `release-please-config.json`, not through manual edits to a generated release PR body.
- The `release-pr-body.yml` workflow validates these invariants for `release-please--*` branches.
- For every Release Please pull request an agent handles, post or update one French pull request comment titled
  `Checklist de validation terrain`; keep the generated pull request body untouched and avoid duplicate checklist
  comments. Include checkboxes for a real-printer MQTT status cycle, Discord thread/embed/image/tag delivery, an RTC
  screenshot with chamber-light restoration, MQTT outages shorter and longer than 60 seconds, recovery tag restoration,
  and bot restart during an active print without a duplicate thread. Add release-specific manual checks when its changes
  affect other external behavior. Whenever another pull request is added to the pending release, review and update the
  existing checklist comment for its new or changed manual test cases without resetting completed items. Unchecked items
  are review information, never authorization to merge.

## Key Types

- `PrinterConfig`: Configuration for a single printer (IP, serial, access code, forum channel, etc.)
- `BotConfig`: Root configuration containing all printers
- `Status`: Current printer state (state, layers, progress, project info, etc.)
- `PrintState`: Enum of possible states (UNKNOWN, PREPARE, RUNNING, PAUSE, FAILED, FINISH, IDLE)
- `MessageCommand`: MQTT message types (PUSH_STATUS, PROJECT_FILE)
- `ClientEvents`: Typed events for BambuLabClient EventEmitter

## Data Storage

Printer configurations are stored in `config/printers.json`; active Discord thread mappings are stored in
`config/active-threads.json`. Both are gitignored. Access codes are encrypted at rest, but these files and
`CONFIG_ENCRYPTION_KEY` remain sensitive and must never be committed or logged.

Example structure:

```json
{
  "version": 1,
  "printers": {
    "p1s-bureau": {
      "id": "p1s-bureau",
      "name": "P1S Bureau",
      "ip": "192.168.1.100",
      "port": 8883,
      "rtcPort": 6000,
      "serial": "ABC123",
      "accessCode": "enc:v1:<encrypted-value>",
      "forumChannelId": "123456789",
      "enabled": true,
      "createdAt": 1787240000000,
      "updatedAt": 1787240000000
    }
  }
}
```

## Diagnostic Data

`pnpm run debug:mqtt` writes a sanitized NDJSON capture. It redacts known credentials and pseudonymizes identifiers for
one capture, but agents and reviewers must still inspect generated diagnostics before sharing them. Never expose printer
access codes, Discord tokens, encryption keys, broker URLs, or unsanitized MQTT payloads.
