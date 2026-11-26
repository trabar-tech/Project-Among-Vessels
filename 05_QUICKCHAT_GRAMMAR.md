# 05 — Quick-Chat Grammar

**Project Among Vessels** · Phase 2 research deliverable · Status: **specified**
Canonical data: [`tools/data/quickchat_grammar.json`](tools/data/quickchat_grammar.json) — **if this doc and the JSON disagree, the JSON wins**
Executable spec: [`tools/qc_parse.py`](tools/qc_parse.py) · Requires: [04_AI_ARCHITECTURE.md](04_AI_ARCHITECTURE.md) §7

> A closed, formal language for NPC testimony. **18 utterance types, 11 vocabularies**, one parse
> function, deterministic suspicion math. **No free-form LLM text is generated during gameplay** — ever.
>
> *v0.2.0 addition:* three identity types (`IDENTITY_CLAIM`, `IDENTITY_CHALLENGE`, `MANIFEST_CITE`)
> and four evidence tokens (`BADGE_MISMATCH`, `MANIFEST_GAP`, `NO_WORK_ORDER`, `SEAL_TAMPER`), because
> an impostor is a person with someone else's papers — see [06_IDENTITY_AND_PASSING.md](06_IDENTITY_AND_PASSING.md).

---

## 1. Why a Formal Language (and not chat)

Among Us's Quick-Chat exists for moderation: it restricts players to pre-set phrases. That constraint
turns out to be an *engineering gift*. A closed grammar gives us four properties that free text cannot:

| Property | Consequence |
|---|---|
| **Parseability** | Every statement becomes a structure, not a string. "Blue vented" is `{type: VENT_SIGHTING, target: Blue, location: Electrical}` |
| **Auditability** | We can prove a bot never states a fact it did not observe. A regex over transcripts is a real test |
| **Determinism** | Same belief state → same utterance. Replays reproduce exactly. Balance is measurable |
| **Balanceability** | Suspicion weights are *data*, tunable in one JSON file, measurable in the sim |

The alternative — letting an LLM improvise NPC dialogue — buys surface variety and costs every one of
those properties. It also makes the game unfalsifiable: you cannot test what you cannot parse. This
document is the substitute for that temptation.

**Where language-model-style flexibility survives:** in *policy*, not *generation*. Which of the 15
types an NPC picks, whom they target, how strongly they phrase it, whether they stay silent — that is
where character lives. The vocabulary is small; the *choices* over it are vast.

---

## 2. Grammar

### 2.1 Surface form

```
utterance  ::= TYPE ( WS slot )*
slot       ::= KEY "=" VALUE
TYPE       ::= one of the 15 utterance types (§4)
KEY        ::= one of the slots legal for TYPE
VALUE      ::= member of the vocabulary bound to KEY, or a player name for TARGET
WS         ::= one or more spaces
```

`SPEAKER` is **not** a slot. It is the channel — supplied by the meeting system, exactly as a voice is
distinct from what is said. This prevents the type of forgery where an NPC claims to be someone else.

**Examples (all valid):**

```
REPORT_BODY LOCATION=Electrical TIME=JUST_NOW
ACCUSE TARGET=Blue EVIDENCE=VENT
ALIBI LOCATION=MedBay TIME=EARLIER TARGET=Green
VENT_SIGHTING TARGET=Blue LOCATION=Electrical
TASK_CLAIM TASKS=FixWiring LOCATION=Electrical STATUS=DONE
SUSPICION TARGET=Pink STRENGTH=STRONG
QUESTION TARGET=Green TOPIC=WHERE
VOTE_INTENT TARGET=Blue
VOTE_INTENT
```

### 2.2 EBNF (full)

