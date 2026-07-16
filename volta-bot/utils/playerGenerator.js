// utils/playerGenerator.js
const Player = require('../models/Player');
const User = require('../models/User');
const { RARITY, PLAYER, ACADEMY, MATCH } = require('../config/constants');
const { randInt, weightedRandom, pick } = require('./random');

// ─── NAME POOLS (GLOBAL — every continent) ───────────────────────────────────

const FIRST_NAMES = [
  // 🌍 Africa
  'Kelechi', 'Chukwuemeka', 'Obinna', 'Tunde', 'Amara', 'Seun', 'Dami',
  'Femi', 'Leke', 'Uche', 'Nnamdi', 'Bayo', 'Dotun', 'Gbenga', 'Kunle',
  'Emeka', 'Chidi', 'Onyeka', 'Biodun', 'Rotimi', 'Adewale', 'Ikenna',
  'Kwame', 'Kofi', 'Mensah', 'Yao', 'Mohamed', 'Ibrahim', 'Tariq', 'Salim',
  'Juma', 'Kiptoo', 'Amani', 'Zubair', 'Kwesi', 'Osei', 'Mandla', 'Thabo',
  // 🌍 Europe
  'Luka', 'Mateo', 'Hugo', 'Liam', 'Noah', 'Marco', 'Lorenzo', 'Matteo',
  'Viktor', 'Anders', 'Lucas', 'Theo', 'Kai', 'Erik', 'Sven', 'Pavel',
  'Dmitri', 'Ivan', 'Felix', 'Jonas', 'Mikael', 'Bruno', 'Tiago', 'Niko',
  'Aleksandar', 'Cristian', 'Emre', 'Oskar', 'Leon', 'Pierre', 'Loris',
  // 🌎 South America
  'Diego', 'Mateus', 'Thiago', 'Gabriel', 'Lucas', 'Rafael', 'Joao', 'Pedro',
  'Santiago', 'Mateo', 'Valentín', 'Camilo', 'Andrés', 'Sebastián', 'Lucho',
  'Neymar', 'Rodrigo', 'Eduardo', 'Bruno', 'Facundo', 'Joaquin', 'Tobias',
  // 🌎 North America
  'Liam', 'Ethan', 'Mason', 'Caleb', 'Jaden', 'Andre', 'Marcus', 'Devon',
  'Isaiah', 'Carter', 'Diego', 'Emilio', 'Sebastian', 'Hector', 'Rafael',
  // 🌏 Asia
  'Haruto', 'Yuto', 'Sota', 'Riku', 'Min-jun', 'Ji-ho', 'Tae-yang', 'Arjun',
  'Rohan', 'Vikram', 'Kai', 'Wei', 'Chen', 'Hiroshi', 'Kenji', 'Akira',
  'Somchai', 'Bayu', 'Reza', 'Farhan', 'Hassan', 'Zain', 'Arman', 'Takeshi',
  // 🌏 Oceania
  'Jack', 'Lachlan', 'Cooper', 'Oliver', 'Riley', 'Flynn', 'Hamish', 'Beau',
  'Koa', 'Tane', 'Mika', 'Noah', 'Luca', 'Billy', 'Aiden', 'Jarrah',
  // ➕ Extra first names (100)
  'Adebayo', 'Chibuike', 'Olatunde', 'Ezinne', 'Ngozi', 'Adaeze', 'Ifeoma', 'Kamal',
  'Rashid', 'Saeed', 'Yusuf', 'Bilal', 'Samir', 'Karim', 'Rayan', 'Zayd',
  'Idris', 'Jelani', 'Oluwaseun', 'Chiamaka', 'Naledi', 'Lerato', 'Sipho', 'Themba',
  'Lindiwe', 'Abdul', 'Jamal', 'Taha', 'Faisal', 'Omar', 'Hakeem', 'Malik',
  'Zayn', 'Khalil', 'Amir', 'Nabil', 'Yassin', 'Bjorn', 'Aksel', 'Henrik',
  'Magnus', 'Sander', 'Casper', 'Emil', 'Gustav', 'Otto', 'Axel', 'Viggo',
  'Enzo', 'Gianni', 'Paolo', 'Ricardo', 'Sergio', 'Alessio', 'Davide', 'Nikola',
  'Stefan', 'Boris', 'Yuri', 'Tomas', 'Dominik', 'Adam', 'Filip', 'Mateusz',
  'Kacper', 'Jakub', 'Ben', 'Arlo', 'Soren', 'Nikolai', 'Pietro', 'Dante',
  'Elio', 'Romeo', 'Emiliano', 'Bautista', 'Ciro', 'Valentino', 'Agustin', 'Benjamin',
  'Cruz', 'Lautaro', 'Julian', 'Dylan', 'Gaspar', 'Ignacio', 'Ezequiel', 'Franco',
  'German', 'Mauro', 'Nahuel', 'Aiden', 'Jayden', 'Kingston', 'Zaire', 'Kairo',
  'Bryce', 'Trey', 'Deandre', 'Marquis',
];

