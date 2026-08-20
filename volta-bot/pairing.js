const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');
const baileys = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const readline = require('readline');
const pino = require('pino');
const { resolveVersion } = require('./utils/waVersion');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./sessions');
  const { version, source } = await resolveVersion(baileys, (m) => console.log(`[VOLTA] ${m}`));

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  let pairingRequested = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !pairingRequested && !sock.authState.creds.registered) {
      pairingRequested = true;
      let phoneNumber = await question(
        'Enter phone number with country code (digits only, e.g. 14155552671, 447911123456, 2348012345678):\n> '
      );
      phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
      if (phoneNumber.startsWith('00')) phoneNumber = phoneNumber.slice(2);

      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\nPairing code: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
        console.log('Open WhatsApp -> Settings -> Linked Devices -> Link a device');
        console.log('-> "Link with phone number instead" -> enter the code above\n');
      } catch (err) {
        console.error('Failed to request pairing code:', err.message || err);
        console.log('Make sure the number includes the country code (no + or spaces).');
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom) && lastDisconnect.error.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed:', lastDisconnect?.error?.message || 'unknown', '| Reconnecting:', shouldReconnect);
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('Connected successfully.');
      rl.close();
    }
  });

  return sock;
}

connectToWhatsApp();
