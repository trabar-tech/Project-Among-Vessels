# 06 — Identity and Passing

**Project Among Vessels** · Phase 3 research deliverable · Status: **specified, v0.1**
Requires: [02_AMONG_US_CORE.md](02_AMONG_US_CORE.md), [04_AI_ARCHITECTURE.md](04_AI_ARCHITECTURE.md), [05_QUICKCHAT_GRAMMAR.md](05_QUICKCHAT_GRAMMAR.md)
Canonical data: `tools/data/quickchat_grammar.json` (v0.2.0), `tools/data/state_machine.json` (v0.2.0), `tools/data/balance_defaults.json` §identity
Engine: `engine/src/sim/suspicion.ts`

> **The design correction.** An impostor is not a monster wearing a crewmate's skin. An impostor is
> a **person whose papers are not theirs**. In a corporate-run dystopia, a forged berth, a
> borrowed badge, and a sealed crate with the wrong manifest stamp are all cheaper than a
> legitimate transit contract — and vastly more common. The horror is not that something inhuman
> is aboard. The horror is that **nobody's identity is verifiable, and the ship's own bureaucracy
> is the only witness.**

---

## 1. Why This Is a Better Core Than "Killer Alien"

The original framing (impostor = hostile entity in disguise) has a structural problem: it makes the
impostor's nature *the* mystery, which collapses the social layer into a single question — "who is
the monster?" — with a binary answer.

The reframing to **illegal personnel** changes the game's questions in four ways:

| Question | Monster framing | Passing framing |
|---|---|---|
| What is being hidden? | Species | **A person's actual history and purpose** |
| What is the evidence? | Supernatural tells | **Paperwork, seals, badges, work orders** |
| Why is the lie sympathetic? | It isn't | **Because transit is expensive and the system is rigged** |
| What does the crew actually want? | To survive | **To deliver the cargo, keep the contract, and not be implicated** |

The last row is the important one. In the passing framing, **the crew has a reason to want the
illegal passenger gone that has nothing to do with fear** — liability. If the manifest is wrong at
dock, the whole crew is impounded. This makes the social pressure *institutional* rather than
monstrous, which is exactly the SIGNALIS register: cold, bureaucratic, and indifferent.

**What is retained from Among Us.** The kill, the vent, the sabotage, the body, the meeting, the
vote. The impostor still murders to stay hidden. The mechanics are untouched. Only the *reason*
changes — which changes every line of dialogue, every piece of evidence, and every NPC's motive.

---

## 2. The Fiction: Why Illegal Transit Is Cheap

The vessel runs under a **charter** — a corporate transit license that specifies crew complement,
roles, and cargo. Three economic facts produce the entire game:

1. **Chartered transit is priced per verified seat.** A legitimate berth costs more than a year of a
   technician's wage. Verification requires a clean record, a sponsor, and a physical examination.
2. **Verification is a bureaucracy, not a truth.** The manifest is a *database*, and databases can be
   edited. Badge seals can be re-stamped. Work orders can be forged. The ship trusts the paper.
3. **The penalty falls on the crew, not the stowaway.** An illegal passenger discovered at dock means
   the charter is voided, the cargo is impounded, and every crewmember's record is flagged. **The
   crew is incentivised to find the illegal passenger and dispose of them quietly before dock.**

That third fact is the engine of the whole game. It explains, in one stroke:
- why the crew investigates at all (self-interest, not heroism),
- why ejection is preferred to containment (quiet disposal, no paperwork),
- why the impostor kills (a witness at dock is a death sentence),
- why nobody calls for help (there is no help; there is only the charter).

### 2.1 The three populations aboard

| Population | Papers | Knows they're illegal | Behaviour |
|---|---|---|---|
| **Chartered crew** | Genuine | N/A | Wants the manifest clean at dock |
| **Illegal personnel** (impostors) | Forged or borrowed | Yes | Wants to reach dock undetected; kills to protect that |
| **True impostors** (§7, future) | Genuine-looking, but not human | Partially | Wants something else entirely — *not* the cargo |

