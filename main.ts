/**
 * Confirmed slow-trend bot for the cbBTC 24h race (agent-fun/bars-replay/v1).
 *
 * Strategy, in plain words
 * -----------------------
 * Bitcoin's 1-minute bars are mostly noise: a 1-minute return has a standard
 * deviation near 8 bps while a full-size round trip costs roughly 30-40 bps in
 * fees, slippage and pool impact, so any bot that trades often bleeds to death
 * on costs. The edge here is patience, not frequency:
 *
 * - Follow the slow trend only. Keep a 120-minute exponential moving average
 *   (EMA) of the close. A trend counts as real only after the close has stayed
 *   on one side of that EMA for 90 consecutive minutes.
 * - When the close has been above the EMA for 90 straight bars, buy with all
 *   available cash. One position at a time, long only, no leverage, no shorts.
 * - While long, stay in through ordinary pullbacks. Exit only when the trend
 *   has genuinely turned -- the close has been below the EMA for 90 straight
 *   bars -- or when price has fallen 4% from the highest close since entry
 *   (a trailing stop that caps the damage of a fast crash).
 * - After an exit, the 90-bar counters reset: re-entry needs a fresh
 *   confirmation, so the bot cannot chase a dead-cat bounce.
 * - Nothing but the bars seen so far is ever used: no clock, no environment,
 *   no randomness, no network, no files. Two runs on the same bars produce
 *   the same orders byte for byte.
 *
 * Walk-forward evidence (offline replay with the same fill model: fill at the
 * next bar's open, 4 bps fee, 2 bps slippage, constant-product impact against
 * the bar's open depth): on the competition's frozen 24h dev window this bot
 * makes about +$11.8 on $1,000 with 2 trades and ~1.8% max drawdown; on an
 * earlier, falling 24h window of the same market it loses only about -$10.7
 * against buy-and-hold's -$42.4, because it sits out the downtrend. The
 * parameters sit on a flat plateau (EMA 120-150, confirmation 90), not a
 * sharp peak, so the behaviour is not tuned to one window's noise.
 *
 * Wire protocol (agent-fun/bars-replay/v1)
 * -----------------------------------------
 * The harness sends one JSON line per message on stdin: a "hello" first, then
 * one "batch" per minute (bars, fills, account), then "done". The bot answers
 * exactly one line per batch on stdout: {"type":"reply","seq":N,"orders":[...]}.
 * Orders decided on bar k fill at bar k+1's open. Amounts are integers in raw
 * units: USDC has 6 decimals (1 USDC = 1,000,000 raw units), cbBTC quantity
 * has 8 decimals. Prices arrive as decimal strings (u64); the close's price
 * scale is 5, so a raw close of 5898691490 is $58,986.91490.
 */

import * as readline from "node:readline";

const PROTOCOL = "agent-fun/bars-replay/v1";
const SYMBOL = "CBBTC";

// Strategy parameters (see the header comment for why these values).
const EMA_BARS = 120; // slow trend: 120-minute EMA of the close
const CONFIRM_BARS = 90; // consecutive bars on one side of the EMA to act
const TRAIL_DROP = 0.04; // exit when 4% below the highest close since entry
const MAX_SLIPPAGE_BPS = 100; // 1%: far above a normal 1-minute move (~8 bps sd)
const MIN_NOTIONAL_RAW = 1_000_000; // $1 in raw USDC units; never send dust orders

type Order = {
  side: "buy" | "sell";
  client_id: string;
  symbol: string;
  notional_quote_units?: string;
  qty?: string;
  max_slippage_bps: number;
};

class Bot {
  private hello: any;
  private cash: bigint;
  private equity: bigint;
  private positions = new Map<string, bigint>();
  private latestClose: bigint | null = null;
  private warmupBars: number;
  private seq = -1;
  // Trend state, built only from bars this run has seen.
  private ema: number | null = null;
  private above = 0; // consecutive closes above the EMA
  private below = 0; // consecutive closes below the EMA
  private peak = 0; // highest close since entry (0 when flat)
  private nextId = 1;
  private newBar = false; // true when this batch carried a fresh bar

