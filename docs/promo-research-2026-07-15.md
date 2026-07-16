# How to promote Loom — recovered research, 2026-07-15

A 152-agent research run on promoting Loom hit the session limit and died before it could
write anything. The research survived in the workflow journal; this document is the report
it never produced. Recovered and written 2026-07-16.

**Everything below is dated.** The research fetched its sources on **2026-07-15**. Community
rules and numbers are stated *as of that date*. Repo facts marked "today" were re-checked on
**2026-07-16** against the working tree and the live GitHub API.

---

## 0. Read this first: how much of this is actually verified

The run had three phases. The third one only half-happened, and that changes how you must
read every page below.

| Phase | Planned | Returned |
| --- | --- | --- |
| 1 — Repo audits (legal, contributor, tester) | 3 | **3** |
| 2 — Scout research (13 angles) | 13 | **13** |
| 3 — Adversarial verification | 130 (10 per angle) | **49** |
| 4 — Gap fill, Plan, Drafts, Synthesize | ~6+ | **0** |

**Verification reached only 5 of the 13 angles.** These five were fully checked:
`assets-demo`, `contributor-mechanics`, `positioning`, `reddit-music`, `spanish-communities`.

These eight were **never verified at all** — not one claim among them was fact-checked:
`hacker-news`, `reddit-dev`, `case-web-music`, `case-oss-daw`, `non-reddit-communities`,
`license-strategy`, `ai-disclosure`, `anti-patterns`.

That is not a footnote. It means the Show HN material, the anti-pattern material, the case
studies, and the licence-strategy reasoning are **single-source scout claims that no one
challenged** — however confident they sound. Each section below says, inline, which it is.

### The 49 verdicts

| Verdict | Count | What it means |
| --- | --- | --- |
| CONFIRMED | 9 | Claim held as written. |
| PARTIALLY_TRUE | 34 | **Read the correction, not the claim.** Usually: numbers right, conclusion wrong. |
| REFUTED | 4 | False. See §5. |
| UNVERIFIABLE | 2 | Could not be checked — but see the note below. |
| **Total** | **49** | 43 survive in some form. |

PARTIALLY_TRUE is the majority verdict and the most dangerous category. These are claims that
arrive with correct, checkable figures attached to an inference the figures do not support.
Where a correction exists, **the correction is the finding** and the original claim is not.

> **The 2 UNVERIFIABLE verdicts are tooling artifacts, not open questions.** Both concerned
> Reddit rules, and both failed because that agent's `WebFetch`/`curl` got a 403 from Reddit.
> Sibling agents fetched the *same rules* successfully through a logged-in browser and
> rendered CONFIRMED / PARTIALLY_TRUE verdicts on them. Where that happened, this report uses
> the agent that got through. Do not read "UNVERIFIABLE" as "nobody knows".

### What never ran

Gap-fill (5 completeness critics) and the final report writer were all launched with a
939 KB prompt and died immediately — that is what exhausted the session. The **Plan** and
**Drafts** phases never started. **There are no post drafts.** Nothing in this document is a
ready-to-paste Reddit or HN post, and none was ever written.

---

## 1. What to do first

### 1.1 `git push`. The licence is not public. (Minutes — do it before anything else.)

The licence question is closed *on your laptop*. It is not closed anywhere a stranger,
a moderator, or an aggregator can see.

Verified against the live GitHub API on 2026-07-16:

```
GET https://api.github.com/repos/IJOL/Loom
  license:    null
  homepage:   null
  topics:     []
  pushed_at:  2026-07-15T17:20:23Z      ← yesterday
```

Locally there are **15 unpushed commits on `main`**, and the bottom one is
`978b66d chore(license): AGPL-3.0 — the licence Strudel already chose for us`.

So every downstream consequence of "no licence" that the research documented is **still
100% live in public**, unchanged. Until you push:

- **r/opensource** (368,474 subs) requires that a linked repo "MUST have a LICENSE file that
  MUST be an OSI listed Open Source license". Loom is unpostable there. *(⚠️ scout-only —
  `reddit-dev` was never verified.)*
- **Hispasonic** headlines this category with "código abierto". Pitching Loom as open source
  today would be pitching something the repo publicly contradicts. *(✅ verified.)*
- **NLnet** funding mandates an open-source licence. *(⚠️ scout-only.)*
- GitHub's own `license:` search filter cannot find the project. *(⚠️ scout-only, but the
  same scout empirically showed Ardour and Zrythm return **0 hits** on their own `license:`
  filters because their LICENSE files were modified.)*

While you are there, set **`homepage`** and **`topics`**. This is the one positioning change
the evidence directly supports, and it is the rare case where a verifier *strengthened* the
claim rather than weakening it:

> GridSound's repo (1,835★) sets homepage, 9 topics and a licence. Loom sets none of the
> three. `has_pages` is `true` and `homepage` is `null` — **the repo does not link to its own
> live demo**, and it cannot be reached by topic browse.
> *(✅ verified live, agent `adda32585825785ef`.)*

Cost: about three minutes. It is the highest ratio of consequence to effort in this document.

### 1.2 Make ▶ produce sound. (Minutes — and nothing else matters until it does.)

The tester-readiness audit called this its one critical finding, and **it is still true in the
code today** (I re-read `src/core/transport.ts` on 2026-07-16 — lines 35-42 are unchanged):

```ts
playBtn.addEventListener('click', () => {
  void ctx.resume();
  if (seq.isPlaying()) return;
  deps.resetAutomationPosition();
  seq.start();
  setPlaying(playBtn, true);     // ← adds .is-playing (green)
  deps.onStart?.();
}, { signal });
```

The app boots into Session mode. `tickSession` only sounds a lane when `lp.playing` is set,
and that is set *exclusively* by `launchClip` / `launchScene`. Loading a session launches
nothing. So a first-time visitor presses the big obvious ▶ — the button **turns green**, the
transport counter **starts advancing**, and **nothing plays**. Every visual affordance reports
success. The only conclusion available to them is "this is broken."

This is not one reader's opinion of the code. The project's own e2e suite proves it: every
Session-mode spec reaches sound via `.session-scene-launch`, and `#play` is only clicked in
*Performance*-view specs. `transport.ts:29` says it outright — "Session owns per-lane
playback."

The fix already exists in the codebase, on the hardware path —
`src/control/loom-facade.ts:235-236` does `if (!anyPlaying()) sessionHost.launchSceneAt(...)`.
Lift it into the ▶ handler.

A post that lands 5,000 clicks converts approximately zero testers while this stands.

### 1.3 Make the AGPL grant true before anyone can fork it

Pushing the LICENSE is what makes this urgent rather than merely untidy. Copyleft is a
promise to strangers that they may fork and redistribute — and for ~34 MB of the repo you do
not hold the rights to make that promise. *(✅ the licence chain is verified; the asset
findings are from the legal audit and re-confirmed in the tree today.)*

Still true on 2026-07-16, all re-checked:

| Problem | Status today |
| --- | --- |
| README "Credits — sample sources" says **"The three *sample* kits bundled under `public/drumkits/`"** | `public/drumkits/index.json` lists **68 kits**. Still says three. |
| `public/instruments/amen-175/loop.wav` — the Amen Break — ships in the bundle | Still present. |
| `public/instruments/SOURCES.md` asserts the bundled instruments are **"redistribuibles sin atribución"**, listing the Amen Break among them | Still present, still says it. |
| `tests/fixtures/midi/` holds `mgmt-kids.mid`, `sweet-dreams.mid`, `solid-sessions-janeiro.mid` | Still present (test-only; not shipped). |

The new README **License** section makes this sharper, not softer. It now says *"Bundled audio
samples are **not** covered by the AGPL — they keep the terms of their own sources; see
Credits"* — and then Credits describes 3 of 68 kits. The carve-out points at an inventory that
is 65 kits short.

64 of the 68 kits derive from `ritchse`/`geikha`/`tidal-drum-machines`, which the audit
confirmed has **no LICENSE and no licensing language** — as does `tidalcycles/Dirt-Samples`.
Loom's own generator admits it (`tools/build-drumkits-from-tidal.mjs:15`). No licence means
all rights reserved by default.

**The ordering constraint is the whole point.** Git history is permanent. Today the repo has
**0 forks** (verified via the API), so a `git-filter-repo` pass is still feasible. After a
front-page post there could be hundreds of forks, and GitHub's fork network retains
unreachable objects forever. "We'll clean it up if it gets popular" is exactly backwards.

Decide **before** you push and promote: remove the kits and keep the generator as an opt-in
local script (the pattern `tools/stem-service` already uses successfully), or accept the
exposure knowingly. Both are legitimate. Discovering it afterwards is not.

> One genuine bright spot, verified rather than assumed: the `.gitignore` discipline held.
> `music/` (251 MB), `loops/` (75 MB), `drum-samples/`, `midi-library/` were **never
> committed** — confirmed via `git rev-list --objects --all`, not just by reading the ignore
> file. Had those leaked, the audit's recommendation would have been to abandon the repo.

### 1.4 Then, and only then, pick a channel

Nothing in §3 is worth doing before §1.1 and §1.2 are done.

---

## 2. Readiness

### Fixed today (2026-07-16) — do not act on the audit's version of these

The research ran against a repo with no licence at all. That is now historical. **Locally**:

| Was | Now |
| --- | --- |
| No LICENSE / COPYING / NOTICE anywhere; `git ls-files` matched zero | `LICENSE` = full GNU AGPL v3 text (`978b66d`) |
| `package.json` had no `license` field | `"license": "AGPL-3.0-or-later"` |
| "GPL-3.0 vs AGPL-3.0" treated as an open decision | Closed — AGPL-3.0-or-later |
| Derived DSP files carried no attribution | `src/audio-dsp/filter.ts` and `osc.ts` carry `SPDX-License-Identifier: AGPL-3.0-or-later` + "Adapted from Strudel's dough.mjs" + the Codeberg link |
| README had no License section | README §License: AGPL, the §13 explanation, the Strudel lineage, and an explicit samples carve-out |

**The licence was never a choice.** The audit found Loom's AudioWorklet DSP derives from
Strudel's `supradough` (AGPL-3.0-or-later): `Svf.update()` in `filter.ts` is dough's
`TwoPoleFilter.update()` line-for-line with renamed variables — same magic constants (`1.14`,
`0.125`), same state recurrence — and `polyBlep` in `osc.ts` is verbatim. The project's own
design docs are the written evidence trail ("polyBlep saw/square **lifted from** dough.mjs").
GPL-3.0 would have been an infringement of Strudel. The repo has now landed exactly what the
audit prescribed.

Note also, in case it worries anyone: `"private": true` is **not** a legal statement. It is an
npm-publish guard with no bearing on copyright. Keep it.

### Still open — verified against the tree today

| Gap | Evidence | Effort |
| --- | --- | --- |
| **15 commits unpushed; GitHub shows `license: null`** | live API | minutes |
| **▶ silent in Session mode** | `src/core/transport.ts:35-42` | minutes |
| **The shipped app carries no licence notice at all** | `index.html` grep for `licen[cs]e\|AGPL\|Strudel` → **0 hits**. The About dialog still has no licence line, no source link, no Strudel credit. The repo now complies; the artifact every visitor downloads does not. | minutes |
| README credits: 3 kits vs 68 | `public/drumkits/index.json` | minutes |
| Amen break ships; `SOURCES.md` misstates its licence | `public/instruments/` | hours |
| No `CONTRIBUTING.md` | `git ls-files` → absent | hours |
| No CODE_OF_CONDUCT, SECURITY, issue or PR templates — `.github/` holds **only** `workflows/deploy-pages.yml` | `git ls-files .github` | hours |
| **Zero issues, ever** — `gh issue list --state all` returns empty | live | hours |
| No test CI; the only workflow deploys Pages | `.github/workflows/deploy-pages.yml` | hours |
| CI pins **node 20**; `node-web-audio-api` requires **>= 22**; no `engines` field, no `.nvmrc` | `deploy-pages.yml:33` | minutes |
| `npm test` fails on a fresh clone — it is `test:unit && test:e2e`, and `test:e2e` boots `vite preview` against a gitignored `dist/` with no build step. `npx playwright install` is documented nowhere. | `package.json:16` | minutes |
| 6 preexisting e2e failures (preset dropdowns empty at boot) | known | hours |
| `docs/plugin-development.md` still opens "# Cómo crear plugins" — Spanish, and describes the **deleted** pre-worklet architecture | tracked | hours |
| `TODO.md` (from the initial commit, lists shipped features as pending) and `AGENTS.md` (100% GitNexus mandates, says nothing about Loom) both still tracked | tracked | minutes |
| No share-URL of any kind | ✅ **CONFIRMED**: zero `location.hash` / `URLSearchParams` / `pushState` in all of `src/` | days |

Two claims worth keeping because they are good news, both verified by measurement rather than
assumption:

- **First load is 211 KB gzipped**, not 41 MB. The 41 MB `dist/` is 34 MB of lazy drumkits and
  4.4 MB of manual that a first visit never touches. Weight is a non-issue; spend no time on it.
- **`npm run test:fast` is green**: 277 files, 1,746 tests, exit 0, 88 s, no browser needed.
  The contributor audit ran it. This is the project's most under-advertised asset and should be
  the headline command in a CONTRIBUTING.md — not `npm test`, which is broken.

### The engine hook is booby-trapped

The README's best contributor line — "adding one is dropping a file, not editing the core" —
is **false for synth engines** and true for FX/modulators. After the worklet cutover, adding a
melodic engine needs edits to three core files (`loom-processor.ts`'s hardcoded import list,
the same list duplicated in `kernel-lane-render.ts`, and `lane-allocator.ts`'s
`WORKLET_ENGINE_IDS` set). The failure is cruel: the engine selector is dynamic, so a new
engine **appears in the dropdown** from its descriptor alone — then throws at note time or
never allocates. Either make it true or make the docs true; do not leave the README claiming
the first while the code does the second.

---

## 3. Channel by channel

Each heading states its verification status. Read that first.

