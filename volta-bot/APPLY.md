# VOLTA patch — website features + welcome message

## Tests

    test_website 31/31   audit 142 commands, 0 broken   test_fast 96/96
    test_password 31 · test_commentary 33 · test_economy 35 · test_league_ai 25
    test_mentions 24 · test_help 23 · test_match 20

## The site was read-only

It used **11 of the backend's 49 endpoints**. You could look at a squad but not
do anything with it — training, boosting, selling and picking your four were all
WhatsApp-only, so the site was a mirror rather than a second way to play.

**Tap any player** and you now get a full sheet: every stat as a bar, condition,
rarity, level — plus real actions.

- **Train** and **Elite train** — costs money, updates instantly
- **Boost** a stat permanently
- **Put in XI / Drop to bench** — line-up changes from the site
- **Sell** — list him on the transfer market

**Match history** on the Club tab: last four results with colour-coded W/D/L,
opponent, score and MVP, plus a full 25-match view with a season summary.

**High or low** joins slot and coin flip on the Play tab — a big dealt number,
then Higher or Lower.

**Password management** — change it from the site with a live strength meter
that mirrors the bot's rules exactly, so it tells you the same thing before you
submit that the bot would after.

### A bug the tests caught

The new password endpoint called `auth(body.token)` — but the function is named
`authenticate`. It threw `ReferenceError` and returned a 500 for **every**
request. Found by `test_website.js`, which drives all of this over real HTTP
against a live server rather than trusting the code reads correctly.

## The welcome message never tagged anyone

It built the mention from the club **name** — `@Kano Kings` — but WhatsApp only
renders a tag when the body contains `@<number>` **and** the jid is in the
mentions array. So new members were never actually tagged and never notified.
The greeting just scrolled past them.

It also handed a total stranger nine commands, three of which (`!squad`,
`!daily`, `!auction`) do nothing at all until they have registered.

Now: a real tag that pings, one sentence explaining what VOLTA is, and **one**
instruction — send `!start`. The onboarding walkthrough takes it from there.
Returning managers who already have a club get "welcome back, send !squad"
instead of the beginner pitch. Five rotating openers so adding ten people
doesn't print the same line ten times.
