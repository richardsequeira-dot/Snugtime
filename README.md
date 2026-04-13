# Space Invaders

A fully-featured browser-based Space Invaders game built with vanilla HTML, CSS, and JavaScript — no dependencies, no build step.

## Run

Open `index.html` in a browser, or serve locally:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Stock Analysis Program

This repository now also includes a standalone stock screener:

- Script: `stock_analyzer.py`
- Example input: `sample_stocks.csv`

It ranks stocks using a multi-factor model based on:

- **Income** (dividend yield, EPS growth)
- **Risk** (beta, volatility, debt-to-equity; lower is better)
- **Momentum** (1m/6m/12m returns)
- Plus **Value** and **Quality** factors

### Run

```bash
python3 stock_analyzer.py sample_stocks.csv
```

### Common options

```bash
# show top 5 only
python3 stock_analyzer.py sample_stocks.csv --top 5

# customize factor weights
python3 stock_analyzer.py sample_stocks.csv \
  --weights "income=0.35,risk=0.25,momentum=0.30,value=0.05,quality=0.05"

# export scored results
python3 stock_analyzer.py sample_stocks.csv --output scored_stocks.csv

# sector-neutral ranking (uses sector column)
python3 stock_analyzer.py sample_stocks.csv --sector-neutral

# run backtest (requires date and forward_return_* columns)
python3 stock_analyzer.py sample_backtest_stocks.csv \
  --sector-neutral \
  --backtest \
  --backtest-score-column sector_neutral
```

### Web UI

The web UI lets you upload CSV files and visualize ranking + backtest results:

```bash
python3 stock_web_app.py
```

Then open `http://127.0.0.1:5000`.

In the UI you can:

- Upload any stock CSV
- Toggle sector-neutral ranking
- Customize factor weights
- Run optional backtests
- View bar and line charts for rankings/backtest
- Inspect a sortable-style results table with factor columns

### Input CSV format

Required:

- `ticker`

Optional but used when present:

- Income: `dividend_yield`, `annual_dividend`, `eps_growth_1y`
- Risk: `beta`, `volatility_30d`, `debt_to_equity`
- Momentum: `return_1m`, `return_6m`, `return_12m`
- Value: `earnings_yield`, `pe_ratio`, `fcf_yield`, `price_to_book`
- Quality: `roe`, `profit_margin`, `net_income_growth_1y`
- Other helper columns: `price`, `price_1m_ago`, `price_6m_ago`, `price_12m_ago`, `name`, `sector`
- Backtest columns: `date`, `forward_return_1m` (or `forward_return_3m`, `forward_return_6m`)

The tool derives missing metrics where possible, e.g.:

- `dividend_yield = annual_dividend / price`
- `earnings_yield = 1 / pe_ratio`
- returns from current and lookback prices

Backtest interpretation:

- At each date, stocks are ranked by score into quintiles.
- The report shows top-quintile average return, bottom-quintile average return, and their spread.
- Cumulative long-short and long-only performance are tracked over dates.

## Controls

- **Move**: `Left/Right` arrows or `A/D`
- **Shoot**: `Space`
- **Mute/Unmute**: `M`
- **Start**: `Enter` (from title screen)
- **Restart**: `R` (after game over)

## Features

- **Three enemy tiers**: Grunts (red), Soldiers (purple, aimed shots), Elites (gold, 2 HP)
- **Boss waves**: Every 3rd wave spawns a large boss with an HP bar, sine-wave movement, and spread fire
- **Power-up weapons**: Killed enemies can drop pickups that grant one of three timed weapons:
  - Rapid Fire — doubled fire rate
  - Spread Shot — 3-bullet fan
  - Piercing Laser — shots pass through all enemies
- **Destructible shields**: 4 shield blocks above the player absorb hits and regenerate each wave
- **Combo system**: Chain rapid kills for score multipliers up to x8
- **Particle effects**: Explosions on kills, player hits, and power-up collection
- **Procedural sound**: All SFX generated via Web Audio API oscillators (no audio files needed)
- **Screen shake**: Canvas shake on player hit and boss damage
- **High scores**: Top 5 scores saved to localStorage
- **Title screen**: Animated starfield title with controls reminder
- **Delta-time loop**: Consistent speed across all refresh rates
