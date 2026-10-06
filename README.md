# Today

A calm, local-first task app. Next.js + TypeScript + Tailwind. No backend, no accounts; all data is in `localStorage`.

```bash
npm install
npm run dev        # http://localhost:3000 (service worker is disabled in dev)
npm run build && npm start   # production, with offline support
```

Deploy: push to GitHub and import into Vercel (free tier, zero config).

## Capture syntax

`Call mum Sunday !`, `Report by end of this week #work ~1h30m`, `Plan Lisbon /trip next Friday`

- dates via chrono-node, plus "end of this week/month" (week ends Sunday)
- `!` important, `#tag`, `~30m` / `~1h30m` estimate, `/project /trip /job /admin /event` template
- no date → Later

## Where things live

- `lib/store.ts`: the single data store; swap `StorageAdapter` for Supabase sync later
- `lib/parse.ts`, `lib/rescue.ts`, `lib/checkin.ts`, `lib/estimate.ts`: pure logic
- `lib/events/`: placeholder for the London "Don't miss this" section
- `lib/backup.ts`: export/import + validation + 2-week reminder rule
- `scripts/generate-icons.mjs`: regenerates the PWA icons in `public/`