```ebnf
meeting        ::= turn+
turn           ::= speaker ":" utterance
speaker        ::= PLAYER_NAME
utterance      ::= report | accuse | defend | alibi | task_claim | suspicion
                 | vent | sabotage_witness | kill_witness | clear
                 | vote_intent | agree | disagree | question | emergency

report         ::= "REPORT_BODY"      "LOCATION=" LOCATION [ "TIME=" TIME ]
accuse         ::= "ACCUSE"           "TARGET=" PLAYER_NAME "EVIDENCE=" EVIDENCE
defend         ::= "DEFEND"           "TARGET=" PLAYER_NAME [ "EVIDENCE=" EVIDENCE ]
alibi          ::= "ALIBI"            "LOCATION=" LOCATION "TIME=" TIME [ "TARGET=" PLAYER_NAME ]
task_claim     ::= "TASK_CLAIM"       "TASKS=" TASK "LOCATION=" LOCATION "STATUS=" STATUS
suspicion      ::= "SUSPICION"        "TARGET=" PLAYER_NAME "STRENGTH=" STRENGTH
vent           ::= "VENT_SIGHTING"    "TARGET=" PLAYER_NAME "LOCATION=" LOCATION
sabotage_witness ::= "SABOTAGE_WITNESS" "SABOTAGE=" SABOTAGE "LOCATION=" LOCATION [ "TARGET=" PLAYER_NAME ]
kill_witness   ::= "KILL_WITNESS"     "TARGET=" PLAYER_NAME "LOCATION=" LOCATION
clear          ::= "CLEAR"            "TARGET=" PLAYER_NAME "EVIDENCE=" EVIDENCE
vote_intent    ::= "VOTE_INTENT"      [ "TARGET=" PLAYER_NAME ]
agree          ::= "AGREE"            "TARGET=" PLAYER_NAME
disagree       ::= "DISAGREE"         "TARGET=" PLAYER_NAME
question       ::= "QUESTION"         "TARGET=" PLAYER_NAME "TOPIC=" TOPIC
emergency      ::= "EMERGENCY_CALL"   [ "EVIDENCE=" EVIDENCE ]

LOCATION   ::= Cafeteria | Electrical | MedBay | Reactor | O2 | Admin | Security
             | Storage | UpperEngine | LowerEngine | Navigation | Shields
             | Weapons | Corridor
EVIDENCE   ::= VENT | BODY_NEAR | TASK_FAKE | SABOTAGE_NEAR | SEEN_NEAR_BODY
             | NO_ALIBI | INCONSISTENT_STORY | VISUAL_TASK | CAMERA | DOORLOG | NONE
TIME       ::= JUST_NOW | EARLIER | LAST_ROUND | UNKNOWN
STRENGTH   ::= MILD | STRONG
STATUS     ::= DONE | DOING | NOT_DONE
TOPIC      ::= WHERE | WHO | WAS | TASK
SABOTAGE   ::= LIGHTS | REACTOR | O2 | COMMS | DOORS
TASK       ::= FixWiring | SwipeCard | ClearAsteroids | SubmitScan | FuelEngines
             | InspectSample | StartReactor | UploadData | PrimeShields
             | StabilizeSteering | CalibrateDistributor | CleanO2Filter
             | UnlockManifolds | AlignEngineOutput | EmptyGarbage
```

### 2.3 Structural constraints

| Constraint | Value | Source |
|---|---|---|
| `SPEAKER ≠ TARGET` | true | Grammar file `constraints.speaker_ne_target` |
| Max utterances per speaker per meeting | 3 | `max_utterances_per_meeting_per_speaker` |
| Minimum gap between a speaker's utterances | 5s | `meeting_cooldown_seconds` |
| `AGREE` amplifies the referenced claim by | ×1.25 | `agree_amplifier` |
| `DISAGREE` dampens the referenced claim by | ×0.5 | `disagree_dampener` |
| False/contradicted claim penalty multiplier | ×2.0 | `lie_penalty_multiplier` |

**Why 3 utterances max.** A speaker who can say unlimited things can flood the meeting and dominate
suspicion by volume. Three is enough for "report + accuse + defend", and forces *prioritisation* —
which is the strategic content of a meeting.