const LAST_NAMES = [
  // 🌍 Africa
  'Okafor', 'Adeyemi', 'Nwosu', 'Eze', 'Bello', 'Lawal', 'Okonkwo', 'Musa',
  'Babatunde', 'Okeke', 'Abiodun', 'Obi', 'Amadi', 'Chukwu', 'Afolabi',
  'Mensah', 'Agyeman', 'Owusu', 'Kone', 'Traore', 'Diallo', 'Mbeki', 'Sow',
  'Hassan', 'Farouk', 'Kamau', 'Wanjala', 'Otieno', 'Zulu', 'Mokoena',
  // 🌍 Europe
  'Rossi', 'Müller', 'García', 'Silva', 'Novak', 'Petrov', 'Larsen', 'Andersen',
  'Dubois', 'Lefebvre', 'Costa', 'Santos', 'Schmidt', 'Becker', 'Ivanov',
  'Kowalski', 'Nowak', 'Horvat', 'Bianchi', 'Romano', 'Fernández', 'Moreau',
  'Johansson', 'Eriksson', 'Vasiliev', 'Papadopoulos', 'Ozturk', 'Kovac',
  // 🌎 South America
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Rodrigues',
  'Gomez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Ramirez', 'Torres',
  'Vargas', 'Castillo', 'Mendoza', 'Rojas', 'Figueroa', 'Quispe', 'Acuña',
  // 🌎 North America
  'Johnson', 'Williams', 'Brown', 'Davis', 'Martinez', 'Garcia', 'Rodriguez',
  'Wilson', 'Thompson', 'Lee', 'Nguyen', 'Patel', 'Singh', 'Carter', 'Brooks',
  // 🌏 Asia
  'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Kim', 'Lee', 'Park', 'Choi',
  'Patel', 'Sharma', 'Singh', 'Khan', 'Ali', 'Wang', 'Li', 'Chen', 'Wu',
  'Hassan', 'Rahman', 'Pham', 'Nguyen', 'Wijaya', 'Prasetyo', 'Reyes',
  // 🌏 Oceania
  'Smith', 'Williams', 'Jones', 'Taylor', 'Brown', 'Thompson', 'Walker',
  'Nguyen', 'Lee', 'Connor', 'Murphy', 'Jackson', 'Anderson', 'Mitchell',
  'Tupou', 'Folau', 'Tui', 'Kupa', 'Waka', 'Rangi',
  // ➕ Extra last names (100)
  'Okoro', 'Nwankwo', 'Ekwueme', 'Chukwuma', 'Okechukwu', 'Nwachukwu', 'Abubakar', 'Mohammed',
  'Abdulrahman', 'Haddad', 'Khalid', 'Nazari', 'Rahimi', 'Faraji', 'Said', 'Mwangi',
  'Kiplagat', 'Chepkoech', 'Achebe', 'Balogun', 'Adekunle', 'Onyekachi', 'Ezeani', 'Okereafor',
  'Salami', 'Ogunleye', 'Adesanya', 'Akinyemi', 'Belloc', 'Okonma', 'Hansen', 'Olsen',
  'Petersen', 'Henriksen', 'Berg', 'Haugen', 'Nielsen', 'Sørensen', 'Holm', 'Lindqvist',
  'Bergström', 'Andersson', 'Karlsson', 'Larsson', 'Ek', 'Nilsson', 'Virtanen', 'Korhonen',
  'Mäkinen', 'Lehtonen', 'Novakovic', 'Jovanovic', 'Markovic', 'Petrovic', 'Stojanovic', 'Mihajlovic',
  'Kovacevic', 'Popovic', 'Tosic', 'Savic', 'Ilic', 'Herrera', 'Navarro', 'Rivas',
  'Soto', 'Campos', 'Aguirre', 'Bravo', 'Cordero', 'Paredes', 'Benitez', 'Morales',
  'Salazar', 'Cisneros', 'Villanueva', 'Gallegos', 'Contreras', 'Espinoza', 'Ponce', 'Cabrera',
  'Velasquez', 'Suarez', 'Cardenas', 'Lozano', 'Mondragon', 'Tan', 'Ng', 'Lim',
  'Goh', 'Takeda', 'Yamamoto', 'Kobayashi', 'Nakamura', 'Saito', 'Matsumoto', 'Ahmed',
  'Hussain', 'Chowdhury', 'Begum', 'Reddy',
];

