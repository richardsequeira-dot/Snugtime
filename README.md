# Space Invaders

A fully-featured browser-based Space Invaders game built with vanilla HTML, CSS, and JavaScript — no dependencies, no build step.

## Run

Open `index.html` in a browser, or serve locally:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

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
