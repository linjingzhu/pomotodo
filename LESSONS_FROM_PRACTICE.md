# Lessons from practice

Generalised from real defects in a real project. Every one of these cost
something before it was written down.

`.ai/memory/PROJECT_LESSONS.md` — the per-project file each adopting repository
creates — holds *repository* memory and should never be copied between projects.
This file is the opposite: what survived being stripped of its project. Nothing
here names a codebase, and everything here happened.

Entries 16–23 were generalised out of one project's own lessons file and run
reports when that project's material was removed from this repository. The
defects are the same ones; only the codebase they happened in is gone.

Entries 24–29 came from a second project: a small web product built over
nineteen days by four different agents in turn, with the session logs and the
full git history read afterwards to measure what each habit had cost.

---

## 1. Evidence proves one claim, not the next one

**A compile proves the code is valid. It proves nothing about whether it runs,
and nothing at all about whether it is reachable.**

The case: a feature added a branch to an upstream request dispatcher. It
compiled. Every static guard passed. The native build was green. It could not
serve a single byte — because the dispatcher is guarded by an allowlist of exact
paths, and the new path was never added to it. Every request was refused before
the branch was reached. The branch was unreachable code that compiled.

No compiler, no linter, no guard and no test objected, because none of them was
looking at that question. Adversarial review found it.

> **Rule.** When a change adds a *branch*, find the gate that decides whether
> that branch is reached at all, and check the branch is named there too.
> "Compiles" and "reachable" are two claims. Report them separately.

## 2. A feature whose failure looks like its absence hides its own defects

The same feature had a documented limitation: a rejected asset and a missing
asset produced an identical blank result. Missing file, oversized file, wrong
format — one outcome.

That limitation was written down honestly, and it was **also the property that
would have hidden the unreachable-branch defect from the only person able to
observe it.** They would have seen nothing and concluded they had installed the
file wrong.

> **Rule.** When absence and refusal are indistinguishable at the surface, that
> is not a cosmetic gap. It is a hole in every future diagnosis of that feature.
> Make them distinguishable, or state plainly that the feature cannot be
> debugged from outside.

## 3. Check the constraint you are *not* amending

A design was reasoned carefully against the performance budget being amended for
it — and never checked against the budget next door, whose first zero-tolerance
condition it violated three times per page load.

> **Rule.** Amending one constraint is the moment to read its neighbours. The
> constraint you are rewriting is the one least likely to catch your change.

## 4. Derive from the source; do not assert from memory

Two questions were about to be answered with confident, plausible reasoning.
Both were settled instead by reading the pinned upstream source, and both
answers were the opposite of the plausible one:

- a data source returned `AllowCaching() == false`, so the asset was re-read on
  **every** page load rather than once per process;
- a container sized its inner frame with `width: inherit`, so a host positioned
  with `inset: 0` alone computed `auto` — and the frame, being a replaced
  element, fell back to its 300×150 default. The CSS that "looked wrong" had
  been correct the whole time; the box around it was wrong.

The second had already shipped as a visible defect.

> **Rule.** If the source is reachable, read it. A derivation from source is a
> strong claim; a derivation from memory is a guess wearing its clothes. When
> the usual host is blocked, a mirror usually is not.

## 5. Read every layer that touches a definition

A message vocabulary was extracted from the patch that *creates* the file and
reported as seven values. A later patch extends the same file; the real number
was nine. The error reached a document written to be handed to another team.

> **Rule.** In any layered system — patch stacks, overlays, mixins,
> configuration cascades — enumerate every layer naming the symbol, not the
> first one that defines it.

## 6. A value stated twice is a value that will drift

A build identifier existed in a page header and again, hardcoded, inside the
export text a human copies back as their result. The second copy went two builds
stale unnoticed.

That is worse than a cosmetic slip: it turns every collected result into a
result about an **unknown** build, and it does so silently, looking exactly like
a good result.

> **Rule.** Single-source the value, then add a check that refuses a second
> spelling. The check matters more than the fix — the fix lasts until the next
> person adds a second copy.

## 7. Instructions written from the contract describe a screen that does not exist

Five verification steps came back blank. The instructions had been written from
the specification, which said the hierarchy is built by indentation. The
implemented page builds it with a parent selector. They described a screen
nobody could find.

The person said, twice, that they could not follow them. The second time was
blunt.

