# btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/ajidayubi/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/ajidayubi/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A patient trend bot for the cbBTC 24-hour race: it trades Coinbase Wrapped BTC on 1-minute on-chain bars with $1,000 of paper money. It follows only the slow trend — a 120-minute EMA that the close must stay above for 90 straight minutes before it buys — and exits only on a confirmed trend turn or a 4% trailing stop, so it never bleeds on 1-minute noise and round-trip costs. Long only, one position, deterministic, no network, no clock, no randomness.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout: one JSON line per minute in, one reply line out. Grade it locally with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot <repo> --driver docker
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=cbk8hpf3&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