---

## 2a. Identity Types (v0.2.0)

The passing-impostor reframing ([06](06_IDENTITY_AND_PASSING.md)) adds a second evidence economy:
**paperwork**. It must not be mixed with the guilt economy, and the grammar enforces that separation
at parse time.

| Type | Slots | Semantic tag | Base Δ | Restriction |
|---|---|---|---|---|
| `IDENTITY_CLAIM` | ROLE (req), CLEARANCE, BERTH | `CLAIM:COVER(self)` | −0.05 to self | Must match the speaker's cover record |
| `IDENTITY_CHALLENGE` | TARGET, EVIDENCE (req) | `CLAIM:ILLEGAL(target)` | +0.45 | EVIDENCE ∈ {`BADGE_MISMATCH`, `SEAL_TAMPER`, `NO_WORK_ORDER`, `MANIFEST_GAP`} |
| `MANIFEST_CITE` | TARGET, EVIDENCE (req) | `CLAIM:RECORD_CONTRADICTS(target)` | +0.50 | EVIDENCE ∈ {`MANIFEST_GAP`, `NO_WORK_ORDER`, `BADGE_MISMATCH`} |

**The restriction is the design.** You cannot challenge someone's papers because they were standing
near a body — that is guilt evidence, and it lives in a different ledger. The parser refuses:

```
$ python3 tools/qc_parse.py parse "IDENTITY_CHALLENGE TARGET=Blue EVIDENCE=VENT" --speaker Red
PARSE ERROR: IDENTITY_CHALLENGE may only cite ['BADGE_MISMATCH', 'SEAL_TAMPER',
             'NO_WORK_ORDER', 'MANIFEST_GAP'], got VENT
```

**Why this matters mechanically.** It produces the situation the whole design exists for: a crewmate
can be *proven* a murderer and *simultaneously* hold genuine papers — which means someone with ledger
access supplied them, and the investigation is not over. Two economies, one meeting.

### 2b. Updated base-delta ranking (all 18 types)

| Rank | Type | Δ |
|---|---|---|
| 1 | `KILL_WITNESS` | +0.90 |
| 2 | `VENT_SIGHTING` | +0.85 |
| 3 | `MANIFEST_CITE` | **+0.50** |
| 4 | `IDENTITY_CHALLENGE` | **+0.45** |
| 5 | `ACCUSE` | +0.30 |
| 6 | `SABOTAGE_WITNESS` | +0.25 |
| 7 | `SUSPICION` (MILD / STRONG) | +0.20 / +0.35 |
| 8 | `CLEAR` | −0.40 |
| 9 | `ALIBI` | −0.15 |
| 10 | `DEFEND` | −0.10 |
| 11 | `IDENTITY_CLAIM` | **−0.05** |

Note the ordering: **paperwork outranks hearsay but never outranks an eyewitness.** A manifest
anomaly is stronger evidence than an accusation, weaker than seeing a kill — which is the correct
epistemic hierarchy for a bureaucracy that can be poisoned.

---

## 3. Syntax Trees and Semantic Tags

Each utterance parses to a node with a **semantic tag** that the suspicion engine consumes. Tags are
what keep the system honest: a tag declares *what kind of knowledge* the utterance actually asserts.

