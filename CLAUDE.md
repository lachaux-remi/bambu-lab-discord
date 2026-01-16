# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bambu Lab Discord is a Discord notification bot that monitors a Bambu Lab 3D printer via MQTT and sends real-time updates about print jobs to Discord. The bot supports two modes:
1. **Webhook mode**: Simple notifications via Discord webhook
2. **Bot mode** (recommended): Full-featured with forum threads per print job, automatic tag management

The bot connects to the printer's MQTT broker, processes print status messages, captures screenshots via RTC, and uploads media to S3-compatible storage.

## Development Commands

### Build and Run
- `pnpm run build` - Clean and compile TypeScript to dist/
- `pnpm run start` - Run the compiled application from dist/
- `pnpm run local` - Run directly with tsx and load .env file
- `pnpm run local:watch` - Run with nodemon for auto-reload on file changes

### Debug Tools
- `pnpm run debug:mqtt` - Debug MQTT messages from printer
- `pnpm run debug:discord-test` - Test Discord notifications

### Linting
- ESLint configuration: `eslint.config.mjs`
- Prettier configuration: `.prettierrc`

## Project Structure

```
src/
├── index.ts              # Main application entry point & state machine
├── constants.ts          # Environment variables & configuration
├── enums.ts              # MessageCommand, PrintState, ContentType enums
├── libs/                 # Reusable library modules
│   ├── discord/
│   │   ├── index.ts      # Webhook client & exports
│   │   └── bot.ts        # Discord bot client (threads, forum tags)
│   ├── logger/           # Pino-based logging
│   ├── rtc/              # RTC screenshot capture
│   └── s3-storage/       # S3 upload functions (project images, screenshots)
├── services/             # Business logic services
│   ├── bambu-lab/        # MQTT client (BambuLabClient class)
│   ├── printer-status/   # State manager (PrinterStatus class)
│   └── messages/         # Discord embed builders for each notification type
│       ├── print-started.ts
│       ├── print-progress.ts
│       ├── print-finished.ts
│       ├── print-failed.ts
│       ├── print-cancelled.ts
│       ├── print-paused.ts
│       ├── print-resumed.ts
│       ├── print-stopped.ts
│       └── print-recovery.ts
├── types/                # TypeScript type definitions (.d.ts files)
│   ├── client-events.d.ts    # Event types for BambuLabClient
│   ├── discord.d.ts          # Discord-related types (ForumTagDefinition, ForumTagPayload, etc.)
│   ├── general.d.ts          # Utility types (IntRange, StringNumber, HexColor)
│   ├── printer-messages.d.ts # MQTT message types
│   ├── printer-status.d.ts   # Status interface
│   ├── project-file.d.ts     # PROJECT_FILE command types
│   ├── push-status.d.ts      # PUSH_STATUS command types
│   └── s3-storage.d.ts       # S3 upload types
├── utils/                # Utility functions
│   ├── discord-tags.util.ts  # Tag name resolution
│   ├── print.util.ts     # Multicolor detection helpers
│   └── time.util.ts      # Time formatting utilities
└── tools/                # Debug/development tools
    ├── debug-mqtt.ts
    └── debug-discord-test.ts
```

## Architecture

### Core Components

**BambuLabClient** (`src/services/bambu-lab/index.ts`)
- EventEmitter-based MQTT client connecting to Bambu Lab printer
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

**RTC** (`src/libs/rtc/index.ts`)
- Fetches JPEG screenshots from printer's RTC endpoint
- Returns Buffer or null on failure

**S3 Storage** (`src/libs/s3-storage/index.ts`)
- Two upload functions with retry logic (max 5 attempts):
  1. `uploadProjectImage`: Downloads 3mf file from printer, extracts `Metadata/plate_{N}.png`, uploads to S3
  2. `uploadScreenshot`: Fetches from RTC, uploads timestamped JPEG
- Uses AWS SDK v2 with S3-compatible endpoints

**Logger** (`src/libs/logger/index.ts`)
- Pino-based logger with component-specific namespaces
- Debug mode controlled by `DEBUG=true` env var

## Environment Variables

Required configuration in `.env`:

```bash
# Printer connection
PRINTER_ADDRESS=<printer IP>
PRINTER_PORT=8883
PRINTER_SERIAL_NUMBER=<serial>
PRINTER_ACCESS_CODE=<code>
PRINTER_USERNAME=bblp  # default

# Discord webhook (fallback mode)
DISCORD_WEBHOOK_NOTIFICATION_ID=<id>
DISCORD_WEBHOOK_NOTIFICATION_TOKEN=<token>

# Discord bot (recommended for full features)
DISCORD_BOT_TOKEN=<bot token>
DISCORD_PARENT_CHANNEL_ID=<forum channel id>

# RTC screenshot endpoint
RTC_URL=<rtc endpoint>

# S3-compatible storage
AWS_ENDPOINT=<endpoint>
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
AWS_REGION=eu-west-3  # default
AWS_BUCKET=bambu-lab-p1s  # default

# Notification customization
NOTIFICATION_PERCENT=5  # default
NOTIFICATION_FOOTER_TEXT=Bambu Lab Discord  # default
NOTIFICATION_FOOTER_ICON=<url>  # default uses S3
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

- `Status`: Current printer state (state, layers, progress, project info, etc.)
- `PrintState`: Enum of possible states (UNKNOWN, PREPARE, RUNNING, PAUSE, FAILED, FINISH, IDLE)
- `MessageCommand`: MQTT message types (PUSH_STATUS, PROJECT_FILE)
- `ClientEvents`: Typed events for BambuLabClient EventEmitter

## Known Improvements To Consider

1. **AWS SDK Migration**: Currently using AWS SDK v2 (`aws-sdk`), should migrate to v3 (`@aws-sdk/client-s3`)
2. **Unused utility**: `getDiscordTagsForStatus` in `discord-tags.util.ts` is defined but not currently used
3. **Delete old debug logs**: `mqtt-debug-*.log` files in root (now in `.gitignore`)
