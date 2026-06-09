export type EncounterKind = 'standard' | 'ambush' | 'convoy' | 'minefield';
export type SpecialKind = 'kamikaze' | 'stealth' | 'support';
export type PlanetType = 'rock' | 'gas' | 'ice' | 'lava' | 'terra';
// rock = Mars-class desert · terra = Earth-class garden world · gas = Jupiter-class giant

export interface PlanetDef {
  name: string;
  type: PlanetType;
  radius: number;
  distance: number; // from sector center
  rings?: boolean;
  moons?: number;
  flavor: string;
}

export interface SectorDef {
  name: string;
  subtitle: string;
  nebulaHues: number[];
  ambientColor: number;
  sunColor: number;
  sunIntensity: number;
  asteroidColor: number;
  asteroidCount: number;
  asteroidEmissive?: number;
  dustColor: number;
  worldRadius: number;
  waves: number;
  /** relative spawn weight for tiers 1-5 (tier 5 only via boss flag) */
  tierWeights: [number, number, number, number];
  specials: { kind: SpecialKind; chance: number; count: number }[];
  encounters: EncounterKind[];
  boss: boolean;
  wrecks: number;
  planets: PlanetDef[];
}

export const SECTORS: SectorDef[] = [
  {
    name: 'ASTERIA BELT',
    subtitle: 'Mining frontier overrun by drone swarms',
    nebulaHues: [195, 230, 265],
    ambientColor: 0x223347,
    sunColor: 0xfff0dd,
    sunIntensity: 2.2,
    asteroidColor: 0x6e6258,
    asteroidCount: 170,
    dustColor: 0x88ccdd,
    worldRadius: 2400,
    waves: 3,
    tierWeights: [10, 4, 1, 0],
    specials: [],
    encounters: ['standard', 'standard', 'ambush'],
    boss: false,
    wrecks: 0,
    planets: [
      { name: 'KHEPRI', type: 'rock', radius: 170, distance: 1750, moons: 1, flavor: 'Abandoned ochre mining world. Dust storms visible from orbit.' },
      { name: 'SELQET', type: 'ice', radius: 120, distance: 1500, flavor: 'Frozen ocean moon. Sensors detect cryovolcanic plumes.' },
      { name: 'VERIDIA', type: 'terra', radius: 160, distance: 1950, moons: 1, flavor: 'Blue-green garden world. Oceans, grasslands and open sky.' },
      { name: 'HALCYON', type: 'gas', radius: 240, distance: 2100, rings: true, flavor: 'Quiet ring giant on the edge of the belt.' },
      { name: 'VESTA MINOR', type: 'ice', radius: 95, distance: 1350, flavor: 'A snowball with a heart of iron.' },
      { name: 'CHAR', type: 'lava', radius: 130, distance: 1850, flavor: 'Young volcanic world, still cooling.' },
    ],
  },
  {
    name: 'CRYON DRIFT',
    subtitle: 'Shattered ice field — watch for suicide scarabs',
    nebulaHues: [185, 205, 290],
    ambientColor: 0x26384a,
    sunColor: 0xcfe8ff,
    sunIntensity: 1.9,
    asteroidColor: 0x9fc4d8,
    asteroidCount: 210,
    asteroidEmissive: 0x16303c,
    dustColor: 0xbfe8ff,
    worldRadius: 2400,
    waves: 3,
    tierWeights: [8, 7, 2, 0],
    specials: [{ kind: 'kamikaze', chance: 0.85, count: 3 }],
    encounters: ['standard', 'ambush', 'minefield'],
    boss: false,
    wrecks: 0,
    planets: [
      { name: 'BOREAS', type: 'gas', radius: 260, distance: 1850, rings: true, flavor: 'Pale ring giant. Its shepherd moons were strip-mined long ago.' },
      { name: 'NIFLHEIM', type: 'ice', radius: 160, distance: 1500, moons: 1, flavor: 'Glacier world. The ice is a kilometer deep.' },
      { name: 'RIME', type: 'ice', radius: 110, distance: 1300, flavor: 'Frost-locked moonlet drifting off its orbit.' },
      { name: 'KOLD', type: 'terra', radius: 135, distance: 1700, flavor: 'Cold garden world — shallow seas and mossy plains.' },
      { name: 'AURORA', type: 'ice', radius: 145, distance: 2050, flavor: 'Permanent polar lights crown both hemispheres.' },
    ],
  },
  {
    name: 'VERMILION STORM',
    subtitle: 'Radiation nebula hiding cloaked phantoms',
    nebulaHues: [340, 15, 320],
    ambientColor: 0x3a2530,
    sunColor: 0xffc4a0,
    sunIntensity: 2.4,
    asteroidColor: 0x7a5248,
    asteroidCount: 190,
    dustColor: 0xff9988,
    worldRadius: 2500,
    waves: 4,
    tierWeights: [4, 8, 6, 1],
    specials: [{ kind: 'stealth', chance: 0.9, count: 2 }],
    encounters: ['standard', 'convoy', 'ambush'],
    boss: false,
    wrecks: 1,
    planets: [
      { name: 'PYRRHA', type: 'lava', radius: 190, distance: 1900, flavor: 'Molten hellscape. Crust never cooled after the bombardment.' },
      { name: 'ASH', type: 'rock', radius: 90, distance: 1450, flavor: 'Charred planetoid. Surface glassed by ancient weapons fire.' },
      { name: 'EMBER', type: 'lava', radius: 125, distance: 1600, flavor: 'Rivers of fire vein its night side.' },
      { name: 'SARD', type: 'rock', radius: 150, distance: 2000, moons: 1, flavor: 'Red canyon world carved by vanished seas.' },
      { name: 'TYPHON', type: 'gas', radius: 270, distance: 2200, flavor: 'Storm giant. The eye of its great cyclone never closes.' },
    ],
  },
  {
    name: 'GHOST YARD',
    subtitle: 'Fleet graveyard patrolled by support wardens',
    nebulaHues: [120, 160, 200],
    ambientColor: 0x24332a,
    sunColor: 0xd8ffe8,
    sunIntensity: 1.6,
    asteroidColor: 0x5a6258,
    asteroidCount: 140,
    dustColor: 0x99ffcc,
    worldRadius: 2500,
    waves: 4,
    tierWeights: [2, 6, 8, 4],
    specials: [
      { kind: 'support', chance: 0.95, count: 2 },
      { kind: 'kamikaze', chance: 0.4, count: 2 },
    ],
    encounters: ['standard', 'minefield', 'convoy'],
    boss: false,
    wrecks: 6,
    planets: [
      { name: 'TOMB', type: 'ice', radius: 150, distance: 1700, moons: 2, flavor: 'Memorial world. A million names are carved into the glacier.' },
      { name: 'RELIC', type: 'rock', radius: 130, distance: 1450, flavor: 'Half-buried hulls litter its highlands.' },
      { name: 'PALE', type: 'ice', radius: 105, distance: 1300, flavor: 'Bone-white and silent.' },
      { name: 'CINDER', type: 'lava', radius: 140, distance: 1900, flavor: 'A dying forge world, embers fading.' },
      { name: 'MORROW', type: 'gas', radius: 230, distance: 2100, rings: true, flavor: 'Green-grey giant wrapped in mourning bands.' },
    ],
  },
  {
    name: 'OBLIVION GATE',
    subtitle: 'The dreadnought anchorage. End this.',
    nebulaHues: [265, 280, 250],
    ambientColor: 0x2c2340,
    sunColor: 0xc0a8ff,
    sunIntensity: 1.8,
    asteroidColor: 0x4e4458,
    asteroidCount: 160,
    dustColor: 0xbb99ff,
    worldRadius: 2600,
    waves: 3,
    tierWeights: [2, 5, 8, 6],
    specials: [
      { kind: 'stealth', chance: 0.6, count: 2 },
      { kind: 'support', chance: 0.6, count: 1 },
    ],
    encounters: ['standard', 'ambush', 'convoy', 'minefield'],
    boss: true,
    wrecks: 3,
    planets: [
      { name: 'EREBUS', type: 'gas', radius: 300, distance: 2000, rings: true, moons: 2, flavor: 'Black gas giant. The dreadnoughts were forged in its shadow.' },
      { name: 'NYX', type: 'ice', radius: 140, distance: 1550, flavor: 'Twilight world that never sees its sun.' },
      { name: 'ACHERON', type: 'lava', radius: 170, distance: 1800, flavor: 'The anchorage burned it for fuel. It burns back.' },
      { name: 'STYX', type: 'rock', radius: 120, distance: 1400, flavor: 'Crossing point. Wrecks of both fleets orbit low.' },
      { name: 'LETHE', type: 'ice', radius: 100, distance: 1250, flavor: 'Whoever lands here forgets why they came.' },
      { name: 'TARTAR', type: 'rock', radius: 155, distance: 2150, flavor: 'Prison world. The cells are long empty.' },
    ],
  },
];