> **Rule.** Write a runtime walkthrough from the code that creates the surface,
> not from the contract that specifies it. A contract is exact for its author
> and opaque to whoever holds the mouse.
>
> **"I do not understand this" is a defect report about your writing.** Treat it
> as one.

## 8. Re-reading a recorded rationale can void it

A decision to exclude a capability rested on three stated grounds. Re-read
during an amendment, two collapsed: one was a real decision about a *specific*
technology written as a claim about the category, and the other had a
one-attribute answer available the whole time.

> **Rule.** When amending or reversing a recorded decision, re-read its grounds
> one at a time and mark which survive. Keep the table in the document. A record
> that quietly drops its own reasoning is worth less than one that shows where
> it was wrong.

## 9. A reviewer's finding is a hypothesis, not a verdict

A review raised a CRITICAL against a parser. Checking it directly showed a
higher-precedence check rejects the input shape first, so the defect could not
occur. Relaying it unverified would have escalated a non-issue to a merge
blocker.

> **Rule.** Reproduce consequential findings against the tree before acting on
> them or passing them on — including findings that favour caution, and
> including your own earlier statements. Correcting your own over-severe claim
> is part of the job.

## 10. Write the test for the rule; it will find the bug you did not write it for

Tests were written to pin one property: numeric-aware ordering, so `frame10`
sorts after `frame2`. One of them failed for an entirely different reason — a
sort key mixing bare integers and strings raised `TypeError` on a folder holding
both `1.png` and `a.png`. An ordinary folder would have crashed the tool.

The code had been reviewed by eye and looked correct.

> **Rule.** Tests written to pin an intended property routinely fail for a
> different reason, and that reason is usually the real defect. Write them
> before you are confident, not after.

## 11. Turn arguments into measurements

Recurring pattern, every time it was tried:

| Argument | Measurement that ended it |
| --- | --- |
| "the payload is probably fine" | 419.5 MB against a 250 MB threshold |
| "pre-decoding is cheap" | 1.24 GB resident |
| "the cap is generous" | the cap had no measurement behind it at all, and said so in its own comment |
| "roll cost is the unknown that decides this" | 4 of 21 patches conflict, 8 of 207 hunks |

The fourth is the sharpest: a document had twice admitted that one number would
change its conclusion, and had never gone and got it.

> **Rule.** When a decision turns on a quantity, measure it before arguing about
> it. A number nobody has is not a hard number — usually it is a cheap one.

## 12. A queued job is not a stuck job

Four long build queues, one absent self-hosted runner. Three were cancelled
after 1, 7 and 9 hours and re-dispatched within seconds into the same empty
queue. The one that was left alone waited 13 h 34 m, was picked up unchanged
when the machine returned, and succeeded in 26 minutes.

Cancelling discarded the wait without shortening it. The reflex looks like
action.

> **Rule.** Before re-dispatching, check the history and identify what is
> actually blocking. Then say plainly which side the blocker is on. "The machine
> is off and I cannot turn it on" is a complete answer.

## 13. Brevity is not authorisation for the largest reading

A two-word instruction admitted four scopes. Three of them would have deleted
governing documents.

> **Rule.** When an instruction is short, irreversible, and admits several
> scopes, enumerate the scopes with what each destroys and let the human pick.
> This is the narrow exception to acting without asking — not a licence to ask
> about everything else.

## 14. Guards that read prose make people write worse prose

Three rules once fired on their own explanations: a comment saying "there is no
silent mode" was matched as a silent mode.

A check that greps documentation teaches contributors to avoid words, not to
avoid defects.

> **Rule.** Make guards read code, configuration and generated artefacts —
> things with structure. If a rule can only be expressed as a phrase to search
> for, it is not yet a rule.

## 15. Run your own guards before trusting them

Guards written in one session produced four false positives found only by
running them: a substring check flagged a legitimate call, a syntax rule blocked
correct conditional rendering, another flagged an upstream identifier, and a
regex backtracked off a trailing underscore so a method call read as a property.

> **Rule.** A guard is code. Run it against the tree it will police, and against
> the defect it exists to catch, before you believe either result. A guard that
> has never failed on purpose has not been tested.

## 16. A clean merge is not a compatible merge

Two source layouts existed for the same product: the maintained one, and an
older experiment that had grown a second shell and its own patch authority.
Merging the experiment in bulk produced very few textual conflicts, because the
two trees mostly touched different files. That is exactly what made it
dangerous: a mechanically clean merge would have installed a **second source of
authority** beside the first, and nothing in the merge output would have said
so.

