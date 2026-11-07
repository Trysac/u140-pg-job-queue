# 0001. Record architecture decisions

- Status: accepted
- Date: 2026

## Context

Decisions about this utility's design, dependencies and public API need to be understandable later, by people
and by coding agents that have no access to the original conversation.

## Decision

We record every significant decision as a numbered Markdown file in `docs/decisions/`, named
`NNNN-short-title.md`, with the sections Context, Decision and Consequences. Records are immutable once
accepted; a later record supersedes an earlier one and links to it.

## Consequences

- The reasoning behind the code is versioned next to it.
- The documentation check requires at least one record in `docs/decisions/`.
- Changing a past decision requires a new record instead of rewriting history.
