# TCL VS Code Extension - Architecture Documentation Guide

## Quick Start: Where to Look

### I want to understand how the extension works
→ Start with **CLAUDE.md** sections 1-2

### I want to see how components fit together visually
→ Reference **ARCHITECTURE_DIAGRAM.md**

### I want to understand a specific component
→ Look it up in **CLAUDE.md** section 2 or ARCHITECTURE_DIAGRAM.md

### I want to understand why a design decision was made
→ See **CLAUDE.md** section 4 (Non-Obvious Architectural Decisions)

### I want to add a new feature
→ Follow patterns in **CLAUDE.md** section 8 (Extending the Architecture)

### I want to modify an existing component
→ Check **CLAUDE.md** section 3 (Data Flows) for side effects

---

## Document Overview

### CLAUDE.md (Primary Architecture Document)
**Purpose:** Complete architectural reference for the extension

**Length:** 983 lines, 32 KB

**Key Sections:**
- Section 1: Project Summary
- Section 2: Key Components and Relationships (detailed)
  - 2.1: Extension Activation
  - 2.2: IntelliSense Providers (5 types)
  - 2.3: Formatter Architecture
  - 2.4: Debug Adapter
  - 2.5: Testing Framework
  - 2.6: Coverage Analysis
  - 2.7: Refactoring Support
  - 2.8: Tool Managers (5 managers)
- Section 3: Important Data Flows (4 flows)
- Section 4: Non-Obvious Architectural Decisions (9 decisions)
- Section 5: Extension Lifecycle and Cleanup
- Section 6: Configuration System
- Section 7: Testing and Development
- Section 8: Extending the Architecture
- Section 9: Key Files Reference
- Section 10: Summary of Key Principles

**Best Used For:**
- Understanding how specific components work
- Learning the rationale behind design decisions
- Following patterns when extending
- Reference material for implementation details

---

### ARCHITECTURE_DIAGRAM.md (Visual Reference)
**Purpose:** ASCII diagrams of all major architectural components

**Length:** 474 lines, 26 KB

**Key Diagrams:**
1. Extension Activation Flow (complete with all phases)
2. Data Layer - Central Knowledge Base (TCL_BUILTIN_COMMANDS structure)
3. Code Analysis Flow (how 6 analyzers process documents)
4. Provider Dependencies and Data Sharing
5. Formatter Architecture (dual-layer design)
6. Debug Adapter Architecture (protocol and state flow)
7. Test Execution Flow (discovery and execution)
8. Lazy Initialization Pattern (Phase 6)
9. Configuration Dependency Graph

**Best Used For:**
- Getting a visual overview of component relationships
- Understanding data flow between components
- Seeing the "big picture" quickly
- Reference during discussions about architecture

---

## Architecture at a Glance

### Layered Architecture

```
Extension Entry Point (activate function)
    ↓
    ├─ Data Layer (tclCommands.ts)
    │  └─ Central knowledge base
    │
    ├─ Provider Layer (6 providers)
    │  ├─ Completion
    │  ├─ Symbols
    │  ├─ Definition/Reference
    │  ├─ Hover
    │  ├─ Diagnostic
    │  └─ Code Actions
    │
    ├─ Feature Layers
    │  ├─ Formatter (2 layers: VS Code integration + pure logic)
    │  ├─ Debug (adapter + REPL)
    │  ├─ Testing (test provider + coverage)
    │  ├─ Refactoring (rename + extract)
    │  └─ Tools (5 managers, lazy-loaded)
    │
    └─ Configuration System (tcl.* settings)
```

### Key Design Patterns

1. **Layered Architecture:** Clear separation between data, providers, and features
2. **Phase-Based Initialization:** Immediate (1-5) vs Lazy (6)
3. **Single Source of Truth:** TCL_BUILTIN_COMMANDS used by multiple providers
4. **Event-Driven:** Responds to document changes, user actions, config updates
5. **Provider Pattern:** Each language feature is a separate provider
6. **Cache with Single Listener:** Per-document caching with workspace invalidation

