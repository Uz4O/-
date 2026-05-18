# Mobile UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the frontend as a phone-first betting workflow without visible step navigation, while preserving existing OCR, AI parsing, review, and result behavior.

**Architecture:** Keep the existing React state machine (`input`, `review`, `result`) internal, but remove visible stepper UI. Reorganize markup into mobile-first surfaces: a compact app shell, a focused input page, message-style review cards, and a result-first summary page. Use CSS to make mobile the primary layout and desktop a widened version of the same vertical flow.

**Tech Stack:** React 19, Vite 7, lucide-react, Node built-in test runner.

---

### Task 1: Add Layout Regression Tests

**Files:**
- Modify: `src/styles.test.js`

- [ ] Assert the UI no longer exposes `.stepper` layout styles.
- [ ] Assert `.screenshot-panel` is not absolutely positioned.
- [ ] Assert mobile breakpoints use a single-column app shell.
- [ ] Assert result metrics are styled as a prominent grid.

### Task 2: Refactor App Markup

**Files:**
- Modify: `src/App.jsx`

- [ ] Remove the visible stepper block.
- [ ] Replace top/status structure with a compact mobile app header and current-action status strip.
- [ ] Reorder input page so manual text is primary and OCR actions are normal stacked controls.
- [ ] Rework review rows into message-style cards with clear confirm/ignore actions.
- [ ] Move result amount summary before draw controls and winners.

### Task 3: Replace Layout CSS

**Files:**
- Modify: `src/styles.css`

- [ ] Add mobile-first shell, header, status strip, input, review, and result styles.
- [ ] Remove or override absolute upload placement and old desktop-heavy workspace rules.
- [ ] Keep operational styling: restrained colors, compact controls, large touch targets.
- [ ] Preserve responsive desktop behavior as a wider single-column layout.

### Task 4: Verify And Deploy

**Commands:**
- `npm.cmd run test`
- `npm.cmd run build`
- Sync to `/opt/mark-six` excluding private/generated files.
- On server: `npm install`, `npm run test`, `npm run build`, `pm2 restart mark-six-api mark-six-ocr --update-env`, `pm2 status`, `/api/health`.