// Street/VOLTA-style nicknames — auto-assigned as name on Elite/Legendary players
const VOLTA_NICKNAMES = [
  'Flash', 'Shadow Striker', 'Night King', 'The Blur', 'El Diablo',
  'Iron Boot', 'Smoke', 'Razor', 'Ghost Foot', 'Thunderbolt',
  'The Sniper', 'El Fantasma', 'Bolt', 'The Wall', 'Predator',
  'Viper', 'Storm', 'Nova', 'Apex', 'The Machine',
];

// GK names always have an intimidating handle
const GK_NAMES = [
  'Iron Wall', 'Stone Hands', 'The Vault', 'Block Mode', 'The Fortress',
  'No Entry', 'Safe Hands', 'The Shield', 'Concrete', 'The Barrier',
];

function randomName(role, rarity) {
  if (role === 'goalkeeper') return pick(GK_NAMES);
  if (rarity === 'Elite' || rarity === 'Legendary') return pick(VOLTA_NICKNAMES);
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

// ─── STAT GENERATION ────────────────────────────────────────────────────────

function randomStat(rarity) {
  const { statMin, statMax } = RARITY[rarity] || RARITY.Common;
  return randInt(statMin, statMax);
}

function buildStats(role, rarity) {
  const s = () => randomStat(rarity);
  if (role === 'goalkeeper') {
    return { reflex: s(), positioning: s(), anticipation: s(), strength: s(), composure: s() };
  }
  return { pace: s(), skill: s(), shooting: s(), stamina: s(), composure: s() };
}

// ─── BUILD + SAVE PLAYER ────────────────────────────────────────────────────

function buildPlayer(ownerId, rarity = 'Common', role = null) {
  const resolvedRole = role || (Math.random() < 0.85 ? 'outfield' : 'goalkeeper');
  const potWeights = PLAYER.POTENTIAL_WEIGHTS[rarity] || PLAYER.POTENTIAL_WEIGHTS.Common;
  const age = randInt(17, 32);

  return Player.create({
    ownerId,
    name: randomName(resolvedRole, rarity),
    role: resolvedRole,
    rarity,
    potential: weightedRandom(potWeights),
    stats: buildStats(resolvedRole, rarity),
    age,
  });
}

// ─── PACK OPEN ───────────────────────────────────────────────────────────────

function openPack(ownerId, packConfig) {
  const players = [];
  for (let i = 0; i < packConfig.count; i++) {
    const rarity = weightedRandom(packConfig.weights);
    players.push(buildPlayer(ownerId, rarity));
  }
  return players;
}

// ─── STARTER SQUAD (guaranteed 3 outfield + 1 keeper) ────────────────────────
// New managers always get a playable team: exactly 3 outfield + 1 goalkeeper.

function buildStarterSquad(ownerId) {
  const outfield = [];
  for (let i = 0; i < MATCH.OUTFIELD_PER_SIDE; i++) {
    outfield.push(buildPlayer(ownerId, 'Common', 'outfield'));
  }
  const keeper = buildPlayer(ownerId, 'Common', 'goalkeeper');
  return [...outfield, keeper];
}

// Give a user a starter squad if they don't already have one. Safe to call
// repeatedly — it only acts when the user has no squad yet.
function grantStarterSquad(ownerId) {
  const user = User.getByWhatsappId(ownerId);
  if (user && user.startingXI && user.startingXI.length) return;
  const players = buildStarterSquad(ownerId);
  User.update(ownerId, {
    registered: true,
    startingXI: players.map((p) => p.id),
    bench: [],
    reserves: [],
  });
}

// ─── ACADEMY YOUTH ───────────────────────────────────────────────────────────

function buildYouthPlayer(ownerId) {
  const role = Math.random() < 0.85 ? 'outfield' : 'goalkeeper';
  const statKeys = role === 'goalkeeper'
    ? ['reflex', 'positioning', 'anticipation', 'strength', 'composure']
    : ['pace', 'skill', 'shooting', 'stamina', 'composure'];

  const stats = {};
  for (const k of statKeys) {
    stats[k] = randInt(ACADEMY.YOUTH_STAT_MIN, ACADEMY.YOUTH_STAT_MAX);
  }

  return Player.create({
    ownerId,
    name: randomName(role, 'Common'),
    role,
    rarity: 'Common',
    potential: weightedRandom({ Medium: 30, High: 50, Star: 20 }),
    stats,
    age: randInt(15, 18),
  });
}

// ─── SEED AI MARKET PLAYERS ──────────────────────────────────────────────────

function seedMarketPlayer(rarity = null) {
  const rarities = ['Common', 'Common', 'Rare', 'Rare', 'Elite', 'Legendary'];
  const r = rarity || pick(rarities);
  const p = buildPlayer('AI_MARKET', r);
  return Player.update(p.id, { isAI: true });
}

module.exports = { buildPlayer, openPack, buildStarterSquad, grantStarterSquad, buildYouthPlayer, seedMarketPlayer };
