# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Linting

- ESLint configuration: `eslint.config.mjs`
- Prettier configuration: `.prettierrc`

## Project Structure

```
src/
├── index.ts              # Main application entry point
├── constants.ts          # Environment variables & configuration
├── enums.ts              # MessageCommand, PrintState enums
├── libs/                 # Reusable stateless library modules
│   ├── logger/           # Pino-based logging
│   ├── project/          # Project file handling (extract preview image)
│   └── rtc/              # RTC screenshot capture (native Bambu protocol)
├── services/             # Stateful business logic services
│   ├── bambu-lab/        # MQTT client (BambuLabClient class)
│   ├── database/         # JSON file persistence for printer configs
│   ├── discord/          # Discord bot service
│   │   ├── index.ts      # Exports
│   │   ├── bot.ts        # Discord client, threads, forum tags
│   │   ├── commands/     # Slash commands (/printer add, remove, list, etc.)
│   │   └── embeds/       # Discord embed builders for notifications
│   │       ├── base.ts
│   │       ├── print-started.ts
│   │       ├── print-progress.ts
│   │       ├── print-finished.ts
│   │       ├── print-failed.ts
│   │       ├── print-cancelled.ts
│   │       ├── print-paused.ts
│   │       ├── print-resumed.ts
│   │       ├── print-stopped.ts
│   │       └── print-recovery.ts
│   ├── printer-manager/  # Manages multiple printer instances
│   └── printer-status/   # State manager (PrinterStatus class)
├── types/                # TypeScript type definitions (.d.ts files)
│   ├── client-events.d.ts
│   ├── discord.d.ts
│   ├── general.d.ts
│   ├── printer-config.d.ts   # PrinterConfig, BotConfig interfaces
│   ├── printer-messages.d.ts
│   ├── printer-status.d.ts
│   ├── project-file.d.ts
│   └── push-status.d.ts
├── utils/                # Utility functions
│   ├── discord-tags.util.ts
│   ├── print.util.ts
│   └── time.util.ts
└── tools/                # Debug/development tools
    ├── debug-mqtt.ts
    ├── debug-rtc.ts
    └── debug-discord-test.ts
```

## Architecture

### Core Components

**PrinterManager** (`src/services/printer-manager/index.ts`)

- Manages multiple BambuLabClient instances
- Starts/stops printers based on configuration
- Handles status changes and dispatches to Discord

**BambuLabClient** (`src/services/bambu-lab/index.ts`)

- EventEmitter-based MQTT client connecting to a Bambu Lab printer
- Accepts PrinterConfig in constructor
- Subscribes to `device/{SERIAL}/report` topic
- Publishes "pushall" request to `device/{SERIAL}/request` on connection
- Emits `status` events with new and old status objects

**PrinterStatus** (`src/services/printer-status/index.ts`)

- State manager that processes MQTT messages and tracks printer state
- Handles two message types:
  - `PROJECT_FILE`: New print job metadata (downloads and extracts plate image from 3mf file)
  - `PUSH_STATUS`: Runtime updates (layers, progress, remaining time)
- Detects multicolor prints via AMS mapping
- Maintains cumulative status object and emits changes to BambuLabClient

**Main Application** (`src/index.ts`)

- State machine that listens for status events and triggers Discord notifications
- Tracks `lastProgressPercent` to send notifications at configurable intervals
- Manages thread creation and tag updates for forum mode
- Uses `printThreads` Map to track active print threads by unique key

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

**Webhook Mode** (fallback):

- Simple webhook notifications
- No thread management

**Bot Mode** (when `DISCORD_BOT_TOKEN` and `DISCORD_PARENT_CHANNEL_ID` are set):

- Creates forum posts (threads) per print job
- Auto-syncs forum tags on startup (`ensureForumTags`)
- Updates thread tags based on print state
- Canonical tags defined in `FORUM_TAG_DEFINITIONS`:
  - States: En cours, Réussi, Échoué, En pause, Attention
  - Colors: Multicolore, Monocolor