| # | Type | Required slots | Optional | Semantic tag(s) | Base Δ to target |
|---|---|---|---|---|---|
| 1 | `REPORT_BODY` | LOCATION | TIME | `EVENT:BODY@ROOM` | 0.0 |
| 2 | `ACCUSE` | TARGET, EVIDENCE | — | `CLAIM:GUILT(target)`, `EVIDENCE:<token>` | **+0.30** |
| 3 | `DEFEND` | TARGET | EVIDENCE | `CLAIM:INNOCENCE(target)` | **−0.10** |
| 4 | `ALIBI` | LOCATION, TIME | TARGET | `CLAIM:PRESENCE(self@ROOM)`, `WITNESS?` | **−0.15** (to self) |
| 5 | `TASK_CLAIM` | TASKS, LOCATION, STATUS | — | `CLAIM:TASK(task@ROOM,status)` | 0.0 |
| 6 | `SUSPICION` | TARGET, STRENGTH | — | `CLAIM:DOUBT(target)`, `STRENGTH` | +0.20 (MILD) / **+0.35** (STRONG) |
| 7 | `VENT_SIGHTING` | TARGET, LOCATION | — | `OBS:VENT(target)`, `HIGH_CONFIDENCE` | **+0.85** |
| 8 | `SABOTAGE_WITNESS` | SABOTAGE, LOCATION | TARGET | `OBS:SABOTAGE`, `LINK?(target)` | +0.25 |
| 9 | `KILL_WITNESS` | TARGET, LOCATION | — | `OBS:KILL(target)`, `MAX_CONFIDENCE` | **+0.90** |
| 10 | `CLEAR` | TARGET, EVIDENCE | — | `CLAIM:INNOCENCE(target)`, `VERIFIABLE` | **−0.40** |
| 11 | `VOTE_INTENT` | — | TARGET | `INTENT:VOTE(target\|skip)` | 0.0 |
| 12 | `AGREE` | TARGET | — | `META:ENDORSE(claim)` | 0.0 (amplifies ×1.25) |
| 13 | `DISAGREE` | TARGET | — | `META:REJECT(claim)` | 0.0 (dampens ×0.5) |
| 14 | `QUESTION` | TARGET, TOPIC | — | `META:PROMPT(target,topic)` | 0.0 |
| 15 | `EMERGENCY_CALL` | — | EVIDENCE | `ACTION:CONVENE` | 0.0 |

### 3.1 Worked syntax tree

Input: `ACCUSE TARGET=Blue EVIDENCE=VENT` from speaker `Red`

```
Utterance
├── type: ACCUSE
├── speaker: Red                       [channel, not a slot]
├── slots
│   ├── TARGET: Blue                   [entity ref → agent_id]
│   └── EVIDENCE: VENT                 [evidence token → weight table]
├── tag: CLAIM:GUILT(Blue)
├── tag: EVIDENCE:VENT
└── delta: { target: Blue, value: +0.30 }
```

After listener-side modulation (§5), a *typical* listener applies
`0.30 × credibility(Red) × 0.55 × min(0.35, strength) ≈ 0.02–0.06` — deliberately small. **A single
accusation must never be enough.** Corroboration, first-hand observation, and consistency across
meetings are what move a vote.

### 3.2 Tag taxonomy (closed set)

```
OBS:*        first-hand observation asserted by the speaker  (highest value, easily falsified)
CLAIM:*      assertion about the world or a person            (modulated by speaker credibility)
INTENT:*     declared future action                           (informational only)
META:*       statement about another statement                (modifies, does not add evidence)
ACTION:*     procedural request (convene, vote)               (no suspicion effect)
EVENT:*      neutral world event                              (no suspicion effect)
```

`META` tags are what make meetings feel like conversations rather than a list of accusations. They
cannot create suspicion on their own — they only scale what already exists.

---

## 4. The Fifteen Utterance Types in Detail

### 1. `REPORT_BODY` — the opener
`Red: found a body in Electrical (JUST_NOW)`
Neutral on suspicion, but *load-bearing*: it establishes room and time, which every later claim is
checked against. **A reporter who gives a vague or contradictory location is immediately suspect** —
not because the grammar penalises them, but because consistency checking does (§5.2).

### 2. `ACCUSE` — the main weapon
`Red: accuses Blue: VENT`
Requires an evidence token. **No evidence, no accusation** — this is a grammar-level ban on
"vibes-based" hostility, and it forces NPCs to articulate *why*, which is what makes their reasoning
inspectable by the player.