> **Rule.** Conflict count measures textual overlap, not architectural
> compatibility. Before merging a long-lived divergent branch, name the
> authorities each side claims — source layout, build entry point, who owns the
> stored state — and check that the result has one of each. Port isolated ideas
> across; do not bulk-merge a branch that disagrees about ownership.

## 17. Preparation passes the repository's own tests

A subsystem's manifests, contracts, registry entries and patch text were
complete, validated, and green on every check the repository could run. None of
it had ever been compiled into the shipping artefact, because compiling required
a toolchain the repository did not have. The status reported by the green suite
was true and the status a reader took from it was not.

> **Rule.** When the artefact cannot be produced in the environment that runs
> the checks, the checks answer "is this well-formed", never "does this ship".
> Give prepared work an explicit lifecycle state (`planned` / `prepared` /
> `verified`) and make the reporting refuse to advance the state without
> artefact evidence. The state machine is the fix; a careful sentence in a
> report is not.

## 18. Record what was built, not what was configured

Two builds of the same commit differed, and neither output could be traced back
to what produced it: the toolchain was discovered implicitly from the machine,
and development and release builds wrote to one output name.

> **Rule.** Evidence about an artefact must carry the artefact's identity —
> exact upstream revision, the build arguments, the resolved toolchain path, the
> output path and its hash. Keep debug and release outputs in separate
> directories with separate names. Historical output, or output from a
> different pin, is not evidence about the current one, and without recorded
> identity you cannot tell which one you are holding.

## 19. Do not shadow the platform's state

A feature needed to remember which of the host platform's objects belonged to
which of its own groups, and the first design gave it its own store of those
objects. It would have been a second writer of state the platform already owned
and restored on its own — with a duplicate restore path, its own corruption
modes, and drift whenever the platform changed anything behind it.

The fix was to keep exactly one owner and attach only the feature's own
identifier to the platform's existing per-object extra data.

> **Rule.** When you build on a platform that already owns a piece of state, own
> your metadata **about** it, never a copy **of** it. One writer, one restore
> path. A parallel store is a data-loss design even when every line of it is
> correct.

## 20. Match on durable identity, not on position

The same feature's first design matched its records to platform objects by
index and by a session-scoped handle. Both are reassigned by ordinary user
actions — reordering, closing, restarting — so the binding silently pointed at a
different object than the one it was written for.

A related finding, in the persistence layer: a record from a *newer* schema than
the reader understands must be preserved untouched, not discarded as invalid.
Dropping it turns an old reader into a data-loss event for a user who ever ran a
newer version.

> **Rule.** Bind to an identifier that the owner promises to keep. Index,
> ordinal, insertion order and session handle are not such identifiers. And when
> reading persisted state, distinguish *invalid* from *not understood* —
> recover the first, preserve the second.

## 21. A run taken while the tree is changing is not a run

A test suite reported four failures. A rerun after the tooling files settled
reported none, and the four had been real defects — in the test tooling, not the
product — that the concurrent run had surfaced by accident.

Both results were about to be reported. Neither was final: the first described a
tree that no longer existed, and the second would have hidden four genuine
tooling defects had they not been fixed first.

> **Rule.** Final evidence comes from a run over a still tree. If a run
> overlapped edits, it is a signal, not a result — investigate what it found,
> fix it, and rerun cleanly for the record. Never quote the convenient one of
> two runs without saying which tree each described.

## 22. Milestones and delivery units need separate status

Customer-facing stages and engineering delivery units were tracked on one axis,
so finishing the last engineering unit read as finishing the product — though
two whole stages, one of them not yet specified, sat beyond it.

> **Rule.** Report the customer milestone and the engineering unit as two
> separate fields, plus the exact unmet gate between them. Anyone reading one
> number will read it as the other.

## 23. Amend the specification beside itself, never inside it

A handed-over specification was edited in place to encode decisions taken after
it was written. The edits were correct decisions and the result was
unrecoverable: no reader could separate the original requirements from the
later choices, and the document could no longer be checked against the copy its
author still held.

> **Rule.** Keep a received specification byte-identical, and verify that with a
> hash. Record every later decision in a separate amendment that cites what it
> changes. A specification you may edit is no longer evidence of what was
> agreed.

