# Seven-Pass Revision and Four-Layer Writing Audit

Revise in order. Save prohibition lists for the fifth pass: first rescue the person and material, then clean the sentences. After all seven passes, audit from objective failures to subjective voice. A later layer cannot compensate for a failure in an earlier one.

## Seven revision passes

### 1. Identify who is speaking

- Mark paragraphs that another model could have written unchanged.
- Repair them with information provenance, the author's choice of evidence, and concrete material. Delete them when there is nothing real to add.
- Do not add “我觉得”, “说真的”, or decorative first person to hide an anonymous voice. Voice comes from selection and position.

### 2. Check whether the article moves forward

- Give every paragraph one internal function: action, fact, explanation, example, question, judgment, background, or emotion.
- Ask what each following paragraph adds. Merge or delete a paragraph that merely rephrases the one before it.
- Internally name one material source for every nonfiction paragraph. Delete a paragraph whose only source is “further explanation” or “a possible effect”.
- Run the compression test. If removing one third leaves the facts, actions, judgments, and reading experience almost unchanged, keep the shorter version. Never preserve padding for a target word count.

### 3. Remove performative Chinese

- Delete most screenshot-ready “deep” lines that add no fact, explanation, or earned emotion in context. If consecutive paragraphs end in short judgments, keep only the one with the strongest material.
- Remove unsourced exact times, weather, expressions, room details, props, and quotations from nonfiction.
- Remove fake forum speech, rows of abstract nouns, and metaphors that keep changing worlds.
- When three metaphor fields appear close together, restore all of them to their literal meaning first.

### 4. Listen to the Chinese

- Put the actor and action early. Rework “……的，是……”, “真正让……的”, and long sentences carrying several “的”.
- Check what each sentence hands to the next. Omit a repeated subject when the reference is clear; write the name again when two people are present.
- Read aloud for the weight of pauses. Merge short sentences that knock like a drum and split a long sentence only where one thought has landed.
- After an action, object, or exact words already convey emotion, try deleting the explanation that follows.

### 5. Clear prohibited patterns

- Load `humanizer-zh` only now and apply its hard prohibitions one by one.
- Run `bun <humanizer-zh>/scripts/check-prose.ts <draft.md>` and revise until all hard failures are zero.
- Treat warnings as prompts for human judgment. Dashes in body prose are hard failures by default; colon warnings also become failures under `--strict`.

### 6. Verify reality

- Recheck time, numbers, identities, quotations, causality, and every first-person action. This pass maps to L1 and L3 below.
- Repeated “公开资料显示” or “目前无法确认” means verification notes leaked into the body. Move the notes backstage and state a material boundary once.
- Do not add “可能” or “或许” to every sentence. Repeated hedging makes the author disappear.

### 7. Test the ending

- Delete each of the last two paragraphs in turn and reread. If the article gains force, end earlier.
- Delete a final paragraph that merely summarizes the article.
- Search for “时代、文明、未来、世界、历史、所有人”. If the body has not continuously worked at that scale, return to a concrete fact, action, or present judgment.

After the seven passes, run the existing four layers as the final acceptance check.

## L1 — Integrity and hard failures

- Are all quotations, data, release states, dates, and product names traceable?
- Does any sentence present inference, vendor claims, or third-party testing as established fact?
- Does the draft invent first-hand experience, emotion, a user story, or an unnamed authority?
- Did internal revision notes, model disclaimers, or prompt language leak into the article?
- Are there promotional clichés, artificial urgency, or claims stronger than the evidence?

Pass only when every material problem is fixed or explicitly marked unresolved.

## L2 — Structure and rhythm

- Does the opening begin with something concrete and create the article's main question?
- Does each section advance that question rather than merely add information?
- Are detours followed by a clear return to the main line?
- Do paragraph lengths and sentence shapes vary without mechanical short-paragraph quotas?
- Are headings and lists used according to the archetype and reading task?
- Does the ending close the argument or return to the opening instead of adding a generic summary?

## L3 — Evidence and content quality

- Does every core judgment have evidence, direct observation, or an explicitly labeled inference?
- Are official claims distinguished from independent tests and the author's own experience?
- Are limitations placed near the claims they constrain?
- Is the strongest reasonable counter-position represented fairly?
- Does the article translate the topic into a consequence for its named reader?
- Does the selected archetype meet the required-material checklist?

## L4 — Author voice and reader flow

- Could this article plausibly come from the author profile and representative samples?
- Is the posture a thoughtful observer with a judgment, rather than a reporter, marketer, or lecturer?
- Are first-person passages specific and true rather than decorative?
- Are memorable short lines earned by prior evidence?
- Does any paragraph break the reader's attention because it is abstract, repetitive, or over-explained?
- Is uncertainty expressed as part of the judgment rather than as empty hedging?

## Compact report

```text
Style audit: PASS / REVISE
L1 Integrity: pass / issue
L2 Structure: pass / issue
L3 Evidence: pass / issue
L4 Voice: pass / issue
Priority fixes:
1. <specific paragraph and action>
2. <specific paragraph and action>
3. <specific paragraph and action>
```

List no more than three priority fixes. Prefer a concrete edit over a style score.

---

Adapted from KKKKhazix/human-writing (MIT), especially `references/revision.md` and `references/reality.md`.