### 3. `DEFEND` — social cover
`Red: defends Blue (VISUAL_TASK)`
Cheap to say, and slightly costly to be wrong about. Defending an impostor links you to them.

### 4. `ALIBI` — presence assertion
`Red: was in MedBay at EARLIER with Green`
Claims self-presence, optionally witnessed. **The single most falsifiable utterance type**, and
therefore the most useful to an impostor *and* the most dangerous. If the claimed witness contradicts
it (`DISAGREE` from that witness), the claimant takes a ×2.0 credibility penalty.

### 5. `TASK_CLAIM` — verifiable progress
`Red: claims FixWiring in Electrical is DONE`
Checkable against (a) the shared task bar at the next meeting, (b) whether the station's visual state
changed, (c) whether anyone saw them there. A task claim that cannot be true (task not assigned) is
near-conclusive evidence of impostor status — and yes, NPCs check.

### 6. `SUSPICION` — low-commitment doubt
`Red: is suspicious of Pink (STRONG)`
The polite version of an accusation: no evidence token required, lower weight, no credibility
backfire on being wrong. Used by cautious personas and by impostors probing the room.

### 7. `VENT_SIGHTING` — near-conclusive
`Red: saw Blue vent in Electrical`
Highest-value non-kill evidence. In a game with no Engineer role (our v1), venting has **no innocent
explanation**, so this should end the game. It is rare by design: vents are loud
([03](03_HYBRID_MECHANICS.md) §3.2), and impostors avoid venting near witnesses.

### 8. `SABOTAGE_WITNESS` — directional evidence
`Red: witnessed LIGHTS sabotage in Electrical near Cyan`
Sabotages are physically performed, so they can be witnessed. The optional `TARGET` makes it a
soft accusation; the `LOCATION` makes it checkable against who could plausibly have been there.

### 9. `KILL_WITNESS` — the confession moment
`Red: saw Blue kill in Storage`
Maximum weight (+0.90). Note what this *does not* do: it does not end the game. The room still has to
believe Red, and an impostor who kills the witness's credibility first can survive a kill sighting.
That is the best possible dramatic beat, and the grammar supports it.

### 10. `CLEAR` — the alibi economy's currency
`Red: clears Green: VISUAL_TASK`
Strong negative weight (−0.40) because it is *verifiable in principle*. Falsely clearing someone is
punished at ×2.0. This is how the crew builds a trusted core — and how a bold impostor buys a friend.

### 11. `VOTE_INTENT` — the commitment
`Red: will vote Blue` / `Red: will vote nobody` (skip)
No suspicion effect, but *social* effect: declared intent lets others coordinate, and lets the player
read the room. An impostor declaring a vote for a crewmate who then gets ejected has created a paper
trail for the next meeting.

### 12–13. `AGREE` / `DISAGREE` — meta modifiers
`Red: agrees with Green` / `Red: disagrees with Pink`
These do not add evidence; they *scale* the referenced claim (×1.25 / ×0.5). This produces the
"pile-on" and "pushback" dynamics that make meetings feel alive, without letting bots manufacture
suspicion from nothing.

### 14. `QUESTION` — the information pump
`Red: asks Green: WHERE?`
No direct effect, but it *obligates a response* (the meeting scheduler guarantees the target speaks
next if they have utterances left). Questions are how a smart crew forces an impostor to commit to a
story early, when it has less time to construct one.

### 15. `EMERGENCY_CALL` — procedural
`Red: calls an emergency meeting (NO_ALIBI)`
Costs one of the caller's emergency meetings. Calling with no evidence raises suspicion slightly on
the caller (implemented as `credibility_debt` in the belief model, not as a grammar delta).

---

## 5. Suspicion Mathematics

### 5.1 Listener-side update

For a claim by `S` about `T` with base delta `Δ`:

