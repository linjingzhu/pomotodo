# ai-dev-rule

A methodology for running AI agents as engineers on a real codebase: what a
Manager owns, how work is decomposed, what counts as evidence, and what must be
reviewed adversarially before it merges.

It is not advice collected from reading. **Every rule here was paid for** — the
defects that produced them are written down in `LESSONS_FROM_PRACTICE.md`, with
what each one cost.

## What is here

```
CLAUDE.md                              Claude entry point
AGENTS.md                              Codex entry point
LESSONS_FROM_PRACTICE.md               why the rules are worded as they are
.claude/
  agents/
    fast-explorer.md                   read-only search, returns a conclusion
    adversarial-reviewer.md            independent review, returns PASS or FAIL
  skills/
    auto-dev/SKILL.md                  the development loop, started only on request
.codex/agents/
  fast-explorer.toml                   Codex read-only search agent
  adversarial-reviewer.toml            Codex reviewer, model selected per run
.agents/skills/auto-dev/
  SKILL.md                            Codex development loop
  agents/openai.yaml                   explicit invocation only
.ai/
  CORE.md                              priority, autonomy, evidence, versioning
  MANAGER.md                           Manager responsibilities and handoff
  EXECUTION.md                         parallel work, Mission Packets, ownership
  REVIEW.md                            adversarial review, risk levels, resolution
  UX.md                                user-facing surface rules
  REPOSITORY.md                        merge authority and repository modes
  REPORTING.md                         the final report, and what may be claimed
  HARNESS.md                           what the environment owes a run, and where config lives
  LOOP.md                              one attempt, the attempt budget, and stop conditions
  EVOLUTION.md                         when to record a lesson, and how it becomes a check
  CHANGELOG.md                         the set's version, dated, with what changed
  ROADMAP.md                           ← written per project by the auto-dev skill
  PROJECT_CONTEXT.template.md          ← fill this in per project
  reports/                             per-run reports land here, per project
  tools/                               structural guards over the set itself
  memory/
    MANAGER_PLAYBOOK.md                candidate strategy lessons, empty until earned
    PROJECT_LESSONS.template.md        ← start empty, per project
```

Each rule is stated in exactly one file, and the others point at it. A section
marked *Single source* is the one that may be edited; a pointer is not a summary
and must not grow into one.

What is under `.claude/` is the set's committed Claude harness: two agent
definitions a Mission Packet may name, and one skill — `auto-dev`, the loop
that proposes a roadmap, challenges it, then builds, verifies and merges it an
item at a time.
They are in the repository because a contributor who clones it can use them and
one who does not have them cannot. `.ai/HARNESS.md` §
*Where harness configuration belongs* is the rule that decides what else may
live there. Codex receives the equivalent agents under `.codex/agents/` and
the skill under `.agents/skills/`, sharing the same `.ai/` policies.

`auto-dev` runs only when the user asks for it by name. A mode that chooses
what to build is choosing product scope, so it is not something a run may decide
to enter on its own. In Codex, invoke it with `$auto-dev`; automatic selection
is disabled in `.agents/skills/auto-dev/agents/openai.yaml`. See `.ai/HARNESS.md` §
*Codex capabilities and model routing* for Codex model choices and the
reviewer's different-model requirement.

Nothing under `.ai/` except `PROJECT_CONTEXT.md` knows what the project is. That
is deliberate and it is what makes the set portable — so this repository ships
the **templates** and no filled-in instance. `PROJECT_CONTEXT.md`,
`memory/PROJECT_LESSONS.md`, and anything under `reports/` belong to the
repository that adopted the set, and are created there.

If you find project-specific facts in any file other than those three, that is a
defect in this set, not a local exception.

## Adopting it

*One command, and the same one whether you are adopting into an existing
repository or starting a new one from this template.*

```bash
python3 .ai/tools/adopt.py --into /path/to/your/project \
    --name "Your Project" \
    --set repository_mode=personal --set base_branch=main \
    --set merge_deploys=no --set runtime_gate=none \
    --set test_command="npm test" --set lint_command=none \
    --set build_command=none --set generated=none \
    --set external_scripts=none --set public_ids=none \
    --set owner_ledger=docs/OWNER_ACTIONS.md
```

It copies what travels — including both harnesses' agents and skills, and never
over a capability or Codex entry file the target already has — writes both
instance files with the templates' instruction lines removed, and runs the
checks in the new tree. It ends green,
or it exits non-zero naming every fact still unanswered — omit the `--set`
flags to be told what they all are. `.ai/tools/README.md` § *Starting a
repository from this set* is the detail.

### Or GitHub's "Use this template"

That button copies every file, including two that must not travel — the result
fails its own checks before anyone has changed anything. Finish it in place:

```bash
python3 .ai/tools/adopt.py --from-template --name "Your Project" --set ...
```

`.ai/tools/README.md` § *GitHub's "Use this template"* says exactly what that
removes and what it only warns about.

Then fill in the prose of `.ai/PROJECT_CONTEXT.md`: what the product is, what it
is **not**, and what is being built now. The facts are checked; the prose is
what stops an agent inventing a project.

Set `repository_mode` deliberately — it is the single line deciding whether an
agent may complete a merge without being told to.

## The idea in one paragraph

Agents are fast and confident, and confidence is the failure mode. Almost every
expensive defect behind this repository was the same shape: **something reported
success for a question it was never asked.** A compile said the code was valid
and was read as "it works". A guard said a pattern was absent and was read as
"the rule is kept". A green build said every step exited zero.

The defence is not more checks. `.ai/CORE.md` §
*The question each result answers* states it, and states it once.

## Checks

Use Python 3.11 or newer; the tools parse native Codex agent TOML with the
standard library.

`.ai/tools/` holds structural guards over the set and over the repository that
adopted it: front matter, cross-references, one owner per heading, a denylist
of project-specific names, the changelog, the facts a filled-in project context
must carry, and the capability definitions — agents and skills — the harness is
told it can offer. They read structure rather than prose, they print the
question each result answers, and `.ai/tools/README.md` lists what they
deliberately do not answer.

```bash
python3 .ai/tools/check_policy_set.py        # the checks
python3 .ai/tools/test_check_policy_set.py   # prove each one fails on purpose
python3 .ai/tools/test_adopt.py              # prove an adopted repo starts green
```

Run these commands locally before submitting changes. The tools travel with
`.ai/`; the set does not ship GitHub Actions workflows or install them during
adoption.

## Status

Every document under `.ai/` carries front matter — `doc_id`, `version`,
`canonical_path`, `updated` — and is versioned `MAJOR.MINOR.PATCH` by policy
impact rather than bumped mechanically. `.ai/CHANGELOG.md` § *Document versioning* is the
rule that defines all four fields and what each level of bump means.

The set as a whole is versioned in `.ai/CHANGELOG.md`, whose newest entry is the
current version. Every entry there carries a version, a date and what changed —
enforced, not asked for.

`LESSONS_FROM_PRACTICE.md` is append-only in spirit: entries are added when
something is paid for, not when something is read.
