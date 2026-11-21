/**
 * world/blueprint.js
 * The ship as data. Edit this file to change the layout; no geometry here.
 *
 * Units: `rect` and door spans are in CELLS (see CONFIG.CELL = 2 m).
 * Everything with an `at` field is in WORLD METRES, so props and fixtures can be
 * nudged sub-cell without fighting the grid.
 *
 * Layout (cells, +Z aft):
 *
 *        z=-4  ┌──────────────┐
 *              │    BRIDGE    │
 *        z= 0  └──────┬───────┘
 *                     │
 *          MEDBAY     │  CORRIDOR      REACTOR
 *        ┌────────┐   │            ┌──────────────┐
 *        │        │   │            │              │
 *        └────────┘   │            │              │
 *                     │            └──────────────┘
 *          CARGO      │               QUARTERS
 *        ┌────────┐   │            ┌──────────────┐
 *        │        │   │            │              │
 *        │        │   │            └──────────────┘
 *        └────────┘   │
 *                 ┌───┴───┐
 *                 │AIRLOCK│
 *                 └───────┘
 */

export const SHIP = {
  id: 'ISV-KESTREL-90',
  name: 'ISV Kestrel-90',
  registry: 'MEGACORP ASSET 4471 // CLASS-C HAULER',
  spawn: [10.0, 0.92, 3.0],
  spawnYaw: Math.PI, // look aft, down the spine corridor

  rooms: [
    {
      id: 'BRIDGE',
      name: 'Bridge',
      kind: 'bridge',
      rect: [3, -4, 4, 4],
      circuit: 'A',
      floor: 'deck',
      wall: 'hull',
      tone: 'cold',
    },
    {
      id: 'CORRIDOR',
      name: 'Spine Corridor',
      kind: 'corridor',
      rect: [4, 0, 2, 12],
      circuit: 'A',
      floor: 'deck',
      wall: 'hull',
      tone: 'warm',
    },
    {
      id: 'MEDBAY',
      name: 'MedBay',
      kind: 'medbay',
      rect: [0, 0, 4, 3],
      circuit: 'B',
      floor: 'tile',
      wall: 'hull',
      tone: 'cold',
    },
    {
      id: 'CARGO',
      name: 'Cargo Hold',
      kind: 'cargo',
      rect: [0, 5, 4, 6],
      circuit: 'C',
      floor: 'grate',
      wall: 'reactor',
      tone: 'warm',
    },
    {
      id: 'REACTOR',
      name: 'Reactor Annex',
      kind: 'reactor',
      rect: [6, 2, 4, 5],
      circuit: 'C',
      floor: 'deck',
      wall: 'reactor',
      tone: 'warm',
    },
    {
      id: 'QUARTERS',
      name: 'Crew Quarters',
      kind: 'quarters',
      rect: [6, 8, 4, 4],
      circuit: 'B',
      floor: 'deck',
      wall: 'hull',
      tone: 'warm',
    },
    {
      id: 'AIRLOCK',
      name: 'Airlock',
      kind: 'airlock',
      rect: [4, 12, 2, 2],
      circuit: 'A',
      floor: 'deck',
      wall: 'reactor',
      tone: 'cold',
    },
  ],

  /**
   * axis 'x' = wall perpendicular to X at x = line * CELL, opening spans z in [start,end)
   * axis 'z' = wall perpendicular to Z at z = line * CELL, opening spans x in [start,end)
   */
  doors: [
    { id: 'D_BRIDGE', a: 'BRIDGE', b: 'CORRIDOR', axis: 'z', line: 0, start: 4, end: 6, kind: 'heavy' },
    { id: 'D_MEDBAY', a: 'MEDBAY', b: 'CORRIDOR', axis: 'x', line: 4, start: 1, end: 2, kind: 'standard' },
    { id: 'D_CARGO', a: 'CARGO', b: 'CORRIDOR', axis: 'x', line: 4, start: 6, end: 9, kind: 'heavy' },
    { id: 'D_REACTOR', a: 'REACTOR', b: 'CORRIDOR', axis: 'x', line: 6, start: 3, end: 5, kind: 'standard' },
    { id: 'D_QUARTERS', a: 'QUARTERS', b: 'CORRIDOR', axis: 'x', line: 6, start: 9, end: 11, kind: 'standard' },
    { id: 'D_AIRLOCK', a: 'CORRIDOR', b: 'AIRLOCK', axis: 'z', line: 12, start: 4, end: 6, kind: 'heavy' },
  ],

  /**
   * The outer hull hatch is welded shut in this milestone: venting to space is a
   * Milestone 4 system, so the bulkhead stays solid and the hatch is scenery.
   * `at` is the world position on the airlock's aft wall.
   */
  hatches: [{ id: 'HATCH_OUTER', room: 'AIRLOCK', at: [10, 27.78], facing: Math.PI }],

  lights: [
    { id: 'L_COR_1', room: 'CORRIDOR', at: [10, 3], circuit: 'A' },
    { id: 'L_COR_2', room: 'CORRIDOR', at: [10, 9], circuit: 'A' },
    { id: 'L_COR_3', room: 'CORRIDOR', at: [10, 15], circuit: 'A' },
    { id: 'L_COR_4', room: 'CORRIDOR', at: [10, 21], circuit: 'A' },
    { id: 'L_BRG_1', room: 'BRIDGE', at: [10, -6], circuit: 'A', tone: 'cold' },
    { id: 'L_BRG_2', room: 'BRIDGE', at: [10, -3], circuit: 'A', tone: 'cold' },
    { id: 'L_MED_1', room: 'MEDBAY', at: [4, 1.6], circuit: 'B', tone: 'cold' },
    { id: 'L_MED_2', room: 'MEDBAY', at: [4, 4.4], circuit: 'B', tone: 'cold' },
    { id: 'L_CAR_1', room: 'CARGO', at: [4, 12], circuit: 'C' },
    { id: 'L_CAR_2', room: 'CARGO', at: [4, 18], circuit: 'C' },
    { id: 'L_CAR_3', room: 'CARGO', at: [4, 21], circuit: 'C' },
    { id: 'L_REA_1', room: 'REACTOR', at: [16, 6.5], circuit: 'C' },
    { id: 'L_REA_2', room: 'REACTOR', at: [16, 12], circuit: 'C' },
    { id: 'L_QUA_1', room: 'QUARTERS', at: [16, 18.5], circuit: 'B' },
    { id: 'L_QUA_2', room: 'QUARTERS', at: [16, 22], circuit: 'B' },
    { id: 'L_AIR_1', room: 'AIRLOCK', at: [10, 26], circuit: 'A', tone: 'cold' },
  ],

  consoles: [
    { id: 'C_BRIDGE_OPS', room: 'BRIDGE', at: [9.4, -7.4], facing: 0, screen: 'OPS', label: 'Bridge Ops Console' },
    { id: 'C_BRIDGE_NAV', room: 'BRIDGE', at: [12.4, -7.4], facing: 0, screen: 'NAV', label: 'Navigation Plot' },
    { id: 'C_MED_SCAN', room: 'MEDBAY', at: [2.2, 0.45], facing: 0, screen: 'MED', label: 'Medbay Scanner' },
    { id: 'C_CARGO_MAN', room: 'CARGO', at: [0.45, 14], facing: Math.PI / 2, screen: 'CGO', label: 'Cargo Manifest' },
    { id: 'C_REACTOR_STAT', room: 'REACTOR', at: [16, 13.55], facing: Math.PI, screen: 'PWR', label: 'Reactor Status' },
    { id: 'C_QUARTERS_LOG', room: 'QUARTERS', at: [19.55, 19.5], facing: -Math.PI / 2, screen: 'CREW', label: 'Duty Roster' },
    { id: 'C_CORRIDOR_COMMS', room: 'CORRIDOR', at: [11.55, 14], facing: -Math.PI / 2, screen: 'COMMS', label: 'Comms Terminal' },
  ],

  /** Breaker panel on the reactor's outer bulkhead. */
  breakerPanel: { room: 'REACTOR', at: [19.72, 9.5], facing: -Math.PI / 2 },
  breakers: [
    { id: 'BRK_A', circuit: 'A', label: 'BUS A // FORE LIGHTS' },
    { id: 'BRK_B', circuit: 'B', label: 'BUS B // HABITAT' },
    { id: 'BRK_C', circuit: 'C', label: 'BUS C // CARGO+REACTOR' },
    { id: 'BRK_D', circuit: 'D', label: 'BUS D // DOOR SERVOS' },
  ],

  props: [
    // bridge
    { kind: 'chair', at: [10.0, -3.4], ry: Math.PI },
    { kind: 'chair', at: [12.0, -4.4], ry: Math.PI },
    // medbay
    { kind: 'bed', at: [2.4, 1.6], ry: Math.PI / 2 },
    { kind: 'bed', at: [2.4, 4.3], ry: Math.PI / 2 },
    { kind: 'locker', at: [7.5, 0.5], ry: 0 },
    // cargo
    { kind: 'crate', at: [2.0, 12.0], ry: 0.2, dynamic: true },
    { kind: 'crate', at: [3.5, 12.7], ry: -0.5, dynamic: true },
    { kind: 'crate', at: [2.6, 14.5], ry: 0.8, dynamic: true },
    { kind: 'crate', at: [6.4, 20.6], ry: 0.1, dynamic: true },
    { kind: 'barrel', at: [1.2, 20.6], ry: 0 },
    { kind: 'barrel', at: [1.2, 21.6], ry: 0 },
    { kind: 'pallet', at: [5.2, 16.0], ry: 0.35 },
    { kind: 'toolcrate', at: [7.2, 10.9], ry: 0.3, dynamic: true },
    // quarters
    { kind: 'bunk', at: [13.1, 18.0], ry: 0 },
    { kind: 'bunk', at: [13.1, 20.6], ry: 0 },
    { kind: 'bunk', at: [13.1, 23.2], ry: 0 },
    { kind: 'locker', at: [19.4, 17.3], ry: Math.PI / 2 },
    // reactor
    { kind: 'core', at: [16.0, 9.0], ry: 0 },
    { kind: 'barrel', at: [13.1, 12.9], ry: 0 },
    { kind: 'toolcrate', at: [18.4, 5.0], ry: -0.2, dynamic: true },
    // corridor
    { kind: 'extinguisher', at: [11.72, 12.6], ry: 0 },
    { kind: 'crate', at: [8.8, 17.0], ry: 0.1, dynamic: true },
    // airlock
    { kind: 'locker', at: [8.6, 27.4], ry: Math.PI / 2 },
  ],
};