```
credibility(S)  = clamp(1 − Suspicion(listener, S), 0.05, 1.0)
consistency     = +1.25 if claim matches listener's first-hand observation
                = ×0.50 if claim contradicts listener's first-hand observation
                = 1.0  otherwise
modulation      = Δ × credibility(S) × consistency × propagation(0.55)
new_suspicion   = clamp(Suspicion(listener, T) + modulation, 0, 1)
```

Two properties fall out of this formula, both intended:

1. **A distrusted speaker's accusations backfire.** Because `credibility(S)` collapses as
   `Suspicion(listener, S)` rises, a caught liar accusing someone *increases* suspicion on themselves
   through the `AGREE`-less path (listeners tag the behaviour as `INCONSISTENT_STORY`).
2. **Consistency dominates volume.** One claim that matches what a listener saw outweighs five that
   do not. Spam-accusing is strictly worse than one well-timed, well-evidenced claim.

### 5.2 Consistency checking (the deduction engine)

At meeting open, every listener reconciles the claim stream against its own memory:

| Check | Detection | Effect |
|---|---|---|
| **Presence conflict** | `ALIBI(LOCATION=X)` vs. first-hand `SawAgent(S, Y)` at overlapping time | +0.7 `credibility_debt` on S |
| **Task impossibility** | `TASK_CLAIM` for a task not assigned to S | +0.8 `credibility_debt` (near-conclusive) |
| **Witness contradiction** | `ALIBI(witness=W)` followed by `DISAGREE` from W | +0.7 `credibility_debt`, and S's later claims ×0.4 |
| **Body proximity** | `REPORT_BODY(LOCATION=X)` from someone seen leaving X | +0.6 `proximity_to_body` |
| **Crisis absence** | Claimed to be fixing crisis but crisis station had 2 required actors and only 1 present | +0.5 `presence_anomaly` |
| **Silence pattern** | No utterance across 2+ meetings while others speak | +0.15 `behavioural_tell` (persona-weighted) |

**This table is the game's deduction.** It is finite, documented, and testable — which is precisely
what an LLM-driven chat system could never offer.

### 5.3 Voting from suspicion

```
vote_target(listener) = argmax_T Suspicion(listener, T)   if max ≥ vote_confidence
                      = SKIP                              otherwise
```

`vote_confidence` default 0.42. Raising it makes crews more cautious (more skips, fewer mis-ejections,
impostors win more); lowering it makes crews trigger-happy. It is the single most powerful balance
dial in the social layer and is sweep-tested in `sim_headless.py sweep`.

---

## 6. Truthfulness Protocol (anti-hallucination, enforced in code)

Every utterance carries an implicit **grounding requirement**:

| Type | Grounding requirement | Violation handling |
|---|---|---|
| `VENT_SIGHTING`, `KILL_WITNESS`, `SABOTAGE_WITNESS` | Speaker must hold a matching first-hand `Observation` | Crewmate: **rejected at generation time** (bug). Impostor: allowed, flagged `LIE`, recorded in audit log |
| `ACCUSE`, `CLEAR`, `SUSPICION` | Speaker must hold *some* belief above threshold, or be an impostor | Crewmate: rejected. Impostor: allowed with lie flag |
| `ALIBI` | Speaker must be able to *construct* a plausible story from own observation | Crewmate: must be true. Impostor: may be false, must not contradict its own earlier lies (checked against its own claim history) |
| `TASK_CLAIM` | Crewmate: task must actually be in that state. Impostor: must claim a task that plausibly exists | Rejected if impossible |
| `REPORT_BODY`, `EMERGENCY_CALL`, `VOTE_INTENT`, `AGREE`, `DISAGREE`, `QUESTION` | No grounding needed | — |

**Consequence:** a crewmate bot is *physically incapable* of lying. Not "discouraged" — incapable. The
generation function raises on violation. Impostors get the only `may_lie=True` path, and every lie is
logged with a reason, which makes the sim's eject-accuracy metric meaningful.