### 3.1 r/synthesizers — 472,301 subs — ✅ verified

The picture is more interesting than "restricted", and the two agents who got through Reddit's
block settled it.

**The main feed is closed.** Rule 12, created 2026-07-08: *"Software promotion, free or paid,
cannot be posted in our forum outside the Megathread."* The mod announcement of 2026-05-21
(375 upvotes) is explicit: *"All software announcements (paid or free, AI or not) will no
longer be allowed as standalone posts."* There is **no free/open-source exception**.

**The megathread is open, and unusually friendly.** ✅ **CONFIRMED** (agent
`aac09238d4869500d`, fetched the raw megathread JSON through an authenticated browser): the
megathread explicitly permits **freely-available vibe-coded software** and says open-source /
GitHub software is appreciated. Only **paid** AI-built software is discouraged — Rule "No Sales
Posts": *"Paid software developed primarily using AI will be removed."*

The catch: the megathread itself has **55 upvotes and 68 comments**. That is near-zero reach.

Other verified gates:
- **Rule 11, "Minimum 50 Karma Required"** — the rule's actual text is softer than its title:
  *"Most posts from users below 50 karma are flagged and removed automatically."* An automated
  filter with mod discretion, not a hard block. (PARTIALLY_TRUE; correction applied.)
- **Rule 5** auto-removes any link/photo/video post whose OP hasn't left a meaningful comment
  within 1 hour.

Historical appetite here is real — free browser-synth launches scored 33–408 (median ~50), and
a free JP-8000 emulator hit 2,606 upvotes. But that emulator was posted 2025-12-28, **five
months before the megathread existed**. It is grandfathered, not permitted.

> **The honest summary, in the verifier's own words:** "r/synthesizers has the appetite but has
> just closed the door; r/edmproduction has the permission but little demonstrated appetite."

### 3.2 r/edmproduction — 809,415 subs — ✅ verified

**The carve-out is real** and quoted verbatim from `about/rules.json` by three separate agents
who fetched it through a browser. Rule 6, "Promoting Software You've Made":

> *"Plugins, software, or platforms you've made go in the Marketplace Thread, with one
> exception: genuinely free and open source projects (e.g. hosted on GitHub, no paid tier, no
> sign-up wall, no data collection)."*

Loom qualifies for that exception — **once the LICENSE is public** (§1.1). This, not an argument
about test coverage, is the load-bearing basis for a standalone post.

**The "No Vibe-Coded Slop" rule** (Rule 8) is the live risk:

> *"Apps, plugins, or services built primarily with AI coding assistants and pushed out without
> meaningful development, testing, or support are not welcome, regardless of price. If your
> project is a real piece of software you stand behind, it goes in the Marketplace Thread."*

Read the correction carefully, because the scout got the interpretation wrong. The rule does
**not** target "untested projects rather than AI assistance itself" — it targets the
**intersection**. AI provenance is the first conjunct and a *necessary trigger*; it is simply
not sufficient alone. And note the second sentence: even a project that clears the bar is routed
by this rule to the Marketplace Thread. Passing the vibe-code test does not itself authorise a
top-level post — Rule 6's FOSS exception does. **Rule 15 makes reposting after a removal a
bannable offence.**

**Appetite here is poor for Loom's category, and this is the finding to internalise:**

| Post | Score |
| --- | --- |
| mpump — browser groovebox, free + open source (2026-04-07) | **2–3** |
| Chromatrack — FOSS HTML step sequencer (2026-03-16) | **0** (ratio 0.4) |
| browser music sketching app (2023) | 11 |
| loopmaster | 12 |
| **local AI stem splitter** (2025-12-01, "Free Resources") | **130** / 37 comments |
| acapella extractor | 75 |
| sample manager | 53 |

The carve-out works — both browser posts ran un-removed. It just delivers nothing, because
**nobody in that sub wants another browser sequencer**. Free utilities that solve one concrete
pain point clear 100; grooveboxes flop.

> **On the stem-splitter lead.** The 130-upvote datapoint is ✅ verified. But it is not the
> opening it looks like, for three reasons. (a) It appears in the research only as a
> *counterexample* inside a correction — no agent ever proposed it as positioning, and the
> `case-*` angles that might have tested it were never verified. (b) **Loom is not a stem
> splitter.** Its Demucs separation is not in the browser: `src/stems/stem-config.ts` points at
> `http://localhost:8765`, and `stem-dialog.ts:70` shows visitors *"Can't find the stems service
> at localhost:8765. Is it running?"*. Every visitor to the live demo who clicks Stems gets an
> error. (c) Pitching a browser groovebox as a stem splitter, in the one sub with a rule about
> software "pushed out without meaningful development, testing, or support", is the exact shape
> of post that rule exists to remove. The datapoint is real; the lead is not.

### 3.3 r/WeAreTheMusicMakers — 3,835,357 subs — ✅ CONFIRMED — do not post

The single cleanest "no" in the research. Fetched live:

- Rule 1: **`NO POSTING MUSIC - NO PROMOTION OR FEEDBACK - NO "I BUILT A TOOL..."`**
- Rule 12: **`NO AI`**
- Rule 11: No reposting after removal for violating sub rules.

The rule text literally names the post you would want to make. Both of its rules independently
remove it.

### 3.4 Other music subs — ✅ verified

| Sub | Subs | Verdict |
| --- | --- | --- |
| **r/musicproduction** | 599,930 | **Conditional ALLOW.** Its "Marketing" rule expressly permits sharing self-made free things "without profiting yourself" — no charge, no newsletter/signup wall, hosted directly. Loom satisfies all. No giveaway/contest framing (prohibited); no track posts (Rule 3); **no feedback requests** (Rule 10 — "strictly prohibited"). |
| r/audioengineering | 647,230 | **Removal.** Bans "promoting" outright at `kind=all`, no non-commercial exception. |
| r/ableton | 497,703 | **Removal** — blatant self-promotion (Rule 4) + off-topic (Rule 1). Note the *"No selling"* and *"No AI"* rules are **not** what bite; self-promo and off-topic are. |
| r/TechnoProduction | 105,696 | **Removal.** Flat "No self-promotion". |

The scout's sub list was also partly fantasy, and the verifier caught it: **r/DAW has 7
subscribers** and is restricted; **r/musicsoftware** has 350; **r/TB303** has **1**;
**r/plugins** (1,395) and **r/VintageSynths** (897) are restricted; **r/Bass** (359k) is bass
*guitarists*.

r/musicproduction is the best-permissioned music sub for Loom. Nobody measured its appetite.

⚠️ One caveat the verifier attached to all of the above: `rules.json` states **written policy**,
not AutoModerator behaviour. Enforcement can remove more than the text covers.

### 3.5 Hacker News — ⚠️ **UNVERIFIED** (angle never reached the verify phase)

Everything in this section is a single scout's work that no fact-checker ever challenged.
Weigh it accordingly. That said, this scout quoted primary sources it says it fetched
directly — which is a materially lower risk class than an unverified *inference*.

**Show HN was restricted as of 2026-07-15.** The scout reports fetching
`https://news.ycombinator.com/showlim` (HTTP 200) and quotes it:

