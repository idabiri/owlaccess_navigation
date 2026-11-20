
## 2026-11-19 · Brand restyle "campus field map" (studio feedback: "more human, less AI, super cool")
- New `app/src/brand.css` (loaded last), `app/src/pages/HeroSketch.tsx` (hand-drawn hero sketch + line pictograms), landing page uses them; `main.tsx` imports bundled fonts.
- Fonts: Fraunces (headlines) and Atkinson Hyperlegible (text), installed as npm packages and bundled, so no font service is contacted.
- Paper/ink palette, print-style shadows, route-drawing hero animation (off with prefers-reduced-motion). design.json values unchanged.
- Contrast: text on orange switched from white (2.9:1) to ink (about 6:1).
- Backup: Hacakthon_backups/Hacakthon_backup_2026-11-19_before-brand-restyle.zip