---

## Component Quick Reference

### Data & Configuration
- **tclCommands.ts** - 800+ TCL commands (base, additional, Tk, Expect)
- **Configuration** - 10 user settings (format, diagnostics, paths)

### IntelliSense Providers (5 providers)
| Provider | File | Purpose |
|----------|------|---------|
| Completion | completionProvider.ts | Command/proc/var suggestions |
| Symbol | symbolProvider.ts | Document outline + workspace symbols |
| Definition | definitionProvider.ts | Go to definition + find references |
| Hover | hoverProvider.ts | Signature and documentation on hover |
| Diagnostic | diagnosticProvider.ts | Syntax checking and error reporting |

### Formatting
| Component | File | Purpose |
|-----------|------|---------|
| Format Provider | formattingProvider.ts | VS Code integration layer |
| Formatter | tclFormatter.ts | Pure formatting logic |

### Debug & REPL
| Component | File | Purpose |
|-----------|------|---------|
| Debug Factory | debugAdapterFactory.ts | Creates debug session |
| Debug Session | tclDebugAdapter.ts | Debug protocol implementation |
| REPL | tclREPL.ts | Terminal-based REPL |

### Testing & Coverage
| Component | File | Purpose |
|-----------|------|---------|
| Test Provider | testProvider.ts | Test discovery and execution |
| Coverage | coverageProvider.ts | Code coverage analysis |

### Refactoring
| Component | File | Purpose |
|-----------|------|---------|
| Rename | renameProvider.ts | Rename procedures/variables |
| Extract | extractProvider.ts | Extract procedures/variables |

### Tools (Phase 6 - Lazy Loaded)
| Component | File | Purpose |
|-----------|------|---------|
| Interpreter Mgr | interpreterManager.ts | Find and manage TCL installations |
| Package Mgr | packageManager.ts | Discover and manage packages |
| Dependency Mgr | dependencyManager.ts | Track project dependencies |
| Templates | projectTemplates.ts | Project scaffolding |
| Tasks | taskProvider.ts | VS Code task integration |

---

## Common Tasks & Where to Look

### Understanding a Feature
1. Read the component section in **CLAUDE.md** Section 2
2. Check the data flow in **CLAUDE.md** Section 3
3. Look at visual diagram in **ARCHITECTURE_DIAGRAM.md**
4. Review the implementation file listed in Section 9

### Adding a New Provider
1. Read **CLAUDE.md** Section 8 "Adding a New Provider"
2. Study an existing provider (e.g., HoverProvider)
3. Implement following the documented pattern
4. Register in extension.ts following the pattern shown

### Modifying Configuration
1. Add setting to package.json (contributes.configuration)
2. Read it in the relevant provider/tool
3. Update **CLAUDE.md** Section 6 Configuration System

### Extending Tool Managers
1. Create new manager class with initialize() method
2. Add to ensurePhase6Initialized() in extension.ts
3. Register command handlers that call ensurePhase6Initialized()
4. Follow pattern from existing managers

### Understanding Data Flow
1. Pick the data flow in **CLAUDE.md** Section 3
2. Trace the flow diagram
3. Understand which components interact
4. Check for side effects on related components

---

## Architecture Principles

The extension is built on these 10 principles:

1. **Separation of Concerns:** Each provider handles one language feature
2. **Single Source of Truth:** TCL commands defined once, used by multiple providers
3. **Performance through Caching:** Document content cached, invalidated on change
4. **Lazy Initialization:** Heavy features only initialized when first needed
5. **Configuration-Driven:** User preferences configure formatting, paths, features
6. **Terminal-Based Execution:** REPL, testing, debugging use system processes
7. **Workspace Awareness:** All analysis operates on entire workspace
8. **Error Handling:** Graceful degradation when optional features unavailable
9. **Extensibility:** Clear patterns for adding providers, tools, commands
10. **Event-Driven:** Responds to document changes, user actions, config updates

---