### Libraries

**Discord** (`src/libs/discord/`)

- `index.ts`: WebhookClient wrapper, exports bot functions
- `bot.ts`: Full Discord.js client for thread/forum management
  - `initDiscordClient()`: Initialize bot and sync forum tags
  - `createPrintThread()`: Create forum post with initial embed
  - `sendToThread()`: Send message to existing thread
  - `updateThreadTags()`: Update thread tags based on state
  - `archiveThread()`: Archive completed threads
  - `ensurePrinterTag()`: Create a tag for a printer in forum

**RTC** (`src/libs/rtc/index.ts`)

- Captures JPEG screenshots from printer's camera using native Bambu protocol
- Direct TLS connection to printer on configurable port (default 6000)
- No external service required (ffmpeg, go2rtc, etc.)
- Functions:
  - `takeScreenshot(ip, accessCode, port?)`: Captures a single JPEG frame from the printer
  - `takeScreenshotFromBambuStream(ip, accessCode, port?)`: Low-level function for direct stream access
- Authentication uses username "bblp" and printer's access code

**Project** (`src/libs/project/index.ts`)

- Extracts project preview images from 3mf files
- Function:
  - `extractProjectImage(data)`: Downloads 3mf file, extracts `Metadata/plate_{N}.png` as Buffer
- Used to display project thumbnail in Discord embeds

**Logger** (`src/libs/logger/index.ts`)

- Pino-based logger with component-specific namespaces
- Debug mode controlled by `DEBUG=true` env var

**Database** (`src/services/database/index.ts`)

- JSON file persistence for printer configurations
- Stored in `config/printers.json`
- CRUD operations: `addPrinter`, `removePrinter`, `updatePrinter`, `getPrinter`, `getAllPrinters`

## Slash Commands

The bot supports the following Discord slash commands:

| Command                                                                        | Description                    |
|--------------------------------------------------------------------------------|--------------------------------|
| `/printer add <name> <ip> <serial> <access_code> <channel> [port] [rtc_port]`  | Add a new printer              |
| `/printer remove <name>`                                                       | Remove a printer               |
| `/printer list`                                                                | List all configured printers   |
| `/printer edit <name> [options] [rtc_port]`                                    | Edit a printer's configuration |

## Environment Variables

Required configuration in `.env`:

```bash
# Discord bot token (required)
DISCORD_BOT_TOKEN=<bot token>

# Notification customization
NOTIFICATION_PERCENT=5  # default
NOTIFICATION_FOOTER_TEXT=Bambu Lab Discord  # default
NOTIFICATION_FOOTER_ICON=<url>  # optional
NOTIFICATION_COLOR=#24a543  # default

# Debug logging
DEBUG=false  # default
```

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

## Key Types

- `PrinterConfig`: Configuration for a single printer (IP, serial, access code, forum channel, etc.)
- `BotConfig`: Root configuration containing all printers
- `Status`: Current printer state (state, layers, progress, project info, etc.)
- `PrintState`: Enum of possible states (UNKNOWN, PREPARE, RUNNING, PAUSE, FAILED, FINISH, IDLE)
- `MessageCommand`: MQTT message types (PUSH_STATUS, PROJECT_FILE)
- `ClientEvents`: Typed events for BambuLabClient EventEmitter

## Data Storage

Printer configurations are stored in `config/printers.json` (gitignored for security).
This file contains sensitive information like access codes.

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
      "serial": "ABC123",
      "accessCode": "xxx",
      "forumChannelId": "123456789",
      "enabled": true
    }
  }
}
```

## Known Improvements To Consider

1. **AWS SDK Migration**: Currently using AWS SDK v2 (`aws-sdk`), should migrate to v3 (`@aws-sdk/client-s3`)
2. **Unused utilities in `print.util.ts`**: `isMulticolorPrintV2` and `getFilamentCount` are defined but not currently
   used
