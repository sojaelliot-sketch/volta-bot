const db = require('../config/database');
const User = require('./User');
const Player = require('./Player');

const TABLE = 'loans';

function getState() {
  let state = db.findById(TABLE, 'loans');
  if (!state) {
    state = { activeLoans: [], completedLoans: [] };
    db.insert(TABLE, 'loans', state);
  }
  return state;
}

function updateState(patch) {
  return db.update(TABLE, 'loans', patch);
}

function createLoan({ playerId, lenderId, borrowerId, loanFee, weeklyRent, durationDays }) {
  const state = getState();
  const loan = {
    id: `loan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    playerId,
    lenderId,
    borrowerId,
    loanFee,
    weeklyRent,
    durationDays,
    totalOwed: loanFee + (weeklyRent * Math.ceil(durationDays / 7)),
    paidAmount: 0,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + durationDays * 86400000).toISOString(),
    lastPaymentDate: new Date().toISOString(),
    status: 'active',
    payments: [],
  };
  state.activeLoans.push(loan);
  updateState({ activeLoans: state.activeLoans });
  return loan;
}

function getLoan(loanId) {
  const state = getState();
  return state.activeLoans.find(l => l.id === loanId) || null;
}

function getLoansByUser(userId) {
  const state = getState();
  return state.activeLoans.filter(l => l.borrowerId === userId || l.lenderId === userId);
}

function getActiveLoansByBorrower(userId) {
  const state = getState();
  return state.activeLoans.filter(l => l.borrowerId === userId && l.status === 'active');
}

function getLoansByLender(userId) {
  const state = getState();
  return state.activeLoans.filter(l => l.lenderId === userId && l.status === 'active');
}

function makePayment(loanId, amount) {
  const state = getState();
  const idx = state.activeLoans.findIndex(l => l.id === loanId);
  if (idx === -1) return { error: 'Loan not found' };

  const loan = state.activeLoans[idx];
  if (loan.status !== 'active') return { error: 'Loan is not active' };

  loan.paidAmount += amount;
  loan.lastPaymentDate = new Date().toISOString();
  loan.payments.push({ amount, date: new Date().toISOString() });

  if (loan.paidAmount >= loan.totalOwed) {
    loan.status = 'completed';
    state.completedLoans.push(loan);
    state.activeLoans.splice(idx, 1);
  }

  updateState({ activeLoans: state.activeLoans, completedLoans: state.completedLoans });
  return { success: true, remaining: loan.totalOwed - loan.paidAmount, completed: loan.status === 'completed' };
}

function processOverdueLoans() {
  const state = getState();
  const now = new Date();
  const results = [];

  for (let i = state.activeLoans.length - 1; i >= 0; i--) {
    const loan = state.activeLoans[i];
    if (new Date(loan.endDate) < now && loan.status === 'active') {
      const remaining = loan.totalOwed - loan.paidAmount;
      if (remaining > 0) {
        const borrower = User.getByWhatsappId(loan.borrowerId);
        if (borrower) {
          const currentCurrency = borrower.currency || 0;
          User.update(loan.borrowerId, { currency: currentCurrency - remaining });
          results.push({ loanId: loan.id, borrower: loan.borrowerId, penalized: remaining });
        }
      }
      loan.status = 'expired';
      state.completedLoans.push(loan);
      state.activeLoans.splice(i, 1);
    }
  }

  updateState({ activeLoans: state.activeLoans, completedLoans: state.completedLoans });
  return results;
}

function createMoneyLoan({ lenderId, borrowerId, amount, days, status, initiatedBy }) {
  const state = getState();
  const interestRate = 0.10;
  const interest = Math.round(amount * interestRate);
  const totalOwed = amount + interest;
  const paybackDate = new Date(Date.now() + days * 86400000);
  const loan = {
    id: `mloan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'money',
    lenderId,
    borrowerId,
    amount,
    interest,
    totalOwed,
    paidAmount: 0,
    startDate: new Date().toISOString(),
    endDate: paybackDate.toISOString(),
    dueAt: paybackDate.toISOString(),
    lastPaymentDate: new Date().toISOString(),
    status: status || 'pending',
    // Money loans can be started from either side: a borrower asking, or a
    // lender offering. Whoever did NOT start it is the one who must accept.
    initiatedBy: initiatedBy === 'lender' ? 'lender' : 'borrower',
    payments: [],
  };
  state.activeLoans.push(loan);
  updateState({ activeLoans: state.activeLoans });
  return loan;
}

function getPendingMoneyLoansByLender(userId) {
  const state = getState();
  return state.activeLoans.filter(l => l.lenderId === userId && l.type === 'money' && l.status === 'pending');
}

