// config/competitionGCs.js
// Competition GC detection + links
// GCs with # in their description/topic are competition GCs
// Keywords in the GC name map to competition IDs

const COMP_KEYWORDS = {
  champions_league:    ['champions league', 'ucl'],
  europa_league:       ['europa league', 'uel'],
  conference_league:   ['conference league', 'ecl', 'conference'],
  fa_cup:              ['fa cup', 'fac'],
  carabao_cup:         ['carabao cup', 'carabao', 'cc'],
  community_shield:    ['community shield', 'cs'],
  copa_libertadores:   ['copa libertadores', 'copa', 'clib'],
  intercontinental_cup: ['intercontinental', 'ic'],
};

const COMP_NAMES = {
  champions_league:    '🏆 Champions League',
  europa_league:       '🥈 Europa League',
  conference_league:   '🥉 Conference League',
  fa_cup:              '🎯 FA Cup',
  carabao_cup:         '🥤 Carabao Cup',
  community_shield:    '🛡️ Community Shield',
  copa_libertadores:   '🌎 Copa Libertadores',
  intercontinental_cup: '🏅 Intercontinental Cup',
};

const COMP_LINKS = {
  champions_league:    'https://chat.whatsapp.com/IY1hyqfP5bH3F7E6UGqfMu',
  europa_league:       'https://chat.whatsapp.com/IZyEtAxUmUEHczI0iHC81f',
  conference_league:   'https://chat.whatsapp.com/BjD9E4CJqEbKWzbdNHjpX3',
  fa_cup:              'https://chat.whatsapp.com/IiT4ybSW5nP07hUA9yrUry',
  carabao_cup:         'https://chat.whatsapp.com/E9o6OVLHRt9EnkOAySiUms',
  community_shield:    'https://chat.whatsapp.com/DRuEdJaPqGL5drroefLSJE',
  copa_libertadores:   'https://chat.whatsapp.com/BSk5zIVopWz2Ay2hCvvqBJ',
  intercontinental_cup: 'https://chat.whatsapp.com/FUpau4QjeWWGuTHEEIVYTR',
};

// Allowed commands in competition GCs for non-staff participants
const COMP_GC_ALLOWED = new Set([
  'compplay', 'match', 'squad', 'card', 'flex', 'profile',
  'start', 'register', 'teamchem', 'preserves', 'topchem',
]);

// Detect if a group description/topic contains # (marks it as a comp GC)
function isCompGCByDescription(description) {
  if (!description) return false;
  return description.includes('#');
}

// Detect competition ID from GC group name using keywords
function detectCompFromName(groupName) {
  if (!groupName) return null;
  const lower = groupName.toLowerCase();
  for (const [compId, keywords] of Object.entries(COMP_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return compId;
    }
  }
  return null;
}

function getCompName(compId) {
  return COMP_NAMES[compId] || compId;
}

function getCompLink(compId) {
  return COMP_LINKS[compId] || null;
}

function getAllCompIds() {
  return Object.keys(COMP_KEYWORDS);
}

// Complete GC list: name + link for every competition, used by !compgcs.
const COMPETITION_GCS = {};
for (const id of getAllCompIds()) {
  COMPETITION_GCS[id] = { name: getCompName(id), link: getCompLink(id) };
}

module.exports = {
  COMP_KEYWORDS,
  COMP_NAMES,
  COMP_LINKS,
  COMPETITION_GCS,
  COMP_GC_ALLOWED,
  isCompGCByDescription,
  detectCompFromName,
  getCompName,
  getCompLink,
  getAllCompIds,
};