## File Structure Summary

```
src/
├── extension.ts              # Main entry point and activation
├── data/
│   └── tclCommands.ts        # Central TCL knowledge base
├── providers/                # IntelliSense providers (6 files)
│   ├── completionProvider.ts
│   ├── symbolProvider.ts
│   ├── definitionProvider.ts
│   ├── hoverProvider.ts
│   ├── diagnosticProvider.ts
│   └── codeActionProvider.ts
├── formatter/                # Formatting (2 files)
│   ├── formattingProvider.ts
│   └── tclFormatter.ts
├── debug/                    # Debug & REPL (3 files)
│   ├── debugAdapterFactory.ts
│   ├── tclDebugAdapter.ts
│   └── tclREPL.ts
├── testing/                  # Testing & coverage (2 files)
│   ├── testProvider.ts
│   └── coverageProvider.ts
├── refactoring/              # Refactoring (2 files)
│   ├── renameProvider.ts
│   └── extractProvider.ts
└── tools/                    # Tool managers (5 files)
    ├── interpreterManager.ts
    ├── packageManager.ts
    ├── dependencyManager.ts
    ├── projectTemplates.ts
    └── taskProvider.ts
```

Total: 19 implementation files organized in 8 directories

---

## When to Reference Each Document

### CLAUDE.md
- **Sections 1-2:** Getting started, understanding components
- **Section 3:** Modifying components (check for side effects)
- **Section 4:** Making architectural decisions
- **Section 5:** Adding/removing resources
- **Section 6:** Configuration questions
- **Section 8:** Adding new functionality
- **Section 9:** Finding specific files
- **Section 10:** Core principles

### ARCHITECTURE_DIAGRAM.md
- **Activation Flow:** Understanding initialization
- **Data Layer:** Understanding TCL command system
- **Code Analysis Flow:** Understanding provider pattern
- **Provider Dependencies:** Understanding relationships
- **Formatter Architecture:** Understanding formatting
- **Debug Architecture:** Understanding debugging
- **Test Execution:** Understanding testing
- **Lazy Initialization:** Understanding Phase 6
- **Configuration Graph:** Understanding settings

---

## Going Deeper

For complete details on any component, follow this pattern:

1. **Find the Overview** in CLAUDE.md Section 2.X
2. **Check the Data Flow** in CLAUDE.md Section 3
3. **Understand the Pattern** in CLAUDE.md Section 4 (if applicable)
4. **See the Diagram** in ARCHITECTURE_DIAGRAM.md
5. **Read the Code** in the implementation file
6. **Check the Tests** in src/test/

---

## For Future Development

When adding new features:

1. **Understand the Current Architecture** (read this guide)
2. **Identify the Architectural Layer** (where does it belong?)
3. **Follow Established Patterns** (look at similar components)
4. **Check Data Flows** (what existing data will it need?)
5. **Update Documentation** (update CLAUDE.md and ARCHITECTURE_DIAGRAM.md)

---

## Questions? Check These Sections

**"How does X work?"**
→ CLAUDE.md Section 2.X and ARCHITECTURE_DIAGRAM.md

**"Why was X designed that way?"**
→ CLAUDE.md Section 4 (Non-Obvious Architectural Decisions)

**"How does data flow between X and Y?"**
→ CLAUDE.md Section 3 (Important Data Flows)

**"How do I add a new Y?"**
→ CLAUDE.md Section 8 (Extending the Architecture)

**"What are the lifecycle implications of changing X?"**
→ CLAUDE.md Section 5 (Extension Lifecycle and Cleanup)

**"Which files are involved in X?"**
→ CLAUDE.md Section 9 (Key Files Reference)

**"What settings control X?"**
→ CLAUDE.md Section 6 (Configuration System)

---

This guide is designed to help you quickly find what you need in the architecture documentation. The two main documents (CLAUDE.md and ARCHITECTURE_DIAGRAM.md) provide comprehensive coverage of all aspects of the TCL VS Code extension's architecture.
