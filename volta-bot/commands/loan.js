const User = require('../models/User');
const Player = require('../models/Player');
const Loan = require('../models/Loan');
const { sendText } = require('../utils/messaging');
const { money } = require('../utils/formatter');
const ui = require('../utils/ui');
const { BRAND } = require('../config/constants');

// Resolve a loan target (lender/borrower) from whatever the user provided:
// a raw name, a @mention text, a phone number, a full jid, a replied-to
// message, or an @mention in the command. Falls back to name lookup last.
function resolveUser(raw, { mentioned, replyTo } = {}) {
  if (!raw && mentioned) return User.getByWhatsappId(mentioned);
  if (!raw && replyTo) return User.getByWhatsappId(replyTo);
  if (!raw) return null;
  const s = String(raw).replace(/^@/, '').trim();
  if (!s) return null;
  // Phone number or full jid
  if (/^\d{6,}$/.test(s) || /^\d+@s\.whatsapp\.net$/.test(s)) {
    const jid = s.includes('@') ? s : `${s}@s.whatsapp.net`;
    return User.getByWhatsappId(jid);
  }
  // Otherwise treat as a manager name
  return User.findByName(s);
}

async function loanCommand({ sock, msg, jid, sender, args, user, replyTo, mentioned, cmd }) {
  if (!user || !user.registered) {
    await sendText(sock, jid, `⚠️ Register first with *!register [name]*`, msg);
    return;
  }

  // !borrow <amount> is a friendlier front door: it drops the user straight
  // into the money-loan flow instead of making them learn a subcommand.
  if (cmd === 'borrow') {
    // !borrow 5000 @them  -> ask that person directly
    // !borrow 5000        -> post an open request to the chat
    const named = args.some((a) => /[a-z@]/i.test(String(a))) || mentioned || replyTo;
    args = args.length ? (named ? ['money', ...args] : ['request', ...args]) : ['help'];
  }
  if (cmd === 'lend') args = ['lend', ...args];

  let subcmd = (args[0] || '').toLowerCase();

  // ── Make the command forgiving ────────────────────────────────────────
  //
  // There used to be two parallel sets of verbs — accept/pay/return for PLAYER
  // loans and maccept/mreject/mpay for MONEY loans — and nothing told you which
  // was which. People typed !loan accept on a money loan, got "Loan not found",
  // and gave up. Now the verb is inferred from the loan ID itself, which already
  // encodes its type (loan_… vs mloan_…).
  const ALIASES = {
    a: 'accept', ok: 'accept', yes: 'accept', take: 'accept',
    r: 'reject', no: 'reject', decline: 'reject',
    p: 'pay', repay: 'pay',
    back: 'return', giveback: 'return',
    borrow: 'money', cash: 'money', ask: 'money',
    all: 'list', offers: 'list', browse: 'list',
    h: 'help', '?': 'help', how: 'help',
  };
  if (ALIASES[subcmd]) subcmd = ALIASES[subcmd];

  // Route accept/reject/pay to the money-loan handler when the ID says so.
  const idArg = String(args[1] || '');
  if (idArg.startsWith('mloan_')) {
    if (subcmd === 'accept') subcmd = 'maccept';
    else if (subcmd === 'reject') subcmd = 'mreject';
    else if (subcmd === 'pay') subcmd = 'mpay';
  }

  // ── !loan help — plain-English guide ──
  if (subcmd === 'help') {
    await sendText(sock, jid, ui.card({
      icon: '🏦', title: 'Loans — how they work',
      body: [
        `There are two kinds.`,
        '',
        `*1 · Lend a player*`,
        `Send one of your players to another manager for a while. They pay you a fee.`,
        `  *!loan offer <playerID> @them*`,
        `That's it — fee, rent and length get sensible defaults. Want to set them?`,
        `  *!loan offer <playerID> @them <fee> <rent> <days>*`,
        '',
        `*2 · Lend money*`,
        `  *!loan money @them <amount>*  — offer them cash`,
        `  *!borrow <amount>*  — ask the group for cash`,
        '',
        `*Responding to any offer*`,
        `  *!loan accept <loanID>*`,
        `  *!loan reject <loanID>*`,
        `  *!loan pay <loanID> <amount>*`,
        `  *!loan return <loanID>*  — send a borrowed player home`,
        '',
        `Paste the loan ID and the bot works out which type it is. Short forms: *ok* = accept, *no* = reject, *repay* = pay.`,
      ],
      next: 'Start with *!squad* to pick a player to offer.',
    }), msg);
    return;
  }

  // !loan — show active loans
  if (!subcmd) {
    const myLoans = Loan.getActiveLoansByBorrower(sender);
    const lent = Loan.getLoansByLender(sender);

    let output = ``;

    if (myLoans.length === 0 && lent.length === 0) {
      output = ui.card({
        icon: '📋', title: 'Active loans',
        body: [
          `Nothing running right now. Few things you can do:`,
          '',
          `🤝 Lend a player —  *!loan offer <playerID> @them*  (IDs from *!squad*)`,
          `💵 Lend or borrow cash —  *!loan money @them <amount>*  or  *!borrow <amount>*`,
          `👀 See what's on offer —  *!loan list*`,
        ],
        next: 'Confused? !loan help walks you through it.',
      });
    } else {
      if (myLoans.length > 0) {
        output += `📥 *Borrowing:*\n\n`;
        for (const l of myLoans) {
          const player = Player.getById(l.playerId);
          const daysLeft = Math.max(0, Math.ceil((new Date(l.endDate) - new Date()) / 86400000));
          output += `   • *${player?.name || l.playerId}*\n`;
          output += `       Owed: ${ui.money(l.totalOwed)} · Paid: ${ui.money(l.paidAmount)}\n`;
          output += `       Days left: *${daysLeft}* · ID: ${l.id}\n\n`;
        }
      }
      if (lent.length > 0) {
        output += `📤 *Lending:*\n\n`;
        for (const l of lent) {
          const player = Player.getById(l.playerId);
          const borrower = User.getByWhatsappId(l.borrowerId);
          const daysLeft = Math.max(0, Math.ceil((new Date(l.endDate) - new Date()) / 86400000));
          output += `   • *${player?.name || l.playerId}* → ${borrower?.name || 'Unknown'}\n`;
          output += `       Owed: ${ui.money(l.totalOwed)} · Paid: ${ui.money(l.paidAmount)}\n`;
          output += `       Days left: *${daysLeft}* · ID: ${l.id}\n\n`;
        }
      }
      output = `📋 *ACTIVE LOANS*\n${ui.RULE}\n\n` + output + `\n${ui.RULE}\n${BRAND}`;
    }

    await sendText(sock, jid, output, msg);
    return;
  }

  // ── !borrow <amount> — post an open request to the group ──
  if (subcmd === 'request') {
    const amount = parseInt(args[1], 10);
    if (!amount || amount <= 0) {
      await sendText(sock, jid, ui.card({
        icon: '💵', title: 'Borrow',
        body: [`Ask the group for a loan:`, `  *!borrow 5000*`, '', `Anyone can answer with *!loan money @you 5000*.`],
        next: 'You set the terms, they decide.',
      }), msg);
      return;
    }
    await sendText(sock, jid, ui.card({
      icon: '🙏', title: 'Loan wanted',
      lead: `*${user.name}* is asking to borrow *💲${ui.money(amount)}*.`,
      body: [
        `Want to lend it? Send:`,
        `  *!loan money @${String(sender).split('@')[0]} ${amount}*`,
      ],
      next: 'You set the terms and they can accept or refuse.',
    }), msg);
    return;
  }

  // !loan offer [playerID] [@user] [fee] [rent] [days]
  if (subcmd === 'offer') {
    const playerQuery = args[1];
    const targetUser = args[2];
    const fee = parseInt(args[3]) || 5000;
    const rent = parseInt(args[4]) || 1000;
    const days = parseInt(args[5]) || 7;

    if (!playerQuery || !targetUser) {
      await sendText(sock, jid, ui.card({
        icon: '🤝', title: 'Lend a player',
        body: [
          `Simplest form — just the player and who gets them:`,
          `  *!loan offer <playerID> @them*`,
          '',
          `Fee, rent and length default to something fair based on the player's rating.`,
          `Set them yourself:`,
          `  *!loan offer <playerID> @them <fee> <rent> <days>*`,
        ],
        next: 'Get player IDs from *!squad* · full guide in *!loan help*.',
      }), msg);
      return;
    }

    const player = Player.findByQuery(sender, playerQuery);
    if (!player) {
      await sendText(sock, jid, `❌ Player not found.`, msg);
      return;
    }
    if (player.ownerId !== sender) {
      await sendText(sock, jid, `❌ You don't own this player.`, msg);
      return;
    }

    const target = resolveUser(targetUser, { mentioned, replyTo });
    if (!target) {
      await sendText(sock, jid, `❌ Target user not found. Try a name, phone number, @mention, or reply to their message.`, msg);
      return;
    }

    const loan = Loan.createLoan({
      playerId: player.id,
      lenderId: sender,
      borrowerId: target.whatsappId,
      loanFee: fee,
      weeklyRent: rent,
      durationDays: days,
    });

    await sendText(sock, jid, ui.card({
      icon: '📤', title: 'Loan offer created',
      rows: [
        ['Player', `*${player.name}*`],
        ['To', target.name],
        ['Fee', `💲${ui.money(fee)}`],
        ['Rent', `💲${ui.money(rent)} · /week`],
        ['Duration', `${days} days`],
        ['Loan ID', `${loan.id}`],
      ],
next: `They can accept with *!loan accept ${loan.id}*`,
    }), msg);
    return;
  }

  // !loan accept [loanID]
  if (subcmd === 'accept') {
    const loanId = args[1];
    if (!loanId) {
      await sendText(sock, jid, `Usage: *!loan accept [loanID]*`, msg);
      return;
    }

    const loan = Loan.getLoan(loanId);
    if (!loan) {
      await sendText(sock, jid, `❌ Loan not found.`, msg);
      return;
    }
    if (loan.borrowerId !== sender) {
      await sendText(sock, jid, `❌ This loan is not offered to you.`, msg);
      return;
    }
    if (loan.status !== 'active') {
      await sendText(sock, jid, `❌ This loan is no longer active.`, msg);
      return;
    }

    const borrower = User.getByWhatsappId(sender);
    if ((borrower.currency || 0) < loan.loanFee) {
      await sendText(sock, jid, `❌ Insufficient funds. Need ${(loan.loanFee/1000).toFixed(0)}K MW.`, msg);
      return;
    }

    User.update(sender, { currency: (borrower.currency || 0) - loan.loanFee });
    const player = Player.getById(loan.playerId);
    Player.update(loan.playerId, { ownerId: sender, previousOwner: loan.lenderId });

    const lender = User.getByWhatsappId(loan.lenderId);
    User.addCurrency(loan.lenderId, loan.loanFee);

    await sendText(sock, jid, ui.card({
      icon: '✅', title: 'Loan accepted',
      rows: [
        ['Player', `*${player?.name || loan.playerId}*`],
        ['Fee paid', `💲${ui.money(loan.loanFee)}`],
        ['Weekly rent', `💲${ui.money(loan.weeklyRent)}`],
        ['Duration', `${loan.durationDays} days`],
      ],
      body: ['⚠️ The player returns automatically when the loan expires.'],
      next: `Pay rent with *!loan pay ${loan.id} [amount]*`,
    }), msg);
    return;
  }

  // !loan pay [loanID] [amount]
  if (subcmd === 'pay') {
    const loanId = args[1];
    const amount = parseInt(args[2]) || 1000;

    if (!loanId) {
      await sendText(sock, jid, `Usage: *!loan pay [loanID] [amount]*`, msg);
      return;
    }

    const borrower = User.getByWhatsappId(sender);
    if ((borrower.currency || 0) < amount) {
      await sendText(sock, jid, `❌ Insufficient funds. You have ${(borrower.currency/1000).toFixed(0)}K MW.`, msg);
      return;
    }

    const result = Loan.makePayment(loanId, amount);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }

    User.update(sender, { currency: (borrower.currency || 0) - amount });
    const loan = Loan.getLoan(loanId);
    if (loan) {
      const lender = User.getByWhatsappId(loan.lenderId);
      if (lender) {
        User.update(loan.lenderId, { currency: (lender.currency || 0) + amount });
      }
    }

    const msg2 = result.completed
      ? ui.card({
          icon: '🎉', title: 'Loan completed',
          lead: `All paid back — the player returns to its owner.`,
          brand: false,
        })
      : ui.card({
          icon: '✅', title: 'Payment recorded',
          rows: [
            ['Paid', `💲${ui.money(amount)}`],
            ['Remaining', `💲${ui.money(result.remaining)}`],
          ],
          brand: false,
        });

    await sendText(sock, jid, `${msg2}`, msg);
    return;
  }

  // !loan return [loanID] — borrower voluntarily returns player
  if (subcmd === 'return') {
    const loanId = args[1];
    if (!loanId) {
      await sendText(sock, jid, `Usage: *!loan return [loanID]*`, msg);
      return;
    }

    const result = Loan.returnPlayer(loanId);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }

    const player = Player.getById(result.playerId);
    Player.update(result.playerId, { ownerId: result.lenderId, previousOwner: null });

    await sendText(sock, jid, ui.card({
      icon: '🏡', title: 'Player returned',
      lead: `*${player?.name || result.playerId}* is back with its owner.`,
      brand: false,
    }), msg);
    return;
  }

  // !loan money [@user] [amount] [days] — request a money loan (lender must accept)
  if (subcmd === 'money') {
    // Accept the amount and the person in either order. Insisting on one
    // fixed order is most of what made this command feel broken.
    const rest = args.slice(1).filter(Boolean);
    const amountTok = rest.find((a) => /^\d[\d,]*$/.test(a));
    const target = rest.find((a) => a !== amountTok) || null;
    const amount = parseInt(String(amountTok || '').replace(/,/g, ''), 10) || 0;
    const days = parseInt(rest.find((a) => a !== amountTok && a !== target)) || 7;

    if (!target || !amount || amount <= 0) {
      await sendText(sock, jid, ui.card({
        icon: '💵', title: 'Ask someone for a loan',
        body: [
          `  *!borrow 5000 @them*`,
          '',
          `That asks *them* to lend *you* 5,000. They approve or refuse.`,
          `Going the other way — you lending to someone else:`,
          `  *!lend @them 5000*`,
          '',
          `• 10% interest, 7 days by default (add a number to change it)`,
          `• Minimum 1,000 · maximum 30 days`,
        ],
        next: 'Both sides get a fair deal and a clear due date.',
      }), msg);
      return;
    }

    if (days > 30) {
      await sendText(sock, jid, `❌ Maximum loan duration is 30 days.`, msg);
      return;
    }

    if (amount < 1000) {
      await sendText(sock, jid, `❌ Minimum loan amount is 1,000 MW.`, msg);
      return;
    }

    const lenderUser = resolveUser(target, { mentioned, replyTo });
    if (!lenderUser) {
      await sendText(sock, jid, `❌ Lender not found. Try a name, phone number, @mention, or reply to their message.`, msg);
      return;
    }

    if (lenderUser.whatsappId === sender) {
      await sendText(sock, jid, `❌ You can't borrow from yourself!`, msg);
      return;
    }

    const loan = Loan.createMoneyLoan({
      lenderId: lenderUser.whatsappId,
      borrowerId: sender,
      amount,
      days,
      status: 'pending',
    });

    const paybackDate = new Date(loan.dueAt);
    const dateStr = paybackDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    await sendText(sock, jid, ui.card({
      icon: '💰', title: 'Money loan requested',
      rows: [
        ['Lender', `*${lenderUser.name}*`],
        ['Amount', `💲${ui.money(amount)}`],
        ['Interest', `💲${ui.money(loan.interest)} · 10%`],
        ['Total owed', `💲${ui.money(loan.totalOwed)}`],
        ['Payback', `${dateStr} · ${days} days`],
        ['Loan ID', `${loan.id}`],
      ],
      lead: `Waiting on *${lenderUser.name}* to accept.`,
      next: `They use *!loan maccept ${loan.id}* or *!loan mreject ${loan.id}*`,
    }), msg);

    // Notify the lender directly
    try {
      await sendText(sock, lenderUser.whatsappId, ui.card({
        icon: '💰', title: 'Money loan request',
        lead: `*${user.name || sender.split('@')[0]}* wants to borrow *💲${ui.money(amount)}* from you.`,
        rows: [
          ['Interest', `💲${ui.money(loan.interest)} · 10%`],
          ['Total owed', `💲${ui.money(loan.totalOwed)}`],
          ['Payback', `${dateStr} · ${days} days`],
        ],
        next: `Accept: *!loan maccept ${loan.id}* · Reject: *!loan mreject ${loan.id}*`,
      }), msg);
    } catch (e) { /* DM may fail if no chat exists; ignore */ }

    return;
  }

  // !loan maccept [loanID] — lender approves a pending money loan
  // ── !lend @them <amount> — offer money, they accept ──
  if (subcmd === 'lend') {
    const rest = args.slice(1).filter(Boolean);
    const amountTok = rest.find((a) => /^\d[\d,]*$/.test(a));
    const target = rest.find((a) => a !== amountTok) || null;
    const amount = parseInt(String(amountTok || '').replace(/,/g, ''), 10) || 0;
    const days = parseInt(rest.find((a) => a !== amountTok && a !== target)) || 7;

    if (!amount) {
      await sendText(sock, jid, ui.card({
        icon: '💵', title: 'Lend money',
        body: [
          `  *!lend @them 5000*`,
          '',
          `They get 5,000 now and owe you 10% more in 7 days.`,
          `Different length? *!lend @them 5000 14*`,
        ],
        next: 'Nothing leaves your account until they accept.',
      }), msg);
      return;
    }
    if (amount < 1000) { await sendText(sock, jid, `❌ Minimum loan is 1,000.`, msg); return; }
    if (days > 30) { await sendText(sock, jid, `❌ Maximum term is 30 days.`, msg); return; }

    const borrowerUser = resolveUser(target, { mentioned, replyTo });
    if (!borrowerUser) {
      await sendText(sock, jid, `❌ Who are you lending to? Tag them, reply to them, or type their club name.`, msg);
      return;
    }
    if (borrowerUser.whatsappId === sender) {
      await sendText(sock, jid, `😅 You can't lend to yourself.`, msg);
      return;
    }
    if ((user.currency || 0) < amount) {
      await sendText(sock, jid, `❌ You only have ${money(user.currency || 0)}.`, msg);
      return;
    }

    const loan = Loan.createMoneyLoan({
      lenderId: sender,
      borrowerId: borrowerUser.whatsappId,
      amount, days, status: 'pending', initiatedBy: 'lender',
    });

    await sendText(sock, jid, ui.card({
      icon: '💵', title: 'Loan offered',
      rows: [
        ['To', `*${borrowerUser.name}*`],
        ['Amount', `💲${ui.money(amount)}`],
        ['They repay', `💲${ui.money(loan.totalOwed)} in ${days} days`],
        ['Loan ID', `${loan.id}`],
      ],
      next: `They accept with *!loan accept ${loan.id}* — nothing moves until they do.`,
    }), msg, [borrowerUser.whatsappId]);

    try {
      await sendText(sock, borrowerUser.whatsappId, ui.card({
        icon: '💰', title: 'Someone is offering you a loan',
        lead: `*${user.name}* will lend you *💲${ui.money(amount)}*.`,
        rows: [
          ['You repay', `💲${ui.money(loan.totalOwed)} in ${days} days`],
        ],
        next: `Take it: *!loan accept ${loan.id}*  ·  Leave it: *!loan reject ${loan.id}*`,
      }), msg);
    } catch { /* they may not have a DM open */ }
    return;
  }

  if (subcmd === 'maccept') {
    const loanId = args[1];
    if (!loanId) {
      await sendText(sock, jid, `Usage: *!loan maccept [loanID]*`, msg);
      return;
    }

    const loan = Loan.getLoan(loanId);
    if (!loan) {
      await sendText(sock, jid, `❌ Loan not found.`, msg);
      return;
    }
    // A money loan can be started from either side now, so whoever did NOT
    // start it is the one who accepts.
    const awaitingBorrower = loan.initiatedBy === 'lender';
    const whoMustAccept = awaitingBorrower ? loan.borrowerId : loan.lenderId;
    if (whoMustAccept !== sender) {
      await sendText(sock, jid, `❌ That offer isn't yours to accept.`, msg);
      return;
    }

    const result = Loan.acceptMoneyLoan(loanId);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }

    const borrower = User.getByWhatsappId(loan.borrowerId);
    const paybackDate = new Date(result.loan.dueAt);
    const dateStr = paybackDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    await sendText(sock, jid, ui.card({
      icon: '✅', title: 'Money loan approved',
      rows: [
        ['Lent to', `*${borrower?.name || 'Unknown'}*`],
        ['Amount', `💲${ui.money(loan.amount)}`],
        ['Total owed', `💲${ui.money(loan.totalOwed)}`],
        ['Payback', `${dateStr}`],
      ],
      lead: `💳 ${ui.money(loan.amount)} has been sent.`,
    }), msg);

    try {
      await sendText(sock, loan.borrowerId, ui.card({
        icon: '💰', title: 'Money loan approved',
        lead: `*${user.name || sender.split('@')[0]}* accepted your loan request!`,
        rows: [
          ['You received', `💲${ui.money(loan.amount)}`],
          ['Total owed', `💲${ui.money(loan.totalOwed)} by ${dateStr}`],
        ],
        next: `Repay with *!loan mpay ${loan.id} [amount]*`,
      }), msg);
    } catch (e) { /* ignore */ }

    return;
  }

  // !loan mreject [loanID] — lender rejects a pending money loan
  if (subcmd === 'mreject') {
    const loanId = args[1];
    if (!loanId) {
      await sendText(sock, jid, `Usage: *!loan mreject [loanID]*`, msg);
      return;
    }

    const loan = Loan.getLoan(loanId);
    if (!loan) {
      await sendText(sock, jid, `❌ Loan not found.`, msg);
      return;
    }
    if (loan.lenderId !== sender) {
      await sendText(sock, jid, `❌ This loan request wasn't made to you.`, msg);
      return;
    }

    const result = Loan.rejectMoneyLoan(loanId);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }

    const borrower = User.getByWhatsappId(loan.borrowerId);
    await sendText(sock, jid, ui.card({
      icon: '🚫', title: 'Money loan rejected',
      lead: `You declined the request from *${borrower?.name || 'Unknown'}*.`,
      brand: false,
    }), msg);

    try {
      await sendText(sock, loan.borrowerId, ui.card({
        icon: '💔', title: 'Loan request rejected',
        lead: `*${user.name || sender.split('@')[0]}* declined your money loan request.`,
        brand: false,
      }), msg);
    } catch (e) { /* ignore */ }

    return;
  }

  // !loan mpay [loanID] [amount] — repay a money loan
  if (subcmd === 'mpay') {
    const loanId = args[1];
    const amount = parseInt(args[2]) || 0;

    if (!loanId || !amount || amount <= 0) {
      await sendText(sock, jid, `Usage: *!loan mpay [loanID] [amount]*`, msg);
      return;
    }

    const borrower = User.getByWhatsappId(sender);
    if ((borrower.currency || 0) < amount) {
      await sendText(sock, jid, `❌ Insufficient funds. You have ${(borrower.currency/1000).toFixed(0)}K MW.`, msg);
      return;
    }

    const loan = Loan.getLoan(loanId);
    if (!loan) {
      await sendText(sock, jid, `❌ Loan not found.`, msg);
      return;
    }
    if (loan.borrowerId !== sender) {
      await sendText(sock, jid, `❌ This is not your loan.`, msg);
      return;
    }
    if (loan.type !== 'money') {
      await sendText(sock, jid, `❌ This is not a money loan. Use *!loan pay* for player loans.`, msg);
      return;
    }

    const result = Loan.makeMoneyPayment(loanId, amount);
    if (result.error) {
      await sendText(sock, jid, `❌ ${result.error}`, msg);
      return;
    }

    User.update(sender, { currency: (borrower.currency || 0) - amount });
    const lender = User.getByWhatsappId(loan.lenderId);
    if (lender) {
      User.update(loan.lenderId, { currency: (lender.currency || 0) + amount });
    }

    const msg2 = result.completed
      ? ui.card({
          icon: '🎉', title: 'Fully repaid',
          lead: `You paid back *💲${ui.money(amount)}* and cleared the debt entirely.`,
          brand: false,
        })
      : ui.card({
          icon: '✅', title: 'Repayment recorded',
          rows: [
            ['Paid', `💲${ui.money(amount)}`],
            ['Remaining', `💲${ui.money(result.remaining)}`],
          ],
          brand: false,
        });

    await sendText(sock, jid, `${msg2}`, msg);
    return;
  }

  // !loan list — show all money loan offers
  if (subcmd === 'list') {
    const myLoans = Loan.getActiveMoneyLoansByBorrower(sender);
    const lent = Loan.getActiveMoneyLoansByLender(sender);
    const pending = Loan.getPendingMoneyLoansByLender(sender);

    let output = ``;

    if (myLoans.length === 0 && lent.length === 0 && pending.length === 0) {
      output = ui.card({
        icon: '💰', title: 'Money loans',
        body: [
          `No active money loans.`,
          '',
          `• *!loan money [@user] [amount] [days]*`,
          `• *!loan maccept [id]* / *!loan mreject [id]*`,
          `• *!loan mpay [loanID] [amount]*`,
        ],
        next: '!borrow for the quick version.',
      });
    } else {
      if (myLoans.length > 0) {
        output += `📥 *You borrowed:*\n\n`;
        for (const l of myLoans) {
          const lender = User.getByWhatsappId(l.lenderId);
          const daysLeft = Math.max(0, Math.ceil((new Date(l.endDate) - new Date()) / 86400000));
          output += `   • 💲${ui.money(l.amount)} from *${lender?.name || 'Unknown'}*\n`;
          output += `       Owed: 💲${ui.money(l.totalOwed)} · Paid: 💲${ui.money(l.paidAmount)}\n`;
          output += `       Due in: *${daysLeft} days* · ID: ${l.id}\n\n`;
        }
      }
      if (lent.length > 0) {
        output += `📤 *You lent (active):*\n\n`;
        for (const l of lent) {
          const borrower = User.getByWhatsappId(l.borrowerId);
          const daysLeft = Math.max(0, Math.ceil((new Date(l.endDate) - new Date()) / 86400000));
          output += `   • 💲${ui.money(l.amount)} to *${borrower?.name || 'Unknown'}*\n`;
          output += `       Owed: 💲${ui.money(l.totalOwed)} · Paid: 💲${ui.money(l.paidAmount)}\n`;
          output += `       Due in: *${daysLeft} days* · ID: ${l.id}\n\n`;
        }
      }
      if (pending.length > 0) {
        output += `⏳ *Pending requests (you decide):*\n\n`;
        for (const l of pending) {
          const borrower = User.getByWhatsappId(l.borrowerId);
          const dateStr = new Date(l.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          output += `   • 💲${ui.money(l.amount)} from *${borrower?.name || 'Unknown'}*\n`;
          output += `       Owed: 💲${ui.money(l.totalOwed)} · Payback: ${dateStr}\n`;
          output += `       Accept: *!loan maccept ${l.id}* · Reject: *!loan mreject ${l.id}*\n\n`;
        }
      }
      output = `💰 *MONEY LOANS*\n${ui.RULE}\n\n` + output + `\n${ui.RULE}\n${BRAND}`;
    }

    await sendText(sock, jid, output, msg);
    return;
  }

  // Default help
  await sendText(sock, jid, ui.card({
    icon: '📋', title: 'Loan commands',
    body: [
      `*!loan* — view active loans`,
      `*!loan offer [player] [@user] [fee] [rent] [days]*`,
      `*!loan accept [loanID]*`,
      `*!loan pay [loanID] [amount]*`,
      `*!loan return [loanID]*`,
      '',
      `💰 *Money loans:*`,
      `*!loan money [@user] [amount] [days]* — request a loan`,
      `*!loan maccept [id]* / *!loan mreject [id]* — lender decides`,
      `*!loan mpay [loanID] [amount]* — repay`,
      `*!loan list* — view money loans`,
    ],
    next: '⚠️ Unpaid by the due date and the borrower goes NEGATIVE.',
  }), msg);
}

module.exports = { handle: loanCommand };
