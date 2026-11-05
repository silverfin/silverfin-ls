# Changelog

All notable changes to silverfin-ls are listed here, newest first.

## 0.1.1

### Fixed

- Go-to-definition, references and hover now work when the workspace contains several market repos (e.g. a `Silverfin/` folder with `be_market/` and `nl_market/` inside). The language server finds the market repo from the file you're editing instead of from the folder you opened.
- Shared parts no longer use a template from another market repo as their context.

## 0.1.0

First release: go-to-definition, go-to-references and translation hover for Silverfin Liquid templates, including shared parts and text parts.