function acceptMoneyLoan(loanId) {
  const state = getState();
  const idx = state.activeLoans.findIndex(l => l.id === loanId);
  if (idx === -1) return { error: 'Loan not found' };

  const loan = state.activeLoans[idx];
  if (loan.type !== 'money') return { error: 'This is not a money loan' };
  if (loan.status !== 'pending') return { error: 'This loan is not pending approval' };

  const lender = User.getByWhatsappId(loan.lenderId);
  if (!lender || (lender.currency || 0) < loan.amount) {
    return { error: 'Lender no longer has enough funds to approve this loan' };
  }

  User.update(loan.lenderId, { currency: (lender.currency || 0) - loan.amount });
  const borrower = User.getByWhatsappId(loan.borrowerId);
  if (borrower) User.update(loan.borrowerId, { currency: (borrower.currency || 0) + loan.amount });

  loan.status = 'active';
  loan.startDate = new Date().toISOString();
  loan.endDate = new Date(Date.now() + (new Date(loan.dueAt).getTime() - new Date(loan.createdAt || loan.startDate).getTime())).toISOString();
  updateState({ activeLoans: state.activeLoans });
  return { success: true, loan };
}

function rejectMoneyLoan(loanId) {
  const state = getState();
  const idx = state.activeLoans.findIndex(l => l.id === loanId);
  if (idx === -1) return { error: 'Loan not found' };

  const loan = state.activeLoans[idx];
  if (loan.type !== 'money') return { error: 'This is not a money loan' };
  if (loan.status !== 'pending') return { error: 'This loan is not pending approval' };

  loan.status = 'rejected';
  state.completedLoans.push(loan);
  state.activeLoans.splice(idx, 1);
  updateState({ activeLoans: state.activeLoans, completedLoans: state.completedLoans });
  return { success: true, loan };
}

// Borrower voluntarily returns a loaned PLAYER to its lender.
function returnPlayer(loanId) {
  const state = getState();
  const idx = state.activeLoans.findIndex(l => l.id === loanId);
  if (idx === -1) return { error: 'Loan not found' };

  const loan = state.activeLoans[idx];
  if (loan.type === 'money') return { error: 'This is not a player loan' };
  if (loan.status !== 'active') return { error: 'Loan is not active' };

  const result = { playerId: loan.playerId, lenderId: loan.lenderId };
  loan.status = 'returned';
  state.completedLoans.push(loan);
  state.activeLoans.splice(idx, 1);
  updateState({ activeLoans: state.activeLoans, completedLoans: state.completedLoans });
  return { success: true, ...result };
}

function getActiveMoneyLoansByBorrower(userId) {
  const state = getState();
  return state.activeLoans.filter(l => l.borrowerId === userId && l.type === 'money' && l.status === 'active');
}

function getActiveMoneyLoansByLender(userId) {
  const state = getState();
  return state.activeLoans.filter(l => l.lenderId === userId && l.type === 'money' && l.status === 'active');
}

function makeMoneyPayment(loanId, amount) {
  const state = getState();
  const idx = state.activeLoans.findIndex(l => l.id === loanId);
  if (idx === -1) return { error: 'Loan not found' };

  const loan = state.activeLoans[idx];
  if (loan.status !== 'active') return { error: 'Loan is not active' };
  if (loan.type !== 'money') return { error: 'This is not a money loan' };

  loan.paidAmount += amount;
  loan.lastPaymentDate = new Date().toISOString();
  loan.payments.push({ amount, date: new Date().toISOString() });

  if (loan.paidAmount >= loan.totalOwed) {
    loan.status = 'completed';
    state.completedLoans.push(loan);
    state.activeLoans.splice(idx, 1);
  }

  updateState({ activeLoans: state.activeLoans, completedLoans: state.completedLoans });
  return { success: true, remaining: Math.max(0, loan.totalOwed - loan.paidAmount), completed: loan.status === 'completed' };
}

function processOverdueMoneyLoans() {
  const state = getState();
  const now = new Date();
  const results = [];

  for (let i = state.activeLoans.length - 1; i >= 0; i--) {
    const loan = state.activeLoans[i];
    if (loan.type !== 'money' || loan.status !== 'active') continue;
    if (new Date(loan.endDate) < now) {
      const remaining = loan.totalOwed - loan.paidAmount;
      if (remaining > 0) {
        const borrower = User.getByWhatsappId(loan.borrowerId);
        if (borrower) {
          const currentCurrency = borrower.currency || 0;
          User.update(loan.borrowerId, { currency: currentCurrency - remaining });
          results.push({ loanId: loan.id, borrower: loan.borrowerId, penalized: remaining });
        }
      }
      loan.status = 'expired';
      state.completedLoans.push(loan);
      state.activeLoans.splice(i, 1);
    }
  }

  updateState({ activeLoans: state.activeLoans, completedLoans: state.completedLoans });
  return results;
}

module.exports = {
  getState,
  createLoan,
  getLoan,
  getLoansByUser,
  getActiveLoansByBorrower,
  getLoansByLender,
  makePayment,
  processOverdueLoans,
  returnPlayer,
  createMoneyLoan,
  getActiveMoneyLoansByBorrower,
  getActiveMoneyLoansByLender,
  getPendingMoneyLoansByLender,
  makeMoneyPayment,
  acceptMoneyLoan,
  rejectMoneyLoan,
  processOverdueMoneyLoans,
};