> *"We're temporarily restricting Show HNs because of a massive influx, mostly by users who
> aren't yet familiar with the site or its culture. You're welcome on HN! Take some time to get
> to know the community, become a good contributor, and then it will be fine to post an
> occasional Show HN."*

with dang, 2026-04-22: *"this is what many accounts without much HN history now see"*.

**Account age does not lift it.** A user reported a dormant 2021 account still getting *"Sorry,
your account isn't able to submit this site"*. dang refuses to publish the threshold, on
purpose: *"we want people to be genuine community members, which is not a checklist process."*

⚠️ **Verify this yourself before planning anything around HN** — it is a temporary measure by
its own wording, it is now a day stale, and no second agent ever confirmed it. It is also
trivially checkable: log in and try.

**The trap that matters most for you, if you ever do post.** dang's official Show HN tips doc
(edited 2026-03-28):

> *"Write your text by hand. Don't use an LLM to generate any of it (not even a tiny bit,
> including to edit or spruce it up). Reason: the community is super fussy about this right now,
> and LLM language leaves imprints on your text which are generating quite some backlash when it
> appears on HN itself. **This is a big dividing line at present!**"*

And dang, on exactly this case:

> *"we included it to protect users who don't realize how much damage they're doing to their
> reception here when they think 'I'll just run this through ChatGPT to fix my grammar and
> spelling'... We'd rather hear you in your own voice, even at a cost of misunderstanding your
> intent sometimes."*

A Spanish native shipping an English project has precisely one safe move: write the post and
every reply in your own English, imperfections included. Polished LLM prose is *more* dangerous
than imperfect English. The temptation is highest in live thread replies under time pressure.

**There is no AI-disclosure rule for projects**, and dang deliberately declined to make one:
*"What I deliberately left out was anything about the articles and projects that get submitted
here."* And: *"We aren't asking people to not use AI. (We use it ourselves.)"* The formal
"don't post generated text" guideline sits in the **In Comments** section, not In Submissions.
So: do not open with a vibe-coding confession; answer honestly and specifically if asked.

**What HN actually punishes is shallowness.** The most-replied comment in "Is Show HN dead?"
(522 pts):

> *"I don't actually mind AI-aided development... but I think the vibe coded show HN projects are
> overall pretty boring. They generally don't have a lot of work put into them, and as a result,
> the author (pilot?) hasn't generally thought too much about the problem space, and so there
> isn't really much of a discussion to be had. The cool part about pre-AI show HN is you got to
> talk to someone who had thought about a problem for way longer than you had."*

This is a bar Loom clears unusually well, and the credibility payload is the hard-won
specifics: the dense-MIDI dropout diagnosis down to per-note node churn starving the scheduler
via GC, the AudioWorklet rewrite that fixed it, the voice cap that was *removed* because it
evicted still-sounding voices and clicked, the four-layer test strategy with relative-only
assertions.

### 3.6 Dev subs and the traffic sub — ⚠️ **UNVERIFIED** (`reddit-dev` never verified)

The scout's finding, unchallenged: the big dev subs ban exactly the post you want to make.
r/programming (6.9M) bans "'I Made This' Project Demo Posts" — *"We don't care what you built,
we care how you build it"*. r/webdev (3.28M) confines project sharing to Showoff Saturday.
r/gamedev bans showcasing. So the dev subs are a **contributor** channel reachable only via a
technical write-up, not a traffic channel.

Traffic, per the same unverified scout, lives in **r/InternetIsBeautiful (16.6M)**, where
browser music tools demonstrably win: drawbeats.com **2,948** upvotes; drumha.us 292; an 808
drum machine **299**. Loom's zero-signup/zero-install nature uniquely clears its "no personal
information" and "no demos" rules; the "Not Unique" rule is the live risk.

The scout's sharpest datapoint — and remember nobody checked it — is a natural experiment: the
same 808 drum machine, posted the same day (2026-07-07) to r/InternetIsBeautiful and r/webaudio,
scored **299 vs 1**.

If any of §3 deserves the verification that never happened, it is this. It is the only channel
in the research with both mass traffic and a plausible rules fit, and its entire evidence base
is one unchallenged agent.

### 3.7 Everything that is not Reddit or HN — ⚠️ **UNVERIFIED**

- **CDM (cdm.link)** — the one tier-1 press target. It ran a free browser HTML audio editor as
  a story on 2026-01-18 and a "free browser groovebox" before that. Its beat *is* Loom's shape.
- **KVR product database** — browser-only free tools are listable as "Stand-Alone Utility /
  Application" or "Service"; a dev account is free for a "one-man-band". A structural discovery
  play rather than a launch.
- **Dead ends, per the scout:** the Web Audio Slack signup returns HTTP 503; the KVR Developer
  Challenge (the single best-fitting event) closed entries 2026-07-06 and runs only every 2–3
  years; `#WebAudio` on the fediverse is effectively dead (40 posts / 184 days); the two best
  music instances (sonomu.club, post.lurk.org) have registrations **closed**.
- **Honest mismatches:** TOPLAP/algorave's manifesto demands *"Show us your screens... Code
  should be seen as well as heard"* — Loom is a GUI and does not fit. VCV is Rack-only by rule.
  Elektronauts' love for free web apps came from tools *serving Elektron hardware*.
- Gearspace and MOD Wiggler both adopted explicit AI-content rules between 2023 and 2026.

Separately, ✅ **CONFIRMED**: the official Web Audio discovery surface is dead. `WebAudio/demo-list`
was archived 2026-05-19 (*"We are no longer accepting new contributions now"*) and redirects to
Web Audio Weekly, which has published nothing since issue #136, **2023-06-22**.

### 3.8 Awesome-lists and aggregators — ✅ verified

Mostly bad news, and worth knowing before spending an evening:

| Target | Verdict |
| --- | --- |
| `notthetup/awesome-webaudio` (1,383★) | Accepts *submissions*, not *entries*. Of the 6 most recent closed PRs, **1 merged, 4 rejected** with "Sorry, I don't think it's awesome." Every app PR since the last commit was rejected. File it — it's cheap — but expect rejection on taste. Not a distribution channel. |
| `olilarkin/awesome-musicdsp` (2,965★) | **Do not submit.** Its CONTRIBUTING.md: *"This is a personal curated awesome list... I am not looking for collaborators."* Last merged PR: 2021. Six open PRs sit ignored. |
| `noteflakes/awesome-music` (2,442★) | Takes PRs, rejects most (5 of 7 recent closed unmerged) — but real OSS tools do get merged. |
| `ad-si/awesome-music-production` (1,447★) | **Best fit.** Merged 4 of 7 recent PRs; has both "Audio Workstations" **and** "Webapps" categories. |
| `up-for-grabs.net` | No star or contributor minimum — criteria are about *maintainer willingness*. Eligible today. |
| CodeTriage | Only requires being logged in. Eligible. |
| **goodfirstissue.dev** | **Rejected on ≥4 grounds**, not two: no licence, 1 contributor (needs 10), no CONTRIBUTING.md, 0 issues (needs 3 beginner-labelled). And its backing repo hasn't had a master commit since **2026-03-02** — submissions may sit unprocessed. Not viable; stop considering it. |