The player is a chartered crewmember. The other nine are a mix; two are illegal personnel.

---

## 3. The Cover System (what an impostor actually is)

Every agent has a **cover** — a claimed identity with three independently verifiable components:

```
Cover = {
  role:      TECH | MEDIC | SECURITY | ENGINEER | QUARTERMASTER | NAVIGATOR | SANITATION
  clearance: A | B | C | D
  berth:     DECK_A | DECK_B | DECK_C | HOLD_LOWER | MED_WING
  work_orders: [task ids the cover claims responsibility for]
  seal:      a physical badge seal with a serial
}
```

### 3.1 Cover quality

An illegal passenger's cover has a **quality** value `q ∈ [0,1]` (default **0.55**), which sets the
probability that any given verification passes:

| Component | Genuine | Forged at q=0.55 | What a check sees on failure |
|---|---|---|---|
| Role | assigned | plausible adjacent role | **BADGE_MISMATCH** (role vs. work order) |
| Clearance | granted | one level too high | **BADGE_MISMATCH** |
| Berth | assigned | a berth already occupied | **MANIFEST_GAP** (double-booking) |
| Work orders | assigned | invented but coherent | **NO_WORK_ORDER** (id not in the ledger) |
| Seal | stamped | re-stamped | **SEAL_TAMPER** (serial discontinuity) |

**Design intent.** A forged cover should be *mostly* convincing. At q = 0.55, a single check has a
45% chance of producing nothing. Two independent checks on the same person produce evidence with
probability `1 − 0.55² ≈ 0.70`. This is what makes checks a *budget* rather than a win button.

### 3.2 Why the impostor is still dangerous

If the cover is mostly good, why kill? Because **the manifest is checkable, and the kills are not**:

- A body is discovered *after the fact*; a manifest check is discovered *immediately*.
- Killing a witness is the only way to stop a check from being reported.
- Sabotage creates the *time* to forge a correction into the ledger (see §4.3, "ledger writes").

So the kill is not the impostor's goal. It is the impostor's **editing tool**. That is a much
better motive than appetite, and it makes an impostor who kills *thoughtfully* legible to the player.

---

## 4. Verification Mechanics

