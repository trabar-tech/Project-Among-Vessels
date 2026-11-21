/**
 * core/bus.js
 * Topic-declared event bus.
 *
 * Contract (PROJECT_BRAIN.md 2.4):
 *   - The bus carries FACTS and INTENTS only. It never returns values.
 *   - Every topic must be declared here before use; undeclared emits throw in
 *     dev so a typo can never silently swallow an event.
 *   - Payloads must be plain, JSON-able objects.
 */

export const TOPICS = new Set([
  // power
  'power:circuit',
  'power:flicker',
  // doors
  'door:state',
  'door:pry',
  // interaction
  'interact:hover',
  'interact:used',
  // player
  'player:room',
  'player:footstep',
  'player:flashlight',
  'player:respawn',
  // ui / audio
  'ui:prompt',
  'audio:cue',
  // lifecycle
  'game:ready',
  'game:error',
  'debug:stats',
  // reserved for later milestones (declared so sensors can be written now)
  'npc:memory',
  'npc:speak',
  'meeting:open',
  'meeting:vote',
  'agenda:assigned',
  'ship:jump',
  'run:end',
]);

const HISTORY_LIMIT = 200;

export class Bus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    /** @type {Array<{topic:string, payload:any, t:number}>} */
    this.history = [];
    this.debug = false;
  }

  on(topic, fn) {
    this.#assert(topic);
    let set = this.listeners.get(topic);
    if (!set) this.listeners.set(topic, (set = new Set()));
    set.add(fn);
    return () => this.off(topic, fn);
  }

  once(topic, fn) {
    const off = this.on(topic, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(topic, fn) {
    this.listeners.get(topic)?.delete(fn);
  }

  emit(topic, payload = {}) {
    this.#assert(topic);
    this.history.push({ topic, payload, t: performance.now() });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    if (this.debug) console.debug(`[bus] ${topic}`, payload);

    const set = this.listeners.get(topic);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        // A listener bug must not take down the frame.
        console.error(`[bus] listener for "${topic}" threw:`, err);
      }
    }
  }

  #assert(topic) {
    if (!TOPICS.has(topic)) {
      throw new Error(
        `[bus] undeclared topic "${topic}". Add it to TOPICS and document it in PROJECT_BRAIN.md 2.4.`
      );
    }
  }
}

export const bus = new Bus();
