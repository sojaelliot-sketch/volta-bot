'use strict';
// utils/interactive.js
//
// ─── READ THIS BEFORE TURNING BUTTONS ON ────────────────────────────────────
//
// Since Baileys v6 WhiskeySockets' sendMessage() drops the legacy `buttons` /
// `list` content keys, so the old `sock.sendMessage(jid, { text, buttons })`
// call sent plain text at best and rendered nothing at worst. The library also
// does not emit the `<biz><interactive><native_flow>` binary nodes that
// WhatsApp expects for the modern interactive button format.
//
// The fix (proven by the itsukichan fork and the phantom-buttons wrapper) is:
//
//   1. build the current WhatsApp interactive format by hand —
//      `interactiveMessage.nativeFlowMessage.buttons[]` with
//      `name: 'quick_reply'` and a JSON `buttonParamsJson`,
//   2. construct the WAMessage with `generateWAMessageFromContent` (which
//      bypasses sendMessage's content validation), and
//   3. relay it via `relayMessage(jid, msg, { additionalNodes })`, injecting
//      the `biz > interactive(native_flow v=1) > native_flow(v=9 name=mixed)`
//      wrappers plus a `bot (biz_bot=1)` node in private chats.
//
// No forks and no third-party button packages are needed. This module does the
// node injection itself, so it cannot silently install an "anti-ban" helper
// that exfiltrates your sessions/ credentials — the supply-chain attack seen
// in April 2026 with the `lotusbail` package.
//
// `sock.sendMessage` routes taps on these buttons back as an
// `interactiveResponseMessage.nativeFlowResponseMessage.paramsJson` whose
// `id` is the command, and the router already normalises that into plain
// command text (see router.js nativeFlowId).
//
// THE BAN WARNING. Bans on unofficial APIs are permanent with no appeal.
// Buttons are a WhatsApp Business feature; a personal number emitting business
// interactive messages is an unusual signal. Nobody has published hard numbers
// tying buttons specifically to bans, so treat that as a suspicion rather than
// a fact — but it is a real one, and the downside is losing the number forever.
//
// ─── WHAT THIS MODULE DOES ──────────────────────────────────────────────────
//
// It gives every command ONE way to offer choices:
//
//   • BUTTONS_ENABLED = false (default) → a clean numbered text menu.
//   • BUTTONS_ENABLED = true            → tries real interactive buttons, falls
//                                         back to the same text on any error.
//
// Either way the REPLIES are handled identically, because the router already
// normalises button taps and list picks into plain command text. So you can
// build the whole bot on this today, decide about buttons later, and flip one
// env var without touching a single command.

const { sendText } = require('./messaging');
const logger = require('./logger');
const {
  generateWAMessageFromContent,
  normalizeMessageContent,
  isJidGroup,
  generateMessageIDV2,
} = require('@whiskeysockets/baileys');

// ── The switch. Leave unset unless you have read the notes above. ──
const BUTTONS_ENABLED = process.env.VOLTA_BUTTONS === 'true';

// WhatsApp quick replies are capped at 3 per message. More than that must be a
// list. The numbered-text fallback below handles any count.
const MAX_BUTTONS = 3;

/**
 * The modern interactive payload stock Baileys is missing. Each choice becomes
 * a `quick_reply` native-flow button whose `id` is the command to run.
 */
function buildInteractiveContent(text, footer, choices) {
  return {
    interactiveMessage: {
      body: { text },
      ...(footer ? { footer: { text: footer } } : {}),
      nativeFlowMessage: {
        buttons: choices.map((c) => ({
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: c.label.slice(0, 20),
            id: c.id,
          }),
        })),
      },
    },
  };
}

/**
 * The binary node wrappers an official client attaches to interactive buttons.
 * Private chats additionally get a `bot` node so the flow renders in 1:1 chats.
 */
function buttonNodes(isPrivate) {
  const nodes = [{
    tag: 'biz',
    attrs: {},
    content: [{
      tag: 'interactive',
      attrs: { type: 'native_flow', v: '1' },
      content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
    }],
  }];
  if (isPrivate) {
    nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
  }
  return nodes;
}

/**
 * Send an interactive (native-flow) button message without a third-party fork.
 * Throws on failure so sendChoice can fall back to text.
 */
async function sendInteractiveButtons(sock, jid, { text, footer = '', choices = [] }, quoted) {
  const content = buildInteractiveContent(text, footer, choices);
  const userJid = sock.user && sock.user.id;

  const fullMsg = generateWAMessageFromContent(jid, content, {
    logger: sock.logger,
    userJid,
    quoted,
    messageId: generateMessageIDV2(userJid),
  });

  // Multi-device compatibility shim (the same wrapper itsukichan/whaileys
  // ship): nest the interactive payload inside a documentWithCaptionMessage so
  // WhatsApp keeps it intact. normalizeMessageContent() unwraps it on both
  // receive and tap, so nothing downstream changes.
  fullMsg.message = {
    documentWithCaptionMessage: { message: fullMsg.message },
  };

  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalNodes: buttonNodes(!isJidGroup(jid)),
  });
  return fullMsg;
}

/**
 * Present a choice.
 *
 * @param {object}  sock
 * @param {string}  jid
 * @param {object}  opts
 * @param {string}  opts.text     the body
 * @param {string}  [opts.footer]
 * @param {Array}   opts.choices  [{ id: '!squad', label: 'My squad' }, ...]
 *                                `id` is the command text the tap should send.
 * @param {object}  [quoted]      message to reply to
 */
async function sendChoice(sock, jid, { text, footer, choices = [] }, quoted) {
  const list = choices.filter((c) => c && c.id && c.label);

  if (!list.length) return sendText(sock, jid, text, quoted);

  if (BUTTONS_ENABLED && list.length <= MAX_BUTTONS) {
    try {
      return await sendInteractiveButtons(sock, jid, { text, footer, choices: list }, quoted);
    } catch (err) {
      // Fall back silently: buttons are a nice-to-have, the menu is the point.
      logger.debug({ err: err && err.message }, 'Interactive buttons unavailable — using text');
    }
  }

  // The fallback IS the default. Numbered, unambiguous, works on every client
  // including WhatsApp Web and old Androids, and survives copy-paste.
  const body = [
    text,
    '',
    ...list.map((c, i) => `*${i + 1}.* ${c.label}  —  ${c.id}`),
  ];
  if (footer) { body.push(''); body.push(`_${footer}_`); }
  return sendText(sock, jid, body.join('\n'), quoted);
}

/** True when this build will actually attempt native buttons. */
function buttonsActive() { return BUTTONS_ENABLED; }

module.exports = { sendChoice, buttonsActive, MAX_BUTTONS };