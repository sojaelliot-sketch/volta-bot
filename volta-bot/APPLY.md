# VOLTA patch — phase 3: a living league, more goals, house style

## Tests

    test_league_ai 25/25   test_commentary 33/33   test_help 23/23
    test_league 37/37      test_match 20/20        test_economy 35/35
    test_render 24/24      test_newcmds 21/21      test_loanux 12/12
    test_reconnect 15/15   test_onboarding 14/14   test_fast 95-96/96

## The league was scenery

AI clubs had a name and a randomly seeded record, and that was it. Their rows
**never changed**. The table below you was a static picture, and promotion was
decided purely by whether real players happened to be in your division.

They now have a persistent **strength**, scaled to their division — a Division 1
side is genuinely better than a Division 4 one — and they **play each other every
hour**. Every club in a division is shuffled, paired off, and a result simulated.
The table moves under you between your own matches.

Two things I got wrong first and fixed, both caught by the tests:

**No home advantage.** My first version gave the first-named side +3. But pairing
is a shuffle, so "side A" is arbitrary — equal teams finished 40% / 26%, which
would have quietly skewed every table in the game.

**No steep curve.** At the original divisor a 22-point gap left the underdog
winning 0.9% of fixtures. The division was decided the moment strengths were
assigned. Retuned so the favourite is clearly favoured but the underdog still
takes about one game in six.

### New: `!league form`

The division ranked by the **last five results** rather than the season table —
who is playing well right now, not who started well. Works for your own division
or any of `!league form 1` through `4`.

## Three times as many goals

The goal commentary bank went from 6 sequences to **18**. Twelve goals in a single
match now produce twelve different sequences; before, a five-goal game had
already exhausted most of the bank.

The new ones cover goal *types*, not just different words: the poacher's rebound,
the long-range effort, the weak-foot finish, the free header nobody picked up, the
dink, the outside-of-the-boot curler, the scruffy toe-poke over the line, and
punishing a defender's heavy touch.

## The redesign: one house style

Every command used to write its own layout, so the bot looked like ten products
stitched together — different rules, different banners, some shouting in caps,
some ending with the brand and some forgetting.

`utils/ui.js` is now the single set of builders, and it encodes rules rather than
just formatting:

- **One heading per message.** If everything is emphasised, nothing is.
- **Numbers get room.** Values align in a column instead of hiding inside prose.
- **Say what happened before what it cost.**
- **Never end on a dead end.** If there is an obvious next command, name it.
- **Failures state the fix.** "Not enough money" becomes "You have 400, a Pro
  pack costs 800 — try !daily or !hustle first."

Applied to `!daily`, `!hustle` and `!give` as the pattern. Rolling it across the
rest is mechanical now that the builders exist.

    🎁 *Daily claimed*
    ━━━━━━━━━━━━━━━━━━━━━━━
    Day 4 in a row. Keep it going.

    Reward   +2,400
    Streak   🔥 4 days
    Balance  18,900

    _Spend it — !shop, or put it to work with !play_

## Still to do

1. Card access on the website, plus a renderer that drops native canvas
2. Mention and tagging accuracy
3. Rolling the house style across the remaining commands