**Self-consistency for impostors.** An impostor maintains `claim_history` and may not contradict its
own past statements unless it pays `credibility_debt` deliberately. This prevents the degenerate
"random liar" that would make impostors trivially detectable *and* trivially boring.

---

## 7. Meeting Orchestration (how utterances are chosen)

```
for each living agent (in evidence-strength order):
    intent = None
    if self_suspicion > 0.45:        intent = DEFEND or ALIBI        # protect
    elif top_suspicion ≥ 0.55:       intent = ACCUSE (with best evidence token)
    elif top_suspicion ≥ 0.30:       intent = SUSPICION
    elif has_verifiable_good:        intent = CLEAR or TASK_CLAIM    # build credit
    elif asked a question:           intent = direct answer
    else:                            intent = QUESTION or silence

    emit(intent)                       # ≤3 utterances, ≥5s apart
    emit(AGREE/DISAGREE) if another strong claim landed
```

Speaker order is by **evidence strength descending**, which produces the natural rhythm of a real
meeting: the strongest claim lands first, the room reacts, weaker claims are built in its shadow.

**Silence is a move.** An agent with nothing to say says nothing, and other agents notice
(`silence pattern` in §5.2). The player learns that the quiet one is either innocent or very good.

---

## 8. Worked Meeting Transcript

Ten players: Red, Blue, Green, Pink, Yellow, Cyan, Purple, White, Black, Brown.
Impostors (hidden): **Blue** and **Purple**. Body of Yellow found in Electrical.

```
[meeting opens, body: Yellow @ Electrical]

Red     REPORT_BODY LOCATION=Electrical TIME=JUST_NOW
        ACCUSE TARGET=Blue EVIDENCE=SEEN_NEAR_BODY
        "found a body in Electrical (JUST_NOW). accuses Blue: SEEN_NEAR_BODY."

Blue    ALIBI LOCATION=MedBay TIME=JUST_NOW
        DEFEND TARGET=Blue EVIDENCE=VISUAL_TASK
        "was in MedBay at JUST_NOW. defends Blue (VISUAL_TASK)."
        # BLUE IS LYING. It was in Electrical. It risks the alibi because
        # the MedBay scanner is a plausible place to have been seen.

Green   QUESTION TARGET=Blue TOPIC=WAS
        "asks Blue: WAS?"                       # forces Blue to commit further

Blue    ALIBI LOCATION=MedBay TIME=JUST_NOW TARGET=Pink
        "was in MedBay at JUST_NOW with Pink."   # BLUE ESCALATES THE LIE

Pink    DISAGREE TARGET=Blue
        "disagrees with Blue."                   # Pink was nowhere near MedBay
        # → consistency check fires: witness contradiction, Blue +0.7 debt

Cyan    SUSPICION TARGET=Blue STRENGTH=STRONG
        "is suspicious of Blue (STRONG)."

Purple  DEFEND TARGET=Blue EVIDENCE=NONE
        "defends Blue (NONE)."                   # THE PARTNER OVERPLAYS
        # → Purple now linked to Blue; if Blue falls, Purple inherits suspicion

White   AGREE TARGET=Red
        "agrees with Red."                       # amplifies Red's accusation ×1.25

[vote]
Red     VOTE_INTENT TARGET=Blue
Pink    VOTE_INTENT TARGET=Blue
Cyan    VOTE_INTENT TARGET=Blue
White   VOTE_INTENT TARGET=Blue
Purple  VOTE_INTENT TARGET=Blue                  # BUS PROTOCOL: votes with the crowd
Brown   VOTE_INTENT                              # skip — not confident
Black   VOTE_INTENT TARGET=Blue

[Blue ejected — was an impostor]
```

**What this transcript demonstrates:**
1. Red had real evidence and opened strong (evidence-strength ordering).
2. Blue lied plausibly but *escalated* under a `QUESTION` — the grammar's information pump worked.
3. Pink's `DISAGREE` was cheap to say and decisive, because the consistency check fired.
4. Purple's `DEFEND` with `EVIDENCE=NONE` was a **grammar-legal mistake** — the token is a slot
   default, and defending with nothing is a readable tell.
