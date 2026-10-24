# Tasks: MakeWeight

- [x] 1. Project setup: Node.js, folders, package.json, .gitignore, Kiro steering (product.md, tech.md), test-on-save and safety-review hooks
- [x] 1.1 Publish to a public GitHub repo: https://github.com/brendansoeung/Hackachusetts
- [x] 1.2 Import into Vercel: https://makeweight-six.vercel.app (auto-deploys from `main`)
- [x] 2. Rules engine part 1: `classifyCut`, `safeBudget`, `assessGoal` with green/yellow/red verdicts
  - Tests: boundaries 7/8 and 35/36, 106-lb/3-day max start, 215+/12 weeks, 113 → 106/10 days, >3%/week red, >5% water red, invalid inputs
- [x] 3. Rules engine part 2: `generatePlan` (Mifflin-St Jeor, ISSN macro floors, water loading / taper / light finish), Plan screen
  - Tests: sums to goal, monotonic, 5% cap, macro floors, water loading only with 4+ days, warning flag
- [x] 4. Data layer: localStorage, manual log, WHOOP-format demo athlete, backup export/import, SVG weight chart
- [x] 5. Alerts engine and Today dashboard (wearable red flags, rate of loss, water cap, pace, short window), plan easing
- [x] 6. Weigh-in recovery planner (under 1 h, 1 to 6 h, 12+ h, between matches) with food examples
- [x] 7. Safety tab: not-recommended cards, water loading warning, stop-and-get-help, disclaimer, "my story" placeholder; sources verified (NFHS, CDC 1998, NATA 2017, MedlinePlus)
- [x] 8. AI coach backend `api/coach.js` (Gemini Interactions API, validation, rate limit, safety prompt)
- [ ] 8.1 Add GEMINI_API_KEY (local `.env` and Vercel) and run one real request
- [x] 9. Coach UI: privacy opt-in, cached briefing, chat, rules-based fallback
- [x] 10. PWA: manifest, icons, service worker, phone-first dark theme, accessibility labels
- [ ] 10.1 Install on a real phone and check offline
- [ ] 11. (Stretch, only if 1 to 10 are done by 4 PM) Firebase Google sign-in + Firestore sync with per-user security rules
- [ ] 12. Submission: README + "How Kiro was used", final deploy, demo video script (3 min or less), fill in "My story"
