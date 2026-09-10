const User = require('../models/User');
const Player = require('../models/Player');
const Loan = require('../models/Loan');
const { sendText } = require('../utils/messaging');
const { money } = require('../utils/formatter');
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
    await sendText(sock, jid,
      `🏦 *LOANS — HOW THEY WORK*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `There are two kinds.\n\n` +
      `*1. Lend a player*\n` +
      `Send one of your players to another manager for a while. They pay you a fee.\n` +
      `  *!loan offer <playerID> @them*\n` +
      `That's it — fee, rent and length get sensible defaults.\n` +
      `Want to set them yourself?\n` +
      `  *!loan offer <playerID> @them <fee> <rent> <days>*\n\n` +
      `*2. Lend money*\n` +
      `  *!loan money @them <amount>*  — offer them cash\n` +
      `  *!borrow <amount>*            — ask the group for cash\n\n` +
      `*Responding to any offer*\n` +
      `  *!loan accept <loanID>*\n` +
      `  *!loan reject <loanID>*\n` +
      `  *!loan pay <loanID> <amount>*\n` +
      `  *!loan return <loanID>*  — send a borrowed player home\n\n` +
      `You don't need to remember which type it is. Paste the loan ID and\n` +
      `the bot works it out.\n\n` +
      `Short forms: *ok* = accept, *no* = reject, *repay* = pay.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // !loan — show active loans
  if (!subcmd) {
    const myLoans = Loan.getActiveLoansByBorrower(sender);
    const lent = Loan.getLoansByLender(sender);

    let output = `📋 *ACTIVE LOANS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (myLoans.length === 0 && lent.length === 0) {
      output += `You have no loans running.\n\n`;
      output += `*Two things you can do:*\n\n`;
      output += `🤝 Lend a player to someone\n`;
      output += `   *!loan offer <playerID> @them*\n`;
      output += `   (get IDs from *!squad*)\n\n`;
      output += `💵 Lend or borrow money\n`;
      output += `   *!loan money @them <amount>*\n`;
      output += `   *!borrow <amount>*\n\n`;
      output += `👀 See what's on offer\n`;
      output += `   *!loan list*\n\n`;
      output += `Confused? Send *!loan help*.\n`;
    } else {
      if (myLoans.length > 0) {
        output += `📥 *Borrowing:*\n`;
        for (const l of myLoans) {
          const player = Player.getById(l.playerId);
          const daysLeft = Math.max(0, Math.ceil((new Date(l.endDate) - new Date()) / 86400000));
          output += `• *${player?.name || l.playerId}*\n`;
          output += `  Loan ID: ${l.id}\n`;
          output += `  Owed: ${(l.totalOwed/1000).toFixed(0)}K | Paid: ${(l.paidAmount/1000).toFixed(0)}K\n`;
          output += `  Days Left: ${daysLeft}\n\n`;
        }
      }
      if (lent.length > 0) {
        output += `📤 *Lending:*\n`;
        for (const l of lent) {
          const player = Player.getById(l.playerId);
          const borrower = User.getByWhatsappId(l.borrowerId);
          const daysLeft = Math.max(0, Math.ceil((new Date(l.endDate) - new Date()) / 86400000));
          output += `• *${player?.name || l.playerId}* → ${borrower?.name || 'Unknown'}\n`;
          output += `  Loan ID: ${l.id}\n`;
          output += `  Owed: ${(l.totalOwed/1000).toFixed(0)}K | Paid: ${(l.paidAmount/1000).toFixed(0)}K\n`;
          output += `  Days Left: ${daysLeft}\n\n`;
        }
      }
    }

    output += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, output, msg);
    return;
  }

  // ── !borrow <amount> — post an open request to the group ──
  if (subcmd === 'request') {
    const amount = parseInt(args[1], 10);
    if (!amount || amount <= 0) {
      await sendText(sock, jid,
        `💵 *BORROW*\n\nAsk the group for a loan:\n  *!borrow 5000*\n\n` +
        `Anyone can answer with *!loan money @you 5000*.\n${BRAND}`, msg);
      return;
    }
    await sendText(sock, jid,
      `🙏 *LOAN WANTED*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `*${user.name}* is asking to borrow *${money(amount)}*.\n\n` +
      `Want to lend it? Send:\n` +
      `  *!loan money @${String(sender).split('@')[0]} ${amount}*\n\n` +
      `You set the terms and they can accept or refuse.\n${BRAND}`, msg);
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
      await sendText(sock, jid,
        `🤝 *LEND A PLAYER*\n\n` +
        `Simplest form — just the player and who gets them:\n` +
        `  *!loan offer <playerID> @them*\n\n` +
        `Fee, rent and length default to something fair based on the\n` +
        `player's rating. To set them yourself:\n` +
        `  *!loan offer <playerID> @them <fee> <rent> <days>*\n\n` +
        `💡 Get player IDs from *!squad*. Send *!loan help* for the full guide.\n${BRAND}`, msg);
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

    await sendText(sock, jid,
      `📤 *LOAN OFFER CREATED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Player: *${player.name}*\n` +
      `To: ${target.name}\n` +
      `Fee: ${(fee/1000).toFixed(0)}K MW | Rent: ${(rent/1000).toFixed(0)}K/week\n` +
      `Duration: ${days} days\n` +
      `Loan ID: ${loan.id}\n\n` +
      `They can accept with *!loan accept ${loan.id}*\n${BRAND}`, msg);
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

    await sendText(sock, jid,
      `✅ *LOAN ACCEPTED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Player: *${player?.name || loan.playerId}*\n` +
      `Fee Paid: ${(loan.loanFee/1000).toFixed(0)}K MW\n` +
      `Duration: ${loan.durationDays} days\n` +
      `Weekly Rent: ${(loan.weeklyRent/1000).toFixed(0)}K MW\n\n` +
      `⚠️ Return player automatically when loan expires!\n` +
      `Use *!loan pay ${loan.id} [amount]* to pay rent\n${BRAND}`, msg);
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
      ? `🎉 *LOAN COMPLETED!* Player ownership returned to lender.`
      : `✅ Payment of ${(amount/1000).toFixed(0)}K MW recorded. Remaining: ${(result.remaining/1000).toFixed(0)}K MW`;

    await sendText(sock, jid, `${msg2}\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
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

    await sendText(sock, jid,
      `✅ *PLAYER RETURNED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*${player?.name || result.playerId}* returned to owner.\n${BRAND}`, msg);
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
      await sendText(sock, jid,
        `💵 *ASK SOMEONE FOR A LOAN*\n\n` +
        `  *!borrow 5000 @them*\n\n` +
        `That asks *them* to lend *you* 5,000. They approve or refuse.\n\n` +
        `Going the other way — you lending to someone else:\n` +
        `  *!lend @them 5000*\n\n` +
        `• 10% interest, 7 days by default (add a number to change it)\n` +
        `• Minimum 1,000 · maximum 30 days\n${BRAND}`, msg);
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

    await sendText(sock, jid,
      `💰 *MONEY LOAN REQUESTED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Lender: *${lenderUser.name}*\n` +
      `Amount: ${money(amount)}\n` +
      `Interest: ${money(loan.interest)} (10%)\n` +
      `Total Owed: ${money(loan.totalOwed)}\n` +
      `Payback Date: *${dateStr}* (${days} days)\n\n` +
      `⏳ Waiting for *${lenderUser.name}* to accept.\n` +
      `Loan ID: ${loan.id}\n` +
      `They can use *!loan maccept ${loan.id}* or *!loan mreject ${loan.id}*\n${BRAND}`, msg);

    // Notify the lender directly
    try {
      await sendText(sock, lenderUser.whatsappId,
        `💰 *MONEY LOAN REQUEST*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*${user.name || sender.split('@')[0]}* wants to borrow ${money(amount)} from you.\n` +
        `Interest: ${money(loan.interest)} (10%) | Total Owed: ${money(loan.totalOwed)}\n` +
        `Payback: ${dateStr} (${days} days)\n\n` +
        `✅ Accept: *!loan maccept ${loan.id}*\n` +
        `❌ Reject: *!loan mreject ${loan.id}*\n${BRAND}`, msg);
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
      await sendText(sock, jid,
        `💵 *LEND MONEY*\n\n  *!lend @them 5000*\n\n` +
        `They get 5,000 now and owe you 10% more in 7 days.\n` +
        `Add a number for a different length: *!lend @them 5000 14*\n${BRAND}`, msg);
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

    await sendText(sock, jid,
      `💵 *LOAN OFFERED*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `To: *${borrowerUser.name}*\n` +
      `Amount: ${money(amount)}\n` +
      `They repay: ${money(loan.totalOwed)} in ${days} days\n\n` +
      `They accept with:\n  *!loan accept ${loan.id}*\n` +
      `Nothing leaves your account until they do.\n${BRAND}`, msg, [borrowerUser.whatsappId]);

    try {
      await sendText(sock, borrowerUser.whatsappId,
        `💰 *SOMEONE IS OFFERING YOU A LOAN*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*${user.name}* will lend you ${money(amount)}.\n` +
        `You'd repay ${money(loan.totalOwed)} within ${days} days.\n\n` +
        `Take it:    *!loan accept ${loan.id}*\n` +
        `Leave it:   *!loan reject ${loan.id}*\n${BRAND}`);
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

    await sendText(sock, jid,
      `✅ *MONEY LOAN APPROVED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Lent to: *${borrower?.name || 'Unknown'}*\n` +
      `Amount: ${money(loan.amount)}\n` +
      `Total Owed by borrower: ${money(loan.totalOwed)}\n` +
      `Payback: ${dateStr}\n\n` +
      `💳 ${money(loan.amount)} has been sent.\n${BRAND}`, msg);

    try {
      await sendText(sock, loan.borrowerId,
        `💰 *MONEY LOAN APPROVED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*${user.name || sender.split('@')[0]}* accepted your loan request!\n` +
        `You received ${money(loan.amount)}.\n` +
        `Total owed: ${money(loan.totalOwed)} by ${dateStr}\n\n` +
        `Repay with *!loan mpay ${loan.id} [amount]*`, msg);
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
    await sendText(sock, jid,
      `❌ *MONEY LOAN REJECTED!*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `You declined the request from *${borrower?.name || 'Unknown'}*.\n${BRAND}`, msg);

    try {
      await sendText(sock, loan.borrowerId,
        `💔 *LOAN REQUEST REJECTED*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*${user.name || sender.split('@')[0]}* rejected your money loan request.\n${BRAND}`, msg);
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
      ? `🎉 *MONEY LOAN FULLY REPAID!* You paid back ${money(amount)} and cleared the debt.`
      : `✅ Repaid ${money(amount)}. Remaining: ${money(result.remaining)}`;

    await sendText(sock, jid, `${msg2}\n━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`, msg);
    return;
  }

  // !loan list — show all money loan offers
  if (subcmd === 'list') {
    const myLoans = Loan.getActiveMoneyLoansByBorrower(sender);
    const lent = Loan.getActiveMoneyLoansByLender(sender);
    const pending = Loan.getPendingMoneyLoansByLender(sender);

    let output = `💰 *MONEY LOANS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (myLoans.length === 0 && lent.length === 0 && pending.length === 0) {
      output += `No active money loans.\n\n`;
      output += `*Commands:*\n`;
      output += `• *!loan money [@user] [amount] [days]*\n`;
      output += `• *!loan maccept [id]* / *!loan mreject [id]*\n`;
      output += `• *!loan mpay [loanID] [amount]*`;
    } else {
      if (myLoans.length > 0) {
        output += `📥 *You Borrowed:*\n`;
        for (const l of myLoans) {
          const lender = User.getByWhatsappId(l.lenderId);
          const daysLeft = Math.max(0, Math.ceil((new Date(l.endDate) - new Date()) / 86400000));
          output += `• ${money(l.amount)} from *${lender?.name || 'Unknown'}*\n`;
          output += `  Owed: ${money(l.totalOwed)} | Paid: ${money(l.paidAmount)}\n`;
          output += `  Due in: ${daysLeft} days | ID: ${l.id}\n\n`;
        }
      }
      if (lent.length > 0) {
        output += `📤 *You Lent (active):*\n`;
        for (const l of lent) {
          const borrower = User.getByWhatsappId(l.borrowerId);
          const daysLeft = Math.max(0, Math.ceil((new Date(l.endDate) - new Date()) / 86400000));
          output += `• ${money(l.amount)} to *${borrower?.name || 'Unknown'}*\n`;
          output += `  Owed: ${money(l.totalOwed)} | Paid: ${money(l.paidAmount)}\n`;
          output += `  Due in: ${daysLeft} days | ID: ${l.id}\n\n`;
        }
      }
      if (pending.length > 0) {
        output += `⏳ *Pending Requests (you decide):*\n`;
        for (const l of pending) {
          const borrower = User.getByWhatsappId(l.borrowerId);
          const dateStr = new Date(l.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          output += `• ${money(l.amount)} from *${borrower?.name || 'Unknown'}*\n`;
          output += `  Owed: ${money(l.totalOwed)} | Payback: ${dateStr}\n`;
          output += `  Accept: *!loan maccept ${l.id}* | Reject: *!loan mreject ${l.id}*\n\n`;
        }
      }
    }

    output += `━━━━━━━━━━━━━━━━━━━━━━━\n${BRAND}`;
    await sendText(sock, jid, output, msg);
    return;
  }

  // Default help
  await sendText(sock, jid,
    `📋 *LOAN COMMANDS*\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `*!loan* — View active loans\n` +
    `*!loan offer [player] [@user] [fee] [rent] [days]*\n` +
    `*!loan accept [loanID]*\n` +
    `*!loan pay [loanID] [amount]*\n` +
    `*!loan return [loanID]*\n\n` +
    `💰 *Money Loans:*\n` +
    `*!loan money [@user] [amount] [days]* — request a loan\n` +
    `*!loan maccept [id]* / *!loan mreject [id]* — lender decides\n` +
    `*!loan mpay [loanID] [amount]* — repay\n` +
    `*!loan list* — View money loans\n\n` +
    `⚠️ If not paid by end date, borrower goes NEGATIVE!\n${BRAND}`, msg);
}

module.exports = { handle: loanCommand };
