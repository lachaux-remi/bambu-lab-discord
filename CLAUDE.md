# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bambu Lab Discord is a Discord notification bot that monitors a Bambu Lab 3D printer via MQTT and sends real-time updates about print jobs to a Discord webhook. The bot connects to the printer's MQTT broker, processes print status messages, captures screenshots via RTC, and uploads media to S3-compatible storage.

## Development Commands

### Build and Run
- `pnpm run build` - Clean and compile TypeScript to dist/
- `pnpm run start` - Run the compiled application from dist/
- `pnpm run local` - Run directly with tsx and load .env file
- `pnpm run local:watch` - Run with nodemon for auto-reload on file changes

### Linting
- ESLint configuration: `eslint.config.mjs`
- Prettier configuration: `.prettierrc`
- No explicit lint script defined in package.json

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
- Maintains cumulative status object and emits changes to BambuLabClient

**Main Application** (`src/index.ts`)
- State machine that listens for status events and triggers Discord notifications
- Tracks `lastProgressPercent` to send notifications at configurable intervals
- Handles state transitions between: UNKNOWN → PREPARE → RUNNING → PAUSE/FINISH/FAILED/IDLE

### Print State Flow

```
UNKNOWN (initial) → PREPARE (job loaded) → RUNNING (printing) → FINISH/FAILED/IDLE
                                              ↓        ↑
                                           PAUSE ←──────┘
```

State transitions trigger specific Discord messages:
- IDLE/FINISH/FAILED/PREPARE → RUNNING: `printStarted`
- RUNNING → FINISH: `printFinished`
- RUNNING → FAILED: `printFailed`
- RUNNING → IDLE: `printStopped`
- RUNNING → PAUSE: `printPaused`
- PAUSE → RUNNING: `printResumed`
- UNKNOWN → PAUSE: `printRecovery`
- Progress updates sent every `NOTIFICATION_PERCENT` (default 5%)

### Message Handlers

Located in `src/services/messages/`:
- Each handler returns a Discord.js `EmbedBuilder`
- French language notifications (configurable via NOTIFICATION_* env vars)
- Some handlers attach screenshots from RTC or project images from S3

### Libraries

**Discord** (`src/libs/discord/index.ts`)
- Wrapper for Discord WebhookClient
- Single function: `sendWebhookMessage(embed: EmbedBuilder)`

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

```
# Printer connection
PRINTER_ADDRESS=<printer IP>
PRINTER_PORT=8883
PRINTER_SERIAL_NUMBER=<serial>
PRINTER_ACCESS_CODE=<code>
PRINTER_USERNAME=bblp  # default

# Discord webhook
DISCORD_WEBHOOK_NOTIFICATION_ID=<id>
DISCORD_WEBHOOK_NOTIFICATION_TOKEN=<token>

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
