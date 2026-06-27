# NO-SHITCODE-SKILL

Purpose: stop the single most damaging habit — **layering new code on top of existing
code instead of finding, reusing, or restoring what already works.** I do this a lot.
It turns a small problem into a tangled mess, breaks working features, and wastes hours.
This file is the rule set to prevent it.

---

## The core rule

**Do not write new code over code that already works.**
If something already does the job, use it, extend it in place, or restore the last
version that worked. Adding a new layer "around" or "on top of" existing behavior is
banned unless explicitly asked for.

When code is broken, the fix is almost always **removal or reversion**, not addition.

---

## What "shitcode layering" looks like (do NOT do these)

- Wrapping a working function in a new function/handler/adapter that "improves" it.
- Injecting a new transform/preamble/context step into a path that already worked.
- Adding a second source of truth (e.g. two things both writing the same state).
- Adding a "compatibility" or "fallback" layer instead of fixing the one real cause.
- Editing vendored / black-box code to make my integration work.
- "Fixing" a regression by adding more code on top of the regression.

If I'm about to add code to make existing behavior work again, **stop** — the answer is
to find what changed and undo it.

---

## When something is broken — the only allowed workflow

1. **Find the last commit where it worked.** `git log`, identify the known-good commit.
2. **Diff against it.** `git diff <good> HEAD -- <files>` — the regression is in there.
3. **Remove/revert the change that broke it**, file by file, to the known-good version.
   Do not add anything new to compensate.
4. **Verify** in the real running app (see Proof).
5. Only after it works, layer the *intended* new feature — in small, committed steps.

Never skip step 1–3 and jump straight to writing a fix.

---

## Hard don'ts (these caused real damage)

- **Don't `git checkout`, `git reset`, or revert to HEAD without explicit permission.**
  It silently destroys uncommitted work that git cannot recover.
- **Don't delete files that the build still references as roots** without checking the
  build first — it takes the whole build down (TS6053).
- **Don't kill/restart a running process whose original launch env you don't know.**
  You can't recreate it. Find how it was started first.
- **Don't edit the vendored repo** (`localcoder/`, etc.). It is a black box. If my code
  needs it changed, my code is wrong.
- **Don't send test input into the user's real chat/data** unless told to.
- **Don't claim "fixed" / "working" without proof.**

---

## Proof standard (what counts, what doesn't)

A change is **not** done until it is proven in the **real running app**:

- ✅ Real runtime behavior: the feature actually does the thing, observed.
- ✅ The build the dev server actually uses (e.g. `tsc --noUnusedLocals` for a watch
  build that uses it) — a weaker `tsc --noEmit` is NOT the same check.
- ❌ NOT proof: a route returning 200, types compiling, "it should work", a screenshot
  of unrelated UI, or my own confidence.

If I can't verify it, I say "unverified" — I do not say "fixed".

---

## Safety habits

- **Commit checkpoints often.** Before touching working code, and after each working
  step. This makes reverts surgical instead of catastrophic, and means nothing is ever
  "lost days of work" — git is the memory.
- **Touch the smallest surface.** One file, one hunk, the exact cause — not a sweep.
- **Preserve unrelated work.** Never wholesale-revert a file that also holds work the
  user wants kept (e.g. a page with both chat and graph code) — revert only the relevant
  functions, or ask.
- **Honesty over comfort.** Report what's actually true: if it's broken, say so with the
  evidence; if a step was skipped, say that; if I broke something, own it plainly.

---

## One-line summary

> Find what works and keep it. Remove what broke it. Prove it in the real app.
> Never bury working code under new layers.
