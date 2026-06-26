# Greenhouse — web

The web frontend for **Greenhouse**: a single-screen seed-review surface where you
swipe through AI-discovered app ideas, inspect the open-web evidence behind each one,
and approve the good ones into a build queue.

Built with **Next.js 16**, **React 19**, **Tailwind CSS v4**, **Geist**, `motion`, and `lucide-react`.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
```

## Highlights

- **Build queue** (left) — seeds currently Building (with a live step checklist) and Built.
- **Seed detail** (center) — the idea as clean markdown, with an Ask AI composer.
- **Evidence** (right) — source signals with real favicons pulled from each domain.
- **Approve / Deny** — buttons or keyboard (`A` / `→`, `D` / `←`); approving swipes the
  card away and moves the seed into the Building queue.

## Build

```bash
npm run build
npm run start
```
