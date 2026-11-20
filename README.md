# claude-usage-band

**Know how close you are to your 5-hour and 7-day limits, and whether you're on pace, without ever typing `/usage`.**

A slim band that sits right above the Claude Code prompt, always visible, on the terminal and the desktop app. Context usage is left to Claude Code, which now shows it natively.

![claude-usage-band on the desktop app and the terminal, light and dark](docs/preview.png)

<sub>Sample figures, drawn from the mod's own layout. The preview still shows the earlier design.</sub>

## Why you'll want it

- **Never get surprised by a rate limit.** 5-hour and 7-day usage sit next to the prompt, one row.
- **See if you're on pace.** Under each usage bar a thin bar shows how much of the window's time has passed. Usage ahead of time means you'll likely hit the limit before it resets.
- **Know when it resets.** Each limit counts down to its reset: `10m`, `3h12m`, `2d5h`.
- **Zero cost.** Read from what Claude Code already reports. No extra tokens, no network calls.
- **Looks right everywhere.** SVG bars on the desktop app, stacked on a phone, one line of dots (`●●●●○○○○○│○`) in the terminal.

## What you get

```
5h ▇▇▇▇▇░░░░░  41%  97% of time gone · resets in 10m  │  7d ▇▇▇▇▇▇▇▇░░  78%  95% of time gone · resets in 8h40m
```

| Part | Shows |
| --- | --- |
| Usage bar | Percent of the limit used, green below 60%, amber to 85%, red above |
| Time bar (thin, grey) | Percent of the window's time already passed |
| Words | The same time in text, and the countdown to the reset |

In the terminal the line reads `5h ●●●●○○○○○│○  41% · 97% gone · 10m`, the `│` marking the time gone. A narrow terminal drops `97% gone` first, then the countdown.

`--` means there is no reading yet. The band steps aside while a survey is showing.

> On the Claude desktop app the band may draw below the message box rather than above it. The slot is documented as above the prompt, and a mod has no option to change where the host places it.

## Install

You need a recent [Claude Code](https://claude.com/claude-code). Built and tested on **2.1.296**; on an older build (2.1.274, for example) the plugin installs but the band does not appear. Check with `claude --version` and update with `claude update`.

Installing takes two steps: add this repo as a marketplace, then install the plugin from it.

**1. Inside a Claude Code session**

```
/plugin marketplace add twentyTwo/claude-usage-band
/plugin install usage-band@claude-usage-band
```

**Or from a regular terminal**

```bash
claude plugin marketplace add twentyTwo/claude-usage-band
claude plugin install usage-band@claude-usage-band --scope user
```

**2. Reload**

Run `/reload-plugins`, or start a new session. The band appears above the prompt.

`--scope user` loads the band in every session. Leave it off to install for the current project only.

### Update

```bash
claude plugin marketplace update claude-usage-band
```

### Install from a local clone

```bash
git clone https://github.com/twentyTwo/claude-usage-band
claude plugin marketplace add ./claude-usage-band
claude plugin install usage-band@claude-usage-band --scope user
```

Run `/reload-plugins` after editing the files.

## Uninstall

```bash
claude plugin uninstall usage-band@claude-usage-band --scope user
claude plugin marketplace remove claude-usage-band
```

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `colorMode` | `level` | `level`: each limit turns green below 60%, amber to 85%, red above. `fixed`: each limit keeps its own color. |
| `fiveHourColor` | `#f85149` | 5h color in `fixed` mode |
| `sevenDayColor` | `#2da44e` | 7d color in `fixed` mode |
| `terminalGlyphs` | `unicode` | `ascii` draws the terminal line with `#`, `-` and `|`, for fonts that draw `●` `○` `│` double-width |

Change them with `/plugin configure usage-band@claude-usage-band`.

## How it works

`hooks/register.tsx` reads the rate limits from `$.session.usage()` at session start and from the `session.measure` event after that, and keeps the last ones in the plugin's store so a new session starts with figures. A one-minute clock moves the countdowns on. A `ui.render` hook on the `AbovePrompt` component draws the band from that state.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

The tests mount the band on the terminal and desktop surfaces and check the figures, the category chips, fixed-color mode and the survey case.

## License

MIT
