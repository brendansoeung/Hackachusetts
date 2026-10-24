# MakeWeight: product rules

MakeWeight is a phone-first web app (PWA) that helps wrestlers and combat athletes cut weight safely and refuel after weigh-ins, using wearable data (WHOOP-style recovery, resting HR, HRV, sleep) or manual entries. Built for Hackachusetts 2026, Healthcare & Biotech track ("Turning wearable data into better healthcare").

## Users and privacy
- The athlete is the only user. There is no coach or parent view, so athletes have no reason to hide or fake numbers.
- Data stays on the athlete's device (localStorage) with an export/import backup. No accounts (cloud sync is a stretch goal).
- The AI coach receives numbers only. Never send name, age, sex, height, school or free-text profile data.
- Goal weight is always typed in by the athlete. Never add weight-class lists (they vary by age, sport, state and allowance).

## Universal safety limits (one set for everyone)
All limits live in #[[file:js/limits.js]]. Never hard-code a safety number anywhere else.
- Fat loss: about 1% of body weight per week. Above 1%/week = yellow ("you may be cutting wrong"). Above 3%/week = red ("mostly water, not fat").
- Water cut: max 5% of body weight, final days only.
- Total safe cut = 1%/week of fat over the fat-loss days + up to 5% water. If the goal is above that, it's red: plan to the safest weight and suggest a higher goal or more time.
- Wearable red flags: recovery < 33%, resting HR 7+ bpm above baseline, sleep performance < 70%. Any red flag eases that day's plan.
- Cut types: short-term = 7 days or less, mid-term = 8 to 35 days, long-term = more than 35 days.

## Never recommend
Forced vomiting, salt/hot baths, saunas/steam rooms, rubber or plastic suits, diuretics, laxatives, spitting, skipping all fluids. The Safety tab explains each one (health risk + why it hurts performance + safer alternative + source). Even though the ISSN allows supervised sauna use for adults, MakeWeight never suggests it because the app is unsupervised and NFHS prohibits these methods for high schoolers.

## Water loading
Allowed only with 4+ water-cut days and a water portion of 2% or more. It must ALWAYS show the warning card: hyponatremia risk and keeping salt normal, research done on adults, NFHS warns against intentional dehydration, never zero fluids, and "MakeWeight and its AI coach are not medical professionals."

## AI coach tone
- Friendly, direct, like an older teammate who knows sports science. Plain words, short answers (under 120 words).
- The rules engine sets every number; the AI explains and advises but never overrides the caps or invents targets.
- Unsafe-method questions: firmly discourage, 1 to 2 lines on health AND performance harm, a safer alternative, and "talk to your athletic trainer or doctor."
- Warning symptoms (dizziness, confusion, fainting, not urinating) mean stop and get help. Self-harm or eating disorder mentions get the 988 Lifeline.
- If the AI fails, show the rules-based briefing instead.

## Sources
Every recommendation cites a source key from #[[file:js/sources.js]]. Only cite sources that were actually checked. Main ones: ISSN position stand (Ricci et al., 2025), Reale et al. 2018 (water loading), NFHS SMAC, CDC MMWR 1998, NATA 2017, MedlinePlus.

## Writing style (UI copy)
Short sentences, plain language a high schooler understands, no hype, no exclamation points. Show status with words and icons, never color alone.