On the `good first issue` label itself: GitHub *does* run an algorithm that surfaces labelled
issues site-wide. But the claim that the label must be *exactly* `good first issue` is **wrong**
— GitHub's engineering blog documents ~300 synonym labels plus an ML detector that surfaces
issues with no qualifying label at all. The canonical string is the highest-confidence choice
and what the docs recommend; it is not a hard requirement. (Label *search* is exact-match; the
surfacing algorithm is not.)

---

## 4. What the case studies actually show

⚠️ **Both case-study angles (`case-web-music`, `case-oss-daw`) were never verified** — 0 of 20
fact-checkers returned. The figures below are single-source. Several *were* independently
confirmed by verifiers working other angles; those are marked ✅.

### The distribution finding: your repo is not the link

The hardest-replicated pattern across four projects — HN submissions pointing at a **curated
entry point** beat the same project's GitHub repo by **10–22x**:

| Project | Curated entry point | Bare repo |
| --- | --- | --- |
| Bespoke Synth | **745 pts** (bespokesynth.com) | 33 |
| openDAW | **209 pts** (the app site) | 18 |
| Zupiter | **147 pts** (the author's blog post) | 4 (bare app URL) |

**And every one of those hits was submitted by someone else, not the author.**

### openDAW — the closest analogue, and it owns the wedge

✅ Verified live: 1,898★, created 2025-02-18, pushed the same day the research ran, AGPL v3
(+ commercial dual-license), 1.0 targeted **Q3 2026**, public launch **September 2026**, Cologne
release event **October 3**. Its growth path is documented: a third party posted the app site to
HN → 209 pts/131 comments → **MusicRadar covered it the next day** → a producer YouTuber's video
became "probably my most viewed video on this channel."

Three corrections the verifier applied, worth carrying:
- openDAW is **not unlicensed** — the README declares AGPL v3; the API's `license: null` merely
  reflects a missing root LICENSE file. (A cautionary tale for Loom: GitHub needs a *detectable*
  LICENSE file at root.)
- André Michelle is Audiotool's **creator and 16-year technical lead**, not its founder.
  MusicRadar calls him "the brains behind Audiotool".
- The "eight radical principles / While competitors harvest user data..." quote is a **third-party
  SEO blog's wording**, not openDAW's. And openDAW is "serverless by default with **opt-in
  cloud**", not a pure no-backend product.

**The consequence for positioning:** the privacy/no-backend wedge is claimed, harder, by a more
credible owner, in the exact window Loom would launch in. Leading on privacy in September 2026
reads as a nobody's openDAW clone.

### Surge vs Vital — the decisive contributor experiment

Two GPL-3.0 synths, comparable stars:

| | Surge XT | Vital |
| --- | --- | --- |
| Contributors | **90** | **1** |
| Commits | 5,487 | — |
| PRs ever | many | **zero** — *"I will not take any pull requests"* (its README) |

**License is not the variable. The maintainer's response to the first PR is.** Surge's lead
maintainer (baconpaul, now 3,205 commits) arrived as a stranger fixing a macOS include path —
Claes Johanson merged it and made him an **admin the same day**. Surge got its first 5 outside
contributors in **12 days**, via 2 typo fixes and 3 build fixes, seeded by the author filing his
own known bugs as issues on day one.

Notably, Surge has **no CONTRIBUTING.md, no CLA, and zero "good first issue" labels**. Its README
*is* the developer doc, and `doc/` holds task-shaped recipes — "Adding an FX.md", "How to Git.md"
(which starts at "Register a new GitHub account").

### GridSound, Signal, NoiseCraft, Strudel — licence doesn't buy a scene

| Project | Licence | Stars | Contributors |
| --- | --- | --- | --- |
| GridSound | AGPL-3.0 | 1,835 (10 years) | 5, of whom 2 are founders |
| Signal | MIT | 2,339 | ~2 real |
| NoiseCraft | GPL-2 | 1,211 | 1 — died 2023 |
| Strudel | AGPL-3.0 | 3,026 | **54** |

Strudel's long tail exists because it was co-founded by TidalCycles' creator and inherited the
algorave scene. Loom cannot copy that origin. What it *can* copy: the historical #1 on-ramp for
audio OSS ("it doesn't compile on my machine") doesn't exist for a browser app — but Strudel
proves the substitute is **browser-engine compatibility** (a real merged PR: "handle WebKitGTK
maxChannelCount").

The realistic base rate, per the ✅ verified correction: **dozens-to-hundreds of stars**, not
2,000. The "~2,000 stars over a decade ceiling" framing is wrong in both directions — signal is
already at 2,339, and openDAW hit 1,898 in **17 months**. There is no structural cap on browser
DAWs; the constraint is distribution and reputation. The long tail is brutal: after GridSound
(1,835) it cliffs to Ameobea/web-synth (563) and then to 22–55 stars.

### Acid Machine — your direct ancestor, and your benchmark

✅ Verified: `errozero` submitted his browser TB-303 to HN four times in 2015-16, scoring
**1, 2, 161 and 238**. The 238-point run ("Show HN: TB-303 Synth, Drum Machine and Sequencer in
Web Audio", 2016-11-21) came **four days after** a 1-point run of the same product.

**Do not read this as "the title caused a 200x swing"** — the verifier dismantled that, and this
is the single most seductive wrong conclusion in the whole run:

- The **161-point** post was titled "Show HN: JavaScript Acid Techno Machine" — platform-first,
  vague category, **no "TB-303"**. It breaks the very rule the theory proposes, and it succeeded.
- "1 point" is the submitter's own automatic upvote — i.e. **zero external votes**. 238/1 measures
  "unseen vs front page", not a 238x multiplier.
- dang: *"/newest is a bit of a lottery"*. HN's second-chance pool exists precisely because
  unchanged links score 0 or front-page on timing alone.

Honest version: suggestive, consistent with the general advice to lead with a recognisable noun,
but n=4 and uncontrolled. **Act on it because the downside is zero, not because it is measured.**

That thread also *is* Loom's realistic ceiling-and-floor: ~240 points, ~90 comments is what this
exact idea earns with a good post. Its themes are your guaranteed inbound: 303 nerds nitpicking
filter authenticity; **knob ballistics** ("I don't think the ballistics of the rotary controls is
right... Would it be possible to add the Cubase-style shift-reduces-sensitivity"); and
**onboarding failure** — one user wrote instructions for others, another said "I have no idea what
is going on... couldn't figure out how to get things to play", and the author conceded "I really
need to write a little getting started guide."

The scout concluded "Loom already has the things that thread asked for (swing — it's literally the
v0.8 codename; master compressor; WAV export; a full manual)". **Three of those four are true.**
The audit caught the fourth: the **Swing slider does nothing** — `Sequencer.swing`
(`core/sequencer.ts:38`) is assigned by `main.ts:355` and read by **no scheduler at all**.
`REMAINING-WORK.md` has listed it as known for weeks. It sits in the top transport row beside BPM
and Volume, so it is among the first things a curious tester drags, and it silently no-ops — which
reads as "the audio engine is broken", not "this control is unfinished". Compounding it: v0.8's
codename *is* "Swing", so a tester who reads the version label and then drags the dead slider draws
the worst available inference about the project's honesty. Either wire it or disable it with
`title="Swing — not implemented yet"` before anyone arrives. *(In-progress: this worktree has an
uncommitted `src/core/swing.ts` + `swing.test.ts` as of 2026-07-16 — verify before acting.)*

Loom also still has that thread's onboarding failure, and worse — see §1.2.

### Beats / lasagna.pizza — what share-links actually do

"Show HN: Beats, a web-based drum machine" (2026-01-18, **160 pts**, 48 comments). A commenter
posted `https://beats.lasagna.pizza/?name=lo-fi+dust&bpm=95&i0=K0100...` — "Fun!" — and a third
party replied **to the beat**: "Well done. It reminded me of Tricky :)". The whole pattern encodes
in the querystring, so **the thread became a jam**. Same dynamic in the Strudel REPL thread
(244 pts): one commenter pasted a 12-line composition, another pasted his encoding of "City of
Stars".

**The negative control is the important half.** Zupiter (147 pts, 2019) had sharing, and its
author called it the differentiator — then reported it failed:

> *"despite many people trying it (wordpress shows over 5000 hits), very few people are using the
> share feature to share what they've created. I'll have to investigate what stops people. I'm
> wondering if it's just having to create an account."*

Share links work when they need **no account**. Behind a signup, they don't.

Feasibility for Loom is ✅ measured, and the corrected numbers are the ones to use: the four demo
sessions are pure-synth with no embedded audio, and minified + brotli q11 + base64url they come to
**5,710 / 10,200 / 14,666 / 14,442 chars** — comfortably inside a URL fragment (never sent to the
server, RFC 3986 §3.5; Chrome allows 2 MB). But status is **"the size envelope is measured and
ample"**, *not* "technically proven" — no encode/decode round-trip exists in Loom. And samples in
IndexedDB would not survive a URL, so Sampler/Audio lanes need a separate answer.

---

## 5. Refuted and corrected

### The 4 REFUTED claims

**① "Loom boots to an EMPTY session and hides its four demos inside a toolbar dropdown,
requiring ~4 non-obvious steps before any sound."** — **REFUTED.**

This was the `assets-demo` scout's **headline**, and it is false. `src/main.ts:1155-1164`
auto-loads `public/demos/minimal-techno.json` (4 lanes × 4 clips, 4 scenes, 130 BPM) once presets
and the worklet are ready, and boots directly into Session mode. An empty session is only the
*error fallback*. The path to first sound is **one click on a scene ▶**, and no browser audio app
— Strudel included — can sound without a user gesture.

This matters twice over. The scout built an artifact roadmap on a false premise, and the truth is
*better*: the demo is loaded and ready, and only the ▶ wiring is missing (§1.2). Everything is in
place for a one-click "it makes noise" moment.

**② "Framing a browser music tool as a 'DAW' is near-fatal on HN (1–4 points), while naming an
iconic instrument reliably scores 66–353 — and this still holds in 2026."** — **REFUTED.**

Both halves fail:
- **"DAW" is not near-fatal.** "Show HN: I'm building a browser-based DAW" scored **179 pts /
  123 comments** with no instrument name. Suno Studio (208), Renoise (254), Linux DAW (293),
  SunVox (183), LMN 3 (195), DAWproject (187), Meadowlark (153), and a DAW made in Excel (131)
  all cleared 130.
- **Instrument naming does not "reliably" score 66–353.** That floor is an artifact of the cited
  query's own `points>60` filter. Unfiltered, instrument-named browser drum machines routinely
  score **4–22** — including a literal Roland TR-909 web instrument at **4 points**, and "10,000
  Drum Machines" scoring 4 points on each of four separate submissions.
- **It does not hold in 2026.** Seven instrument-named browser music tools posted in 2026 scored
  160, 22, 19, 14, 4, 2, 2 — **median ~14**, one above 66.

The verifier's instruction is blunt: *"Do not make a naming decision for Loom on the strength of
this analysis."* HN scores for browser music tools are a heavy-tailed lottery; timing, luck, and
whether the thing is instantly playable dominate.

**③ "'Extensible / plugin architecture' is not a click driver."** — **REFUTED.** The cited
"2 hits" was an artifact of a three-word conjunctive Algolia query. Broadened: "extensible"
returns **129** stories above 100 points, "plugin" returns **326**. Figma's "How to build a plugin
system on the web and also sleep well at night" scored **685 pts** and is about nothing but plugin
architecture. Also: "MCP: An (Accidentally) Universal Plugin System" (808), "The Future of Obsidian
Plugins" (452), and — in Loom's own category — "Highly automated digital audio workstation
extensible in Guile" (186). Corrected: extensibility rarely carries an app launch *by itself*, but
it performs well as an **engineering deep-dive into how the plugin system was built**. Loom's
plugin registry is a real asset (verified: FX and modulators genuinely are drop-a-file).

**④ "Hispasonic's rules ban only comments created SOLELY to promote — the wording leaves room for
a substantive post about your own tool."** — **REFUTED.** See §7. The claim cites the wrong
document, and "substance" is not a defence the actual rule provides.

### The corrections that matter most

These are PARTIALLY_TRUE verdicts where the numbers are right and the conclusion is wrong.

| The claim said | The correction says |
| --- | --- |
| "The AudioWorklet/DSP-engineering story is not a hook" | Only half true. **"AudioWorklet" is the dead token** — every AudioWorklet-titled story in ~9 years tops out at **44 pts** (Europa, 2018), and a `points>20` filter returns literally **one** hit. But **DSP-led titles hook regularly**: Web Audio DSP Playground 126, Web DSP audio editor 133, Music DSP resources 211, Faust 150, Pico Audio DSP **329**. Lead with the instrument; the worklet rewrite is the payoff *inside* the post. |
| "Loom's README contains zero images... and the largest README study finds links and images have the strongest association with stars" | The zero-media fact is verified (132 lines, 1,812 words, no matches). But the cited study is **not** the largest — Wang et al. (JSS 2023, 5,000 repos) is 2.5x bigger and peer-reviewed, and it finds **images drop out** once repository confounders are controlled: "the number of lists, links, and the frequency of updates" are what remain significant. |
| "The most successful music/audio projects have drastically SHORTER READMEs than Loom" | **Drop this sentence — the data contradicts its direction.** r = 0.081, rho = 0.000, n=9. Two figures were artifacts: **Ardour's README is 16 words, not 3** (the "3" was the string "404: Not Found" from fetching a file that doesn't exist), and **Strudel's is 248 words, not 18** (the 18-word version is an archived tombstone). Tone.js, the most-starred, has the 3rd-longest README. Nothing says a long README hurts. |
| "GitHub READMEs can embed a real video player with SOUND — solving the silent-GIF problem" | The player **renders muted by default** (GitHub auto-adds `mute`); the viewer must click to unmute. Sound is opt-in behind a click; the default first impression is still silent. Also: only drag-dropped videos (`user-attachments/assets/<uuid>`) render a player — a **committed** video does not, though a committed `.gif` does. GitHub strips `<audio>`/`<video>`/`<iframe>` from READMEs. |
| "Only 5.5% of repos have a contributor guide, so a CONTRIBUTING.md puts Loom in the top ~5% of all repos" | The Octoverse figures are right (5.5% contributor guides, 2% CoC, ~63% README). **Drop the "top 5%" conclusion**: it applies a public-repo statistic to "all repos", treats a binary attribute as a percentile, and leans on a denominator dominated by forks and abandoned projects. Among projects that actually compete for contributors, contributor guides are **common, not rare**. |
| "67% say a licence is very important — making the missing LICENSE the single largest structural blocker to contribution" | The 67% is real (GitHub Open Source Survey 2017, n=5,500). **Drop "single largest blocker"** — the survey ranks licences among *types of documentation*, not among all barriers, and never makes that claim. The same survey's most-encountered problem is incomplete/outdated documentation (93%). A licence remains a real, cheap precondition; it just isn't a survey-backed #1. |
| "Maintainer non-responsiveness is the primary driver of abandoned PRs" | **Secondary, not primary.** Coding 354 abandoned PRs (Khatoonabadi et al., TOSEM 2022): the most common reason is contributor-side — difficulty addressing review comments (**45.8%**) — while lack of maintainer review (**22.6%**) is explicitly "the second common reason". The strongest predictor is discussion **volume**, not latency (latency mattered in only 4 of 10 projects). |
| "Newcomer GFI merge rates collapsed 61.9% → 42.2%, and nothing about the initial PR predicts success — so maintainer interaction is the conversion mechanism" | Metrics accurate (EASE 2026, 406,826 issues). But the paper tested **three** variables (code size, changed files, description length) and found a null result — not "nothing predicts success". And it **does not conclude** maintainer interaction is the mechanism; that sentence is a citation to prior work. The paper explicitly disclaims causal inference. |
| "Strudel's examples are 28 playable inline MiniREPLs" | **31** examples, and they are **static link tiles** (`<a href="/#<base64>">`) that open the main REPL preloaded — 0 iframes, no embedded editor. Live code, one click from playing; the MiniREPL mechanism belongs to the *docs*, not the gallery. |
| "The name Loom collides with 3 music products including a commercial synth from inMusic" | Confirmed, and if anything **understated** — but: **7** GitHub repos named exactly `loom` with >500 stars, not eight (loomio/loomio is "loomio"); "Loomer" is a *company*, not a product named Loom; and the AIR trademark sentence **could not be found on any fetchable page** — do not quote it. Verified: AIR's Loom II is actively sold, SERP positions 1/2/3/4/6/9, Atlassian's $975M loom.com acquisition, openjdk/loom at 2,012★. |
| "Loom can claim 'the best free browser 303'" | **It cannot.** tb303.com has two filter models (biquad + an AudioWorklet diode ladder), MIDI, WAV render, pattern JSON import/export, a pattern community — **and a real share link**. Acid Machine 2 has 2×303 + drums + 4 FX + piano roll + ReBirth `.RBS` import + MIDI Learn, free. (Correction: Acid Machine has **no** pattern share-URL — only tb303.com and acidBros do. And Loom has **nine** engines, not eight.) |
| "'No signup / nothing uploaded' is never the hook" | Mostly true as a tendency, not a rule. Only 3 stories >80 pts have "no signup" in the title. Widened to "no login"/"no sign-up", clear counterexamples appear where the *absence of friction* IS the hook: a no-login checklist app (105 pts/127 comments), a resume maker with no sign-up (119), video calls with no login (149). The pattern: no-signup leads when the category is **saturated and login-burdened**; when the capability is novel, the capability leads. |

---

## 6. Unverified — weigh these yourself

Nobody checked any of the following. They are here because they may be right and are cheap to
check, not because they are established.

**Whole angles with zero verification** (8 of 13): `hacker-news`, `reddit-dev`, `case-web-music`,
`case-oss-daw`, `non-reddit-communities`, `license-strategy`, `ai-disclosure`, `anti-patterns`.

The load-bearing unverified claims:

- **Show HN is restricted** (§3.5). Primary source quoted; check it yourself in a browser — it is
  a one-minute test and it gates the whole HN plan.
- **r/InternetIsBeautiful is the traffic channel** (§3.6), with drawbeats at 2,948 and the
  299-vs-1 natural experiment. The most valuable unverified claim in the run.
- **The AI-disclosure temperature has improved.** The scout reports curl's Stenberg writing in
  April 2026 that *"the slop situation is not a problem anymore"*, and a 2026-07-13 arXiv study of
  1,000 top repos finding **78% of AI policies allow AI-assisted contributions and 51% require
  disclosure**. It also argues Loom is unusually well-armoured: zero runtime deps, 26,711 lines of
  tests vs 37,381 of source, IBM Plex Mono and no Inter/shadcn/Tailwind/glassmorphism (scoring ~0
  on a design-slop detector that flagged 22% of 1,590 Show HNs). Plausible, unchecked.
- **The `Co-Authored-By: Claude` trailer is a live problem.** 996 of 1,449 commits carry it. The
  scout argues it asserts AI *co-authorship*, which the Linux kernel deliberately rejected in
  favour of `Assisted-by:` precisely because only humans can certify the DCO — and that this now
  conflicts with the AGPL LICENSE that just landed. Worth an hour of thought; entirely unverified.
- **AGPL §13 is inert for the browser app.** The scout's reasoning: §13 triggers only on modifying
  the Program *and* the modified version supporting remote network interaction, and FSF's FAQ
  limits that to programs "expressly designed to accept user requests and send responses over a
  network". It notes FSF's own LibreJS page recommends **GPLv3** for your own JavaScript, and that
  serving the bundle is already *conveying* under GPL §5/§6 regardless. It also found the premise
  of its own brief false: `tools/stem-service/` is a tracked FastAPI server with CORS, so Loom is
  **not** 100% client-side — and that service is the only place §13 does work. Its recommendation
  was AGPL "with a thin margin". The repo has since landed AGPL for the stronger reason (§2): the
  Strudel derivation left no choice.
- **The stem-service depends on ADTOF, which is CC BY-NC-SA 4.0** — which the FSF says "does not
  qualify as free" — via an unlicensed port. Unverified, and worth checking before advertising the
  transcription feature.
- **Roland trademark exposure.** The scout reports Roland's own page confirms "TB-303" and "Bass
  Line" are registered trademarks with 2019 filings explicitly reaching "music software" — and
  that Roland removed Propellerhead's **ReBirth** (a 303+808+909 emulator) from the App Store on
  **15 June 2017** on an IP claim, after 20+ years of informal tolerance. The audit's separate,
  verified view: Loom's code and framing are fine (nominative use); the exposure lives in the 68
  kit *names* ("Roland TR 909", "Akai MPC 60", "Linn Drum"...) — and **resolves for free if the
  kits go** (§1.3).
- **NLnet is real money.** Its regular call was closed on 2026-07-15 but "will reopen after the
  summer of 2026" — i.e. within weeks. It funded **Zrythm, a DAW**, in April 2026, which proves
  music tools are in scope. Diarise it.

---

## 7. Spanish-language

The honest shape, per the scout: **one genuinely high-value move (Hispasonic), one cheap free
shot (Microsiervos), one worth diarising (NLnet), and the rest is a distraction.** This angle
*was* verified — 10 of 10 fact-checkers returned — so the corrections below are solid.

### Hispasonic — the best Spanish target, but not the way the scout thought

✅ **Alive**: publishing daily in July 2026 — an article "hace 23 horas", a forum post "hace 53
minutos" at fetch time. Founded January 2002, Sonic Network S.L., Barcelona.

⚠️ **But "highly active" overstates it.** The famous "332.903 topics | 4.005.436 posts" is a
**cumulative 24-year total**, not a measure of 2026 activity. The synth subforum runs a handful
of active threads per day, and ~26% of all site posts sit in Charla general / off-topic.
"Steadily active, past its peak volume" is the accurate reading. "The single best Spanish-language
target" is **not established by any source** — no comparison was ever made.

✅ **It has already covered exactly Loom's category**: *"Viktor NV-1, sinte Web MIDI gratuito de
código abierto"* — a free, open-source, browser-based Web MIDI synth.
<https://www.hispasonic.com/noticias/viktor-nv-1-sinte-web-midi-gratuito-codigo-abierto/41084>
(Correction: the article links the author's GitHub **profile**, not the repo. And both cited
articles are old — 2015 and 2018. No 2024-2026 Hispasonic coverage of a browser-native
open-source instrument was found, so this is **not** evidence of current editorial appetite.)

✅ **The human to pitch**: **Pablo Fernández-Cid** — Hispasonic's Technology & Synthesizers Editor,
author of that Viktor NV-1 article, still publishing in June 2026.
<https://www.hispasonic.com/usuarios/pablofcid>

✅ **The sanctioned route**: the contact form has an explicit **"Envío de notas de prensa"** option
in its Asunto dropdown. <https://www.hispasonic.com/contacto> — ⚠️ but the correction matters: it
is a **routing category on a general contact form**, not a published editorial policy. No
submission guidelines, no named reviewer, no commitment to publish; it goes to
`admin@hispasonic.com`. Do not read it as permission to post promotionally in the forums.

✅ **The community reacts with curiosity, not hostility** — but engagement is modest.

### ❌ The forum rules are stricter than the scout claimed — REFUTED

This is the correction that changes the plan. The scout cited `/avisos-legales`, which bans
comments created *"sólo con fines promocionales"* — and concluded the "sólo" leaves room for a
substantive post. **It does not.** That page itself defers to `/normas-foros`, which controls.

**Norma 14** has no "sólo":

> *"La participación de profesionales y empresas en el foro es bienvenida, siempre que no hagan
> publicidad de sus productos o servicios fuera de Mercasonic o el sistema de banners (aunque sí
> se permiten enlaces a webs comerciales en las firmas)."*

It prohibits **the act** of advertising your product outside Mercasonic or paid banners —
regardless of how substantive the post is. Substance is not a defence the text provides.
**Norma 16** requires **prior authorisation** for "cualquier actividad comercial fuera de
Mercasonic, sea de particulares o empresas" — reaching *particulares* too. **Norma 20** permits
permanent expulsion "con o sin previo aviso".

What the rules *do* permit:
1. **Put the project link in your signature** — explicitly allowed by Norma 14's parenthetical.
   This is the sanctioned surface.
2. Participate substantively on topic; let the signature carry the link.
3. **Ask a moderator first** if you want a dedicated post. That is the posture Norma 16 encodes.
4. Mercasonic or the banner system for actual promotion.

Genuine unresolved ambiguity — *do not treat as permission*: Norma 14 targets "profesionales y
empresas" advertising "sus productos o servicios". A free, non-commercial, open-source project by
an individual may fall outside it. But Norma 16 reaches particulares and demands prior
authorisation. **That call belongs to a moderator, not to you.** Combined with the press-release
route above, the sequence is obvious: email first, post second.

### Which Hispasonic forum

⚠️ Corrected: **f37 "Plugins e instrumentos virtuales"** (9,182 topics / 83,579 posts) is the
busier forum by ~12x cumulative — but **f57 "Programación y entornos"** (752 / 7,471) is **not
"nearly dead"** as claimed. Its last post is 4 days old (f37's is 2), and recent threads draw
comparable replies (f57: 3/3/6/15 vs f37: 11/6/2/9/2). f37's lead comes from age and pinned
megathreads, not higher engagement today. All four "no replies" examples the scout cited were
wrong — every one has replies. **f57 is the topically correct venue** for announcing music
software you built; expect a handful of replies, not none.

### ✅ Microsiervos — a rare, quotable green light

**CONFIRMED**: Microsiervos explicitly permits promoting your own project provided you declare it
upfront. Source: <https://www.microsiervos.com/archivo/general/microsiervos-faq.html> (v1.6b,
updated June 2024), verbatim in the FAQ. Contact: <https://www.microsiervos.com/contacto.html>.
Cheap, sanctioned, worth one email.

### ✅ Genbeta — dead, do not pitch

**CONFIRMED**: last original article **2025-12-31** ("Gracias por habernos leído" — in practice an
editorial closure). Everything newer is a Webedia cross-post. The site remains online as an
archive. This is a prior that died on contact with a primary source — it would have been a wasted
email.

### ⚠️ Hispasonic /freeware — corrected

The scout said "desktop-only, will not take Loom — do not chase it". **Not by policy.** Its
platform facets include iOS and Android, a moderator actively solicited mobile apps, and it is not
VST-only (Audacity, MuseScore, Studio One Free are listed). The *real* reasons to deprioritise are
narrower: the platform vocabulary has **no web/browser value**, so a browser app has no tag to
occupy; and across ~60 sampled entries every one is Win/Mac/Linux, with the iOS/Android facets
entirely unpopulated. Correct framing: low-probability, low-priority — worth at most a zero-cost
post in the existing selection thread, not "will not take it".

### Not worth it

Spanish music-tech media is VST-centric; the Spanish producer Discords are trap/beatmaker
promo-channel culture with poor fit for a TB-303 web DAW.

---

## Appendix — provenance

- **Journal**: `wf_13682cc8-77e/journal.jsonl` — 217 events, 152 `started`, 65 `result`.
- **Recovery**: `tools/recover-workflow-journal.mjs` (dumps the values) and
  `tools/index-workflow-results.mjs` (joins each `agentId` to its angle, claim and verdict via the
  agent transcripts — the journal itself stores no labels).
- **Not included, because it does not exist**: post drafts, a channel plan, a calendar. The Plan
  and Drafts phases never ran. Do not let this document's confidence imply they were dropped for a
  reason — they were simply never written.
- **Repo facts** marked "today" were re-verified on 2026-07-16 against the working tree and the
  live GitHub API, not taken from the research.