5. Brown skipped, correctly, with insufficient confidence — abstention is modelled.
6. Purple's bus-protocol vote preserved its cover. It will survive to the next meeting.

None of this is generated text. Every line is a parsed structure with a documented weight, and
`qc_parse.py` can validate the whole transcript.

---

## 9. Validation and Testing

```bash
# Grammar self-consistency (vocabularies, templates, slot legality)
python3 tools/qc_parse.py validate

# Parse a single line into an AST + delta
python3 tools/qc_parse.py parse "VENT_SIGHTING TARGET=Blue LOCATION=Electrical" --speaker Red

# Fuzz: generate 300 structurally valid utterances, re-parse all of them
python3 tools/qc_parse.py fuzz --count 300 --seed 5
```

**Test properties that must hold** (see [01](01_DEV_TOOLS.md) §5):

| Property | Why it matters |
|---|---|
| Every generated utterance parses | No NPC can emit an illegal line |
| Unknown types / bad vocabularies / missing required slots are rejected | Grammar is actually closed |
| `SPEAKER ≠ TARGET` | No self-accusation loophole |
| Optional slots render without crashing | `VOTE_INTENT` (skip) must be a first-class citizen |
| Grammar file validates with zero problems | Doc/tool drift is caught in CI |

---

## 10. Extension Path (specified, not built)

The grammar is deliberately frozen at 15 types for v1. If v2 needs more, the rules are:

1. **New types must reuse existing vocabularies.** A new vocabulary is a new content burden on every
   room, task, and NPC.
2. **New types must not exceed +0.90 base delta.** `KILL_WITNESS` is the ceiling; nothing should be
   more conclusive than an eyewitness to murder.
3. **Any new type must have a falsification path** — something the listener can check. Unfalsifiable
   statements are noise, and noise is what we replaced.
4. **Any new type must be measurable** in the headless sim before shipping, or it is not real.

Candidate v2 types that satisfy all four: `DOOR_SIGHTING` (who used a locked door), `VITALS_READ`
(someone was dead on the board before the body was found), `INVENTORY_SEEN` (carrying a body bag).

---

## 11. Summary

| Principle | Implementation |
|---|---|
| Closed vocabulary, no free text | 15 types, 8 vocabularies, one JSON file |
| Parseable, therefore testable | `qc_parse.py` is the executable spec |
| Machine-groundable | Crewmates cannot lie; impostors' lies are flagged and logged |
| Deterministic | Same belief state → same utterance; replays reproduce |
| Personality in policy, not prose | Personas weight the same 15 choices differently |
| Balanced by data, not opinion | Base deltas + credibility + consistency, all in JSON, all sim-tested |
| Falsifiable statements only | Every claim has a check the listener can run |

---

## Appendix A — Sources consulted

- Among Us Quick-Chat as a restricted phrase system (categories such as location, suspicion, tasks;
  phrases like "Where?", "Sus", "Who?", "Skip"): <https://lionadegames.com/what-is-quick-chat-in-among-us/>
- Quick-Chat vs. free chat, and why lobbies split by chat mode:
  <https://www.wikihow.com/Turn-Off-Quick-Chat-in-Among-US>
- Community examples of the constrained phrase set ("[Player] can't be imposter", "[Player] is very
  suspicious"): <https://www.reddit.com/r/AmongUs/comments/1fzbale/quick_chat/>

**Design inversion.** The reference system uses a closed vocabulary for *moderation*. We keep the
closure and discard the moderation motive: closure buys parseability, auditability, determinism, and
balanceability — the four properties that make NPC social reasoning an engineering problem instead of
an NLP problem. The vocabulary is smaller than the reference's (15 types) precisely because each type
must carry a testable semantic tag.
