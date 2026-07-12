---
name: writing-style
description: Build, apply, and audit a truthful personal writing voice for Chinese long-form articles. Use when drafting, rewriting, polishing, or reviewing an article that should match the author's own style, especially inside the just-write workflow or when a project provides a writing-style STYLE.md profile and representative articles.
---

# Writing Style

Give an article a positive author voice after factual material is available. Do not replace `humanizer-zh`: use that skill to remove generic AI patterns, then use this skill to restore the author's judgment, rhythm, and posture.

## Load the style profile

Read the first existing `STYLE.md`:

1. `<cwd>/.baoyu-skills/writing-style/STYLE.md`
2. `$XDG_CONFIG_HOME/baoyu-skills/writing-style/STYLE.md`
3. `~/.baoyu-skills/writing-style/STYLE.md`

If no profile exists, use the generic defaults in this skill. When the profile lists representative articles, read at most two that match the current article archetype. Learn recurring decisions and rhythms, not isolated catchphrases.

Use [references/style-profile-template.md](references/style-profile-template.md) when creating or revising a project profile.

## Establish the material card

Before drafting, identify:

- The author's actual judgment, not merely the topic.
- First-hand experience or observation supplied by the author.
- Verifiable facts, sources, and screenshots.
- The emotional node: what surprised, bothered, excited, or changed the author's mind.
- The reader consequence: why an ordinary user, developer, or other named audience should care.
- The strongest reasonable counter-position or uncertainty.

Never invent first-hand experience, quotations, results, people, or emotional memories. If a required element is absent, omit it or ask one targeted question. Clearly separate sourced facts, inference, and personal judgment.

## Choose an article archetype

Choose the closest archetype before drafting. Read [references/article-archetypes.md](references/article-archetypes.md) for its evidence needs and narrative emphasis.

- Personal reflection
- Hands-on product test
- Event or news analysis
- Product comparison or trend observation
- Tool or method sharing

Use archetypes as routing guidance, not rigid templates. Mixed articles must still have one main narrative.

## Draft with a positive voice

- Open with a concrete event, result, scene, or contradiction. Avoid generic era-setting introductions.
- Keep one main question. After a necessary detour, use a short sentence to return to it.
- Support every core judgment with a source, observed result, concrete case, or clearly labeled inference.
- Use first person only for real experience or genuine judgment. Do not manufacture intimacy.
- Explain technical material in plain language without pretending the reader is uninformed.
- State limitations early enough to affect the conclusion. Do not hide them in a disclaimer at the end.
- Make a clear judgment, but preserve uncertainty when evidence is early, partial, vendor-provided, or anecdotal.
- Connect macro trends to a product decision, user behavior, developer action, or system boundary.
- Vary paragraph and sentence length naturally. A short standalone sentence is useful only when the preceding material earns it.
- Use headings, lists, quotations, bold text, colons, and dashes when they improve comprehension. Do not ban or force them for style.
- End by tightening the judgment or returning to the opening. Do not force cultural elevation, optimism, or a call to comment.

## Revise in two passes

1. Load `humanizer-zh` to remove generic AI phrasing, fake balance, promotional language, repetitive structures, and mechanical transitions.
2. Reapply this skill and the project profile. Restore precise judgment, evidence boundaries, author posture, and intentional rhythm that generic cleanup may flatten.

When rules conflict, prioritize factual truth, user-provided experience, the project profile, and article-specific clarity. Delete generic manufactured quotable lines; retain concise lines that are earned by the evidence before them.

## Run the four-layer audit

Read [references/quality-check.md](references/quality-check.md) and audit in this order:

1. Integrity and hard failures
2. Structure and rhythm
3. Evidence and content quality
4. Author voice and reader flow

In the full just-write workflow, fix safe issues directly and report only the top one to three material changes. For audit-only requests, return the compact report from the reference. Never optimize for a numeric quota of colloquialisms, short paragraphs, rhetorical questions, or stylistic punctuation.