## 24. Two owners of one generated file

Two agents, on two branches, each regenerated the same committed artefact from
the same source. Each branch's version of the file was the other's deletion.
The merge that followed deleted ten thousand lines, restored ten thousand
lines, ran four fix-and-revert commits, and landed a net change of three
lines. Nothing in either branch was wrong; the file simply had two owners.

Underneath it: the artefact was regenerated in twenty commits over two days,
because every wording change rebuilt four binary files that rode along with
it.

> **Rule.** A generated artefact has one owner, the integration branch. Every
> other branch edits sources only; regeneration happens once, at integration,
> by the command the project context names. And a check regenerates it and
> compares bytes, so an artefact that is stale, or hand-edited, fails before
> it merges.

## 25. A test that asserts today's value

Six tests asserted that the site had no advertising and no search-engine
token — by reading the real configuration, which happened to be empty. The
day the owner's identifiers were filled in, all six broke, and were rewritten
to construct an empty configuration explicitly. They had never tested the
rule "empty means absent"; they had tested the date.

> **Rule.** A test asserts the shape a configuration value must have, not the
> value it has this week. A real domain, identifier or token appears in at
> most one test, the deploy guard, and that test's name says so.

## 26. Watching is not free

An agent that opened a pull request was told to watch it: CI events, review
comments, a check-in every hour. Over one long session, 21.7% of all model
calls and 39% of all tool-result text went to those turns — and nearly half
of the events were echoes of the agent's own actions: the draft it had just
flipped, the merge it had just made, the subscription it had just created.
Forty-five turns concluded, in writing, that there was nothing to do.

The same session asked for a list of workflow runs thirty-eight times, and
twenty-four of those answers were too large for the harness to hand back,
while a single-run lookup carried the same fact at a tenth of the size.

> **Rule.** Handle a watched event as a summary: read it, answer only a
> changed state, and never answer your own echo. Ask the smallest query that
> carries the fact. A check-in that finds nothing changed re-arms silently.
> The cost of waiting is paid in the same tokens as the cost of building.

## 27. Built, deployed, reverted

In one day: a palette change was built and deployed, then reverted on sight;
a storage decision went browser → server → "no server" within sixteen
minutes, discarding a pull request; a content pack was published, withdrawn,
published again and withheld. One layout request took three restatements.
Each round trip was fast — the median was under three minutes — which is
exactly why the cost was invisible: nothing waited, so nothing was checked.

> **Rule.** When a request mixes a product or visual choice with
> implementation and admits more than one reading, state the reading in one
> line, with the nearest alternative, before building. When a merge deploys,
> show the change before it merges. Neither costs a minute; the alternative
> cost four pull requests.

## 28. Twenty pull requests nobody signed

Four agents worked the same repository in sequence. Twenty of the squash-
merged pull requests carried no author trailer for the agent that wrote them;
a further branch family carried no attribution at all. The policy set in
force named two specific vendors as the cross-review pair, and neither pair
ever reviewed anything — the reviewers that existed were other models of the
same vendor and a different tool entirely. Afterwards, nobody could say which
model had written which lesson, or whether any lesson had been reviewed by a
model that did not write it.

> **Rule.** Name the model on every commit, report and recorded lesson. An
> independent review is one by a *different model*, whichever vendors are
> involved, and the report names both; a fresh context of the same model is
> distance, not independence, and is labelled as a fallback.

## 29. The attachment that never arrived

Three images were pasted into the conversation with a one-line instruction to
use them. They existed on the user's screen and nowhere on disk; the agent
could see them in the message and could not read a byte of them. The turn
that should have said so at once was spent searching mount points.

> **Rule.** If an attachment does not reach the working tree, say so in the
> same turn and ask for a path or an upload. Describing, cropping or
> committing an image you were shown but never received is a result reported
> for a question — "is the file here?" — that was never asked.

---

## The shape underneath all of them

Most entries here are one failure wearing different clothes:

> **Something reported success for a question it was never asked.**

A compile answered "is this valid C++" and was read as "does this work". A guard
answered "does this string appear" and was read as "is this rule kept". A green
build answered "did every step exit zero" and was read as "the feature works". A
sheet answered "which build did the generator think it was" and was read as
"which binary was tested".

The defence these entries paid for is written as policy in `.ai/CORE.md` §
*The question each result answers*, and only there. This file is the evidence
behind that rule, not a second copy of it.
