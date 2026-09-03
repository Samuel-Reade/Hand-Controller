# REFERENCE.md

`figma-make-build/src/App.tsx` is ground truth for every constant and rendering
recipe in the neural port. `FIGMA_MAKE_HANDOFF.md` is a map of it, written by the
prototype about itself. Where they disagree, the code wins. Step-zero verification
of every `/docs/ORB_NEURAL_PORT_SPEC.md` §5 constant against App.tsx is recorded
in `/docs/PORT_LOG.md`. Images: `make-screenshot-1.png` (wide field view)
and `make-screenshot-2.png` (center/brain view) are the running Make build;
`original-ref-1.png` / `original-ref-2.png` are the two original neuron reference
images. Do not port from the scaffold files (package.json, vite.config.ts,
tsconfig.json, index.html, AGENTS.md) — they are provenance only.
