# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Foxglove Studio extension that provides RoboCup SSL visualization capabilities through a custom panel. The extension renders SVG-based visualizations from ROS topics in real-time.

### Core Architecture

- **Extension Entry Point**: `src/index.ts` - Registers the panel with Foxglove Studio
- **Main Panel Component**: `src/crane_visualizer_panel.tsx` - React component handling SVG visualization
- **Data Flow**: Subscribes to ROS topics (default: `/aggregated_svgs`) and renders hierarchical SVG data

### Key Data Structures

```typescript
interface SvgLayerArray {
  svg_primitive_arrays: SvgPrimitiveArray[];
}

interface SvgPrimitiveArray {
  layer: string; // "parent/child1/child2" hierarchical path
  svg_primitives: string[];
}

// Update topic interface for layer-specific updates
interface SvgLayerUpdate {
  layer: string; // "parent/child1/child2" hierarchical path
  operation: "append" | "replace" | "clear"; // Operation type
  svg_primitives: string[]; // SVG primitive array
}

interface SvgUpdateArray {
  updates: SvgLayerUpdate[];
}
```

## Development Commands

### Build and Development
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run clean        # Remove dist/ directory
```

### Foxglove Integration
```bash
npm run local-install    # Build and install extension to local Foxglove Studio
npm run foxglove:dev     # Development build with Foxglove CLI
npm run foxglove:package # Package extension into .foxe file
```

### Testing and Quality
```bash
npx tsc                  # Type checking
npx eslint src/          # Linting
```

## Panel Configuration

The panel supports these configurable settings organized into logical groups:

### Topic Settings
- **Snapshot Topic**: Complete state topic (default: `/aggregated_svgs`) - low frequency, full state
- **Update Topic**: Layer-specific updates topic (default: `/visualizer_svgs`) - high frequency, incremental updates
- **Enable Update Topic**: Toggle to use only snapshot topic or both topics

### Performance Settings
- **History Duration**: Maximum time to keep message history (default: 300 seconds)
- **History Size**: Maximum number of messages to keep in memory (default: 1000)

### Display Settings
- **Background Color**: RGBA color picker for canvas background
- **ViewBox Width**: Controls zoom level and field size (default: 10000)

### Namespaces (Layer Display Control)
- **Layer Visibility**: Hierarchical namespace-based show/hide controls for each SVG layer

## Key Features

- **Dual Topic Support**: Handles both snapshot (`/aggregated_svgs`) and update (`/visualizer_svgs`) topics for optimized logging
- **Time-Aware Rendering**: Supports Foxglove Studio's time seeking with message composition at any point in time
- **Layer Update Operations**: Supports append, replace, and clear operations for individual layers
- **Interactive Viewport**: Mouse drag to pan, wheel scroll to zoom, Ctrl+0 to reset view
- **Smart Message Composition**: Automatically combines latest snapshot with subsequent updates for accurate time-based visualization
- **Memory Management**: Automatic cleanup of old messages based on configurable time and size limits
- **Dynamic Layer Management**: Hierarchical namespace-based show/hide controls with automatic discovery
- **Performance Optimized**: Uses React hooks, efficient rendering, and history management for large datasets

## Framework Details

- **TypeScript**: ES2020 target with strict mode
- **React 17**: Functional components with hooks
- **Foxglove Extension SDK**: Version 2.5.1
- **ESLint**: Configured with Foxglove's base, React, and TypeScript configs

## Development Notes

- Extension builds to `dist/` directory which is packaged into `.foxe` files
- Uses `dangerouslySetInnerHTML` for direct SVG string injection for performance
- Implements proper cleanup and subscription management for Foxglove Studio integration
- Settings tree dynamically generates controls based on incoming data namespaces

### Message Processing Architecture
- **Snapshot Messages**: Complete state stored in `aggregatedMessages` Map with timestamp keys
- **Update Messages**: Incremental changes stored in `updateMessages` Map with timestamp keys
- **Composition Logic**: `composeMessagesAtTime()` finds latest snapshot before target time and applies subsequent updates
- **Time Seeking**: Uses `renderState.currentTime` to detect time changes and recompose visualization

### Memory Management
- Automatic cleanup runs every 30 seconds to remove old messages
- Configurable history duration (default: 5 minutes) and size limits (default: 1000 messages)
- Messages sorted by timestamp with newest kept when size limits are exceeded

### Error Handling
- Validation of message structures before processing
- Graceful degradation when update topic is disabled or unavailable
- Console warnings for malformed messages with continued operation