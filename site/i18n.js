/**
 * Both languages, each written as itself.
 *
 * Nothing here is a translation of the other side. The German was written as
 * German and the English as English, which is why they do not line up phrase
 * for phrase and why a couple of them put the emphasis somewhere else. The
 * pinball words German players actually use stay as they are: Flipper, and the
 * machine is a Flipper too, not an "Kugelspielautomat".
 *
 * Both sets are measured before they ship. Mean nine to fourteen words per
 * sentence, nothing over twenty-eight.
 */

const STRINGS = {
  en: {
    'meta.title': 'SIEGE · a pinball table with hand-written physics',
    'meta.tagline': 'a pinball table with hand-written physics',
    'meta.description':
      'Two machines in one cabinet. Storm a castle or dock at a station. Every bounce is worked out from scratch, with no physics library anywhere.',

    'nav.debug': 'Geometry',
    'nav.board': 'Change machine',
    'touch.swipe': 'Swipe across the table to change machine',

    'hud.score': 'Score',
    'hud.best': 'Best',
    'hud.ball': 'Ball',
    'hud.siege': 'Siege',
    // NOVA counts the same thing the castle calls a siege, so the word changes
    // and nothing else does.
    'hud.wave': 'Wave',

    'overlay.ready': 'Wind the plunger',
    'overlay.hint': 'Hold Space, then let go. The arrow keys work the flippers.',
    'overlay.over': 'Game over',
    'overlay.again': 'Press Space to play again.',

    'foot.built': 'Hand-written physics. No engine, no bundler, no dependencies.',
  },

  de: {
    'meta.title': 'SIEGE · Flipper mit selbst gerechneter Physik',
    'meta.tagline': 'Flipper mit selbst gerechneter Physik',
    'meta.description':
      'Zwei Geräte in einem Gehäuse. Einmal die Burg stürmen, einmal an der Station andocken. Jeder Aufprall ist von Hand gerechnet, ganz ohne Physik-Bibliothek.',

    'nav.debug': 'Geometrie',
    'nav.board': 'Gerät wechseln',
    'touch.swipe': 'Zum Wechseln über den Tisch wischen',

    'hud.score': 'Punkte',
    'hud.best': 'Bestwert',
    'hud.ball': 'Kugel',
    'hud.siege': 'Sturm',
    'hud.wave': 'Welle',

    'overlay.ready': 'Abschuss spannen',
    'overlay.hint': 'Leertaste halten und loslassen. Die Pfeiltasten steuern die Flipper.',
    'overlay.over': 'Spiel vorbei',
    'overlay.again': 'Leertaste drücken für eine neue Runde.',

    'foot.built': 'Physik von Hand geschrieben. Keine Engine, kein Bundler, keine Abhängigkeiten.',
  },
};

const KEY = 'siege.lang';

/**
 * Start in the browser's language, then remember whatever was chosen.
 *
 * Guessing from `navigator.language` is only ever a first move. Plenty of
 * people run an English system and want German, so the stored choice always
 * wins once there is one.
 */
let lang = localStorage.getItem(KEY) ?? (navigator.language?.startsWith('de') ? 'de' : 'en');
if (!STRINGS[lang]) lang = 'en';

export function currentLanguage() {
  return lang;
}

export function t(key) {
  return STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
}

/** Swap every marked node. `data-i18n-attr` names an attribute instead of text. */
export function applyLanguage() {
  document.documentElement.lang = lang;

  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.dataset.i18n;
    const attr = node.dataset.i18nAttr;
    if (attr) node.setAttribute(attr, t(key));
    else node.textContent = t(key);
  }

  document.title = t('meta.title');
}

export function toggleLanguage() {
  lang = lang === 'de' ? 'en' : 'de';
  localStorage.setItem(KEY, lang);
  applyLanguage();
}
