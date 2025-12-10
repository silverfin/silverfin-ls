# Liquid Language Server

Language Server Protocol (LSP) implementation for Silverfin Liquid templates.

## Features

**Hover Information**

- Tag documentation (assign, capture, result, etc.)
- Translation keys and values (`{% t= %}`)

**Go to Definition**

- Navigate to shared parts and text parts
- Translations and variables

**Context-Aware**

- Identify template structure and relationships (parts and shared parts)
- Creates a map of relationships between main templates, text parts, and shared parts
- Tracks line ranges for accurate navigation
- Parses liquid using Tree-sitter

## Configuration

The language server supports the following configuration options:

### Hover Documentation

You can disable hover documentation by setting `hover.enabled` to `false`.

### Template Context Resolution

When working from shared parts, the language server needs to know which template context to use since shared parts can be included in multiple templates. The language server automatically tracks the last visited template file (reconciliation text, export file, or account template) and uses that as the context for shared parts.

**How it works:**
- When you open, edit, or trigger any LSP feature (hover, go-to-definition, find references) on a main template file, it becomes the active context
- When you switch to a shared part, the language server uses the last main template you interacted with
- Works seamlessly with buffer/tab switching in Neovim and VS Code - no manual configuration needed

**VS Code (settings.json):**

```json
{
  "liquidLS": {
    "hover": {
      "enabled": false
    },
    "logLevel": "debug"
  }
}
```

**Neovim:**

```lua
init_options = {
  hover = {
    enabled = false
  },
  logLevel = "debug"
}
```
