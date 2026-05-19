# Changelog

All notable changes to the "AL Productivity Pack" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-19

### Added

- **Page Script Generator** — Convert human-readable repro steps into BC Page Scripting YAML
  - Natural DSL syntax: `Open`, `Click`, `Set`, `In "Part" Set`, `Confirm`, `Choose`, `Validate`, `Wait`
  - Quotes optional on field names (e.g., `Set Name = "Value"` works)
  - Intelligent field resolution from AL page sources (workspace files + `.alpackages`)
  - QuickPick field selector when manual mapping is needed — shows all fields available on the page
  - Handles system dialogs (Confirm/Choose) with correct automationIds
  - Generates proper `invoke` actions including `invokeType: New` for list page "New" buttons
  - Subpage/lines input with correct part → page → repeater path structure
  - Saves output to `.page-scripts/` directory

### Fixed

- Field resolver now handles both quoted and unquoted AL field declarations
- Removed 500-file cap on page file discovery (base app has ~2600 pages)

## [0.1.0] - 2025-05-17

### Added

- **Event Subscriber Finder** — Search and discover all published events across workspace
- **Subscriber Mapper** — View all event subscribers and their targets
- **Boilerplate Generator** — Generate correct subscriber code from any event
- **Event Chain Visualization** — See all events in an object in execution order
- **Dead Subscriber Detection** — Find subscribers pointing to non-existent events
- **AL Events Explorer** — Tree view in sidebar showing events grouped by object
- Auto-indexing on workspace activation
- File watcher for automatic re-indexing on changes
- Support for `.alpackages` base app symbol scanning
- Configurable search paths for additional AL sources