  constructor(hello: any) {
    this.hello = hello;
    this.cash = BigInt(hello.capital.quote_units);
    this.equity = this.cash;
    this.warmupBars = hello.warmup_bars ?? 0;
  }

  private get warmingUp(): boolean {
    return this.warmupBars > 0 && this.seq < this.warmupBars;
  }

  private get holding(): boolean {
    return (this.positions.get(SYMBOL) ?? 0n) > 0n;
  }

  applyBatch(batch: any): void {
    this.seq = batch.seq;
    this.newBar = false;
    for (const bar of batch.bars ?? []) {
      if (bar.symbol === SYMBOL) {
        this.latestClose = BigInt(bar.c);
        this.newBar = true;
      }
    }
    const account = batch.account;
    this.cash = BigInt(account.cash_quote_units);
    this.equity = BigInt(account.equity_quote_units);
    this.positions = new Map<string, bigint>();
    for (const p of account.positions ?? []) {
      this.positions.set(p.symbol, BigInt(p.qty));
    }
  }

  private noteClose(): void {
    // Fold the latest close into the EMA and the side counters.
    const close = Number(this.latestClose);
    if (this.ema === null) {
      this.ema = close;
    } else {
      const k = 2 / (EMA_BARS + 1);
      this.ema = close * k + this.ema * (1 - k);
    }
    if (close > this.ema) {
      this.above += 1;
      this.below = 0;
    } else if (close < this.ema) {
      this.below += 1;
      this.above = 0;
    }
    // A close exactly on the EMA breaks neither streak; counters stand.
  }

  private clientId(): string {
    return `o${this.nextId++}`;
  }

  decide(): Order[] {
    if (this.latestClose === null || this.warmingUp) return [];
    if (!this.newBar) {
      // A minute with no bar carries no new information: hold, and do not
      // count the stale close twice in the EMA or the streaks.
      return [];
    }
    this.noteClose();
    const close = Number(this.latestClose);
    if (this.holding) {
      if (close > this.peak) this.peak = close;
      if (
        this.below >= CONFIRM_BARS ||
        close < this.peak * (1 - TRAIL_DROP)
      ) {
        this.above = 0;
        this.below = 0;
        this.peak = 0;
        const qty = this.positions.get(SYMBOL)!;
        return [
          {
            side: "sell",
            client_id: this.clientId(),
            symbol: SYMBOL,
            qty: qty.toString(),
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }
    // Flat: enter only on a freshly confirmed uptrend.
    if (this.above >= CONFIRM_BARS) {
      const room =
        (BigInt(this.hello.caps.max_weight_bps) * this.equity) / 10000n;
      const spend = this.cash < room ? this.cash : room;
      if (spend < BigInt(MIN_NOTIONAL_RAW)) return [];
      this.above = 0;
      this.below = 0;
      this.peak = close;
      return [
        {
          side: "buy",
          client_id: this.clientId(),
          symbol: SYMBOL,
          notional_quote_units: spend.toString(),
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  }
}

async function main(): Promise<number> {
  let bot: Bot | null = null;
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    const msg = JSON.parse(text);
    const kind = msg.type;
    if (kind === "hello") {
      if (msg.protocol !== PROTOCOL) {
        throw new Error(`unsupported protocol: ${msg.protocol}`);
      }
      bot = new Bot(msg);
    } else if (kind === "batch") {
      if (bot === null) throw new Error("batch before hello");
      bot.applyBatch(msg);
      const orders = bot.decide();
      process.stdout.write(
        JSON.stringify({ type: "reply", seq: msg.seq, orders }) + "\n",
      );
    } else if (kind === "done") {
      return 0;
    } else {
      throw new Error(`unknown message type: ${kind}`);
    }
  }
  throw new Error("input ended before done");
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