Three surfaces, all physical, all requiring commitment (03's "information stations are places you must
stand in"):

### 4.1 Manifest Terminal (the bureaucracy)

Located in Admin and Security. Costs **4 seconds standing still** and is **visible to anyone in the
room** — using it is itself a social act ("why is she checking the manifest?").

```
MANIFEST TERMINAL
─────────────────
CREW COMPLEMENT ............ 10 / 10
  TECH ......... 4      SEALED
  MEDIC ........ 2      SEALED
  SECURITY ..... 1      SEALED
  ENGINEER ..... 2      SEALED
  QUARTERMASTER  1      SEALED
UNRESOLVED WORK ORDERS ..... 3
ANOMALIES .................. 1        ← ← ←
─────────────────
[ REQUEST PERSONNEL RECORD ]
```

Returns one of:
- `CLEAN` — this person's cover passes at current quality (no information about *guilt*)
- `ANOMALY(token)` — one of `BADGE_MISMATCH`, `MANIFEST_GAP`, `NO_WORK_ORDER`, `SEAL_TAMPER`
- `SEALED` — record requires clearance above the terminal's (a *different* kind of information)

**Budget:** 2 checks per round, 60s cooldown, and each check *publishes* that a check occurred.
Unlimited checks would collapse the game to a queue.

### 4.2 The Anomaly Counter (the pacing dial)

The "ANOMALIES: 1" line is the single most important piece of UI in the game. It says: *the manifest
is provably wrong, and the system knows it.* It does not say who.

- The count is **true** and **public** at the terminal.
- It is **not** available anywhere else — no HUD, no meeting screen.
- It rises when an impostor kills and uses a vent (physical evidence enters the ledger) and can be
  *lowered* by an impostor who performs a **ledger write** during a Comms sabotage.

This is the pacing engine the Director ([04](04_AI_ARCHITECTURE.md) §5) uses in place of arbitrary
pressure: the crew can *see* the anomaly count climb, which is dread with a number attached.

### 4.3 Ledger Writes (the impostor's counterplay)

During a **Comms sabotage** ([02](02_AMONG_US_CORE.md) §6.1), the manifest is offline. An impostor in
Admin or Security may spend a **ledger write** (one per match, per impostor) to:

| Write | Effect | Cost |
|---|---|---|
| **Backdate a work order** | Removes `NO_WORK_ORDER` from own cover | 1 write, 8s at terminal, audible |
| **Re-seat a berth** | Removes `MANIFEST_GAP` | 1 write |
| **Raise a false anomaly** | Adds an anomaly to a *crewmate's* record | 1 write, high risk |

The third is the social weapon and the reason the anomaly counter is not a solved problem: **a
number the crew trusts can be poisoned.** This is the direct descendant of Among Us's "frame"
dynamic, made systemic.

### 4.4 Challenge and Citation (the grammar's role)

Verification is not only mechanical. Most identity conflict happens **in the meeting**, through two
grammar types added in v0.2.0 (see [05](05_QUICKCHAT_GRAMMAR.md) §4a):

```
IDENTITY_CHALLENGE TARGET=Blue EVIDENCE=BADGE_MISMATCH     base Δ +0.45
MANIFEST_CITE      TARGET=Blue EVIDENCE=MANIFEST_GAP       base Δ +0.50
IDENTITY_CLAIM     ROLE=TECH CLEARANCE=C BERTH=DECK_B      base Δ −0.05 (self)
```

The grammar enforces that a challenge must cite a *legitimate identity token* — you cannot challenge
someone's papers because they were near a body. `qc_parse.py` rejects it:

```
$ python3 tools/qc_parse.py parse "IDENTITY_CHALLENGE TARGET=Blue EVIDENCE=VENT" --speaker Red
PARSE ERROR: IDENTITY_CHALLENGE may only cite ['BADGE_MISMATCH', 'SEAL_TAMPER',
             'NO_WORK_ORDER', 'MANIFEST_GAP'], got VENT
```

This is the mechanism that keeps the two evidence economies (guilt and paperwork) **separate but
interacting**. A crewmate can be cleared of murder and still be illegal. That is a genuinely new
social space, and it is the heart of this design.

---

## 5. The Four-Axis Suspicion Model (revision of 04 §7)

The original model had one axis: *is this person a killer?* That is now insufficient. The engine's
model (`engine/src/sim/suspicion.ts`) keeps the six-component `Suspicion` struct for **guilt**, and
adds three parallel ledgers:

```ts
interface IdentityRecord {
  paperRisk: number;      // 0..1  accumulated verified anomalies against this person
  clearanceClaims: number;// how many times they've re-stated their cover (inconsistency risk)
  ledgerDebt: number;     // anomalies they are known to have reported inaccurately
  challengedBy: Set<string>;
}
```

Four axes, each independently actionable:

| Axis | Question | Evidence source | Resolution |
|---|---|---|---|
| **Guilt** | Did they kill? | Bodies, vent sightings, alibis | Ejection |
| **Legality** | Are their papers real? | Manifest anomalies, seals | Ejection *or* quiet disposal |
| **Consistency** | Do their stories agree? | Meeting claims over rounds | Credibility decay |
| **Competence** | Can they do their claimed job? | Work-order completion, task speed | Soft (social) only |

**Why four axes and not one.** A single number makes the game a sorting problem. Four axes produce
the situation this design exists for: *"I'm certain Blue killed Yellow, and I'm also certain Blue's
badge is genuine — which means someone gave a real badge to a murderer, and that person is still
aboard."*

### 5.1 The interaction rule (the interesting failure)

```
if Guilt(Blue) high AND Legality(Blue) clean:
    → the crew suspects a *chartered* crewmate of supplying the cover
    → new investigation target: who has ledger write access?
if Legality(Blue) dirty AND Guilt(Blue) low:
    → Blue is illegal but not (yet) a killer
    → ejecting Blue may save the manifest and lose a useful worker
```

This second case is a **real strategic dilemma with no correct answer**, which is what the design
needs. It also means a clever impostor can be *honest about being illegal* and survive on usefulness —
a genuinely novel social move that the grammar supports (`ALIBI` + `TASK_CLAIM` + voluntary
`IDENTITY_CLAIM`).

---

## 6. Win Conditions (updated)

| Winner | Condition | Phase |
|---|---|---|
| **Crew — tasks** | All crewmate tasks complete | `GAME_OVER_CREW_TASK_WIN` |
| **Crew — ejection** | All illegal personnel ejected | `GAME_OVER_CREW_EJECT_WIN` |
| **Crew — clean manifest** | Every illegal passenger *identified* (anomaly on record), regardless of ejection | `GAME_OVER_CREW_CLEAN_MANIFEST` |
| **Impostor — parity** | `alive_illegal ≥ alive_chartered` | `GAME_OVER_IMPOSTOR_PARITY` |
| **Impostor — sabotage** | Crisis countdown expires | `GAME_OVER_IMPOSTOR_SABOTAGE` |
| **Impostor — dock** (implicit) | Ship reaches dock with `ANOMALIES == 0` and illegal personnel alive | resolved at dock, not a phase |

The **clean manifest** win is the new one, and it is a genuine design decision: it lets the crew win
*without* killing anyone, purely on paperwork. It rewards investigation over violence, and it gives
the manifest terminal a win condition of its own — which is how you make a bureaucracy feel like a
weapon.

`state_machine.json` v0.2.0 implements `MANIFEST_CHECK` as a sub-phase of `PLAY` and adds the
`GAME_OVER_CREW_CLEAN_MANIFEST` terminal. `validate_state.py` confirms all 12 phases are reachable
and no guard can reach two terminals from one phase.

---

## 7. True Impostors (forward design — NOT built)

> **Status: specified only.** No implementation, no data, no code path. This section exists so that
> the passing-impostor architecture does not accidentally foreclose it.

A **true impostor** is not a person with bad papers. It is something that has *learned to produce
papers*. It is the horror register of SIGNALIS made literal: a thing that understands the forms well
enough to pass as a form-filler.

### 7.1 Design constraints (what makes it not-a-monster-cliché)

1. **It does not want the cargo, the ship, or the crew.** It wants to reach dock. Its motive is
   *transit*, the same as every other illegal passenger — which makes it horrifyingly mundane.
2. **Its cover is better than a human's, not worse.** `q ≈ 0.85`. It has read the charter.
3. **Its failure mode is behavioural, not physical.** No glowing eyes. The tells are:
   - it never eats, sleeps, or uses the head (moodle absence, noticed only over many rounds),
   - it repeats a work order *exactly*, including an error, which a human would not,
   - its badge serial is a **valid** serial that has been issued twice (a clerical impossibility).
4. **It cannot be reasoned with in the meeting, and this is a mechanic, not flavour.** Its utterances
   are grammar-legal but *statistically* different: it never uses `DISAGREE` (a lie about a claim is
   still a claim about the world; it does not model other minds), and its `AGREE` targets are
   always the speaker with the highest credibility, regardless of content.
5. **It is not the default antagonist.** True impostors should be a *scenario modifier* (a charter
   route with a flagged cargo hold), not a role in every match — otherwise the identity theme
   collapses back into "find the monster".

### 7.2 What the architecture must preserve now (so this stays possible)

| Requirement | Where it is already satisfied |
|---|---|
| Identity must be a data structure, not a boolean | `Cover` (§3) is per-agent data |
| Evidence must come from a checkable ledger | Manifest terminal (§4.1) is a data query |
| Behavioural tells must be per-agent statistical anomalies | `Persona` vectors in [04](04_AI_ARCHITECTURE.md) §8 |
| Grammar must support "legal but wrong" speech | Truthfulness protocol in [05](05_QUICKCHAT_GRAMMAR.md) §6 |
| The crew must be able to win without combat | Clean-manifest win condition (§6) |

**Explicit non-goal:** no separate AI architecture for true impostors. They use the same GOAP planner,
the same sensor pipeline, and the same grammar — with different *persona weights* and a different
`Cover` generator. If it needs a new subsystem, the design has failed.

---

## 8. Mechanical Consequences (what changes in the existing docs)

| Doc | Change | Status |
|---|---|---|
| [02](02_AMONG_US_CORE.md) §8 | `MANIFEST_CHECK` sub-phase added; clean-manifest terminal | done in `state_machine.json` v0.2.0 |
| [03](03_HYBRID_MECHANICS.md) §5 | Manifest terminal added to the station list | done in §4.1 here |
| [04](04_AI_ARCHITECTURE.md) §7 | Suspicion gains identity ledgers; `FRAME` gains "raise false anomaly" | done in `suspicion.ts`, §5 here |
| [05](05_QUICKCHAT_GRAMMAR.md) | +3 utterance types (18 total), +4 evidence tokens | done in grammar v0.2.0 |
| [06](06_IDENTITY_AND_PASSING.md) §7 | Forward design | this doc, §7 |

### 8.1 Balance impact and how it is measured

Adding identity checks *helps the crew* (more evidence) and *helps the impostor* (more ways to
misdirect). The net effect is unknown and must not be guessed:

- `check_rules.py` guarantees the engine and tooling agree on the numbers.
- `sim_headless.py guard` must stay in `[0.30, 0.60]` crew win.
- The identity layer's effect is modelled as a **third dial** in the Phase 3 sim: `manifest_checks`
  per round (0–3). Target: the crew win rate should move by **no more than ±0.08** when checks go
  from 0 to 2 — evidence should *inform* the social layer, not replace it.

**If identity checks push crew win rate above 0.60, the design has failed** — it means paperwork is
solving the game, and the social layer is decorative again.

---

## 9. Open Questions (logged, not hidden)

| # | Question | Current decision | Revisit when |
|---|---|---|---|
| Q1 | Can a crewmate lie about their own cover? | **Yes** — everyone has *some* reason to shade their record. Crew lies are limited to `IDENTITY_CLAIM` and are grounded (they must believe their own claim). | If crew lying makes the manifest unusable |
| Q2 | Is a clean-manifest win too easy with 10 players and 2 checks/round? | Open. Leaning toward checks costing *task time*, so investigating has an opportunity cost. | First sim with the identity dial |
| Q3 | Does the impostor's ledger write need to be louder? | Yes, probably. It is currently 8s at a terminal with no unique sound. | Audio pass |
| Q4 | Should the anomaly counter ever lie *without* a ledger write? | **No.** The counter is ground truth except when explicitly poisoned. Otherwise it is flavour. | Never |
| Q5 | True impostors as a role or a scenario? | **Scenario.** A role would make every match about monsters. | Playtest of §7 |

---

## 10. Summary — the five load-bearing rules

1. **An impostor is a person with someone else's papers.** Never a species.
2. **The manifest is the ship's only witness, and the ship is indifferent.** Verification is
   bureaucratic, checkable, and budgeted.
3. **Killing is editing.** The impostor kills to remove witnesses to a ledger problem, not from
   appetite. Murder is a tool for maintaining a story.
4. **Guilt and legality are separate axes.** A murderer can have genuine papers; an illegal passenger
   can be innocent of murder. Both are problems, and they are not the same problem.
5. **The crew wins by paperwork as readily as by violence.** The clean-manifest ending is the point:
   in a corporate dystopia, the form is the weapon.
