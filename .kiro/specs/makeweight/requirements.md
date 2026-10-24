# Requirements: MakeWeight

## Introduction
Wrestlers and combat athletes cut weight with little guidance, often using harmful methods (forced vomiting, salt baths, saunas, fluid restriction), and refuel badly after weigh-ins. Coaches aren't always someone athletes feel safe being honest with. Wearables already collect the signals that show a cut going wrong (recovery, resting HR, HRV, sleep). MakeWeight turns that data into safe, cut-specific guidance for the athlete alone.

Track: Hackachusetts 2026, Healthcare & Biotech, "Turning wearable data into better healthcare."

## Requirement 1: Athlete-only, private PWA
**User story:** As an athlete, I want a private app on my phone so I can be honest about my numbers.
1. WHEN the athlete opens the site on a phone THEN it SHALL be installable to the home screen and open full-screen.
2. The app SHALL store all data on the device (localStorage) and SHALL NOT have a coach or parent view.
3. The app SHALL offer Export and Import of a JSON backup, and SHALL reject invalid backup files with a friendly message.

## Requirement 2: Goal and cut type
**User story:** As an athlete, I want to enter my own goal weight and weigh-in date and get the right kind of plan.
1. The athlete SHALL type their goal weight manually; the app SHALL NOT include weight-class lists.
2. WHEN days to weigh-in are 7 or less THEN the cut SHALL be short-term; 8 to 35 days mid-term; more than 35 days long-term.

## Requirement 3: Universal safety limits
**User story:** As an athlete, I want the app to stop me from cutting dangerously.
1. The plan SHALL target about 1% of body weight per week of fat loss.
2. WHEN a goal needs fat loss faster than 1%/week (up to 3%/week) THEN the verdict SHALL be yellow ("you may be cutting wrong").
3. WHEN a goal needs more than 3%/week, or more than a 5% water cut with no time for fat loss, THEN the verdict SHALL be red and the plan SHALL target the safest reachable weight, suggesting a higher goal or more time.
4. The water cut SHALL never exceed 5% of body weight and SHALL only happen in the final days.
5. Nutrition SHALL never go below carbs 3 g/kg, protein 1.2 g/kg, fat 0.5 g/kg per day (ISSN).

## Requirement 4: Wearable alerts
**User story:** As an athlete, I want warnings when my body says the cut is going wrong.
1. WHEN recovery is below 33%, resting HR is 7+ bpm above baseline, or sleep performance is below 70% THEN the app SHALL show a red alert and ease today's plan.
2. The resting HR baseline SHALL be the athlete's own value or the average of the first 7 days logged.
3. WHEN weekly loss exceeds 1% (fat phase) THEN yellow; above 3% THEN red. WHEN water loss in the water phase exceeds 5% THEN red.
4. WHEN the water cut is over 3% and the recovery window is under 1 hour THEN the app SHALL show a yellow warning.
5. Alerts SHALL re-run every time data is saved (manual or wearable).

## Requirement 5: Weigh-in recovery
**User story:** As an athlete, I want to know exactly how to refuel based on how long I have.
1. The athlete SHALL choose under 1 hour, 1 to 6 hours, or 12+ hours.
2. Under 1 hour SHALL use small electrolyte sips, a small fast-carb snack, an overeating warning and a stop-eating time before warm-up.
3. Carbs SHALL be shown as food examples with grams as secondary text.
4. Amounts SHALL scale with body weight and pounds cut and stay within ISSN limits (ORS 1 to 1.5 L/h, carbs 60 g/h or less, 4 to 7 or 8 to 12 g/kg for 12+ h).
5. Tournament mode SHALL add a between-match fueling plan.

## Requirement 6: Not-recommended methods
1. The app SHALL never recommend forced vomiting, salt baths, saunas/steam rooms, rubber suits, diuretics, laxatives, spitting or skipping all fluids.
2. Each SHALL have a card with health risk, performance cost, a safer alternative and a source.
3. Water loading guidance SHALL always show a warning (hyponatremia, adults-only research, NFHS position, not medical professionals).

## Requirement 7: AI coach
1. The coach SHALL provide a daily briefing that refreshes on new data or a new day, and a chat panel.
2. The rules engine SHALL set every number; the AI SHALL NOT override caps.
3. WHEN asked about an unsafe method THEN the coach SHALL firmly discourage it, explain the health and performance harm, give a safer alternative, and suggest an athletic trainer or doctor.
4. The app SHALL send numbers only (no name or profile) and SHALL show a privacy note before first use.
5. WHEN the AI fails THEN the app SHALL show a rules-based briefing.
6. The public endpoint SHALL validate input, rate-limit per IP and cap output length.

## Requirement 8: Data
1. A demo athlete SHALL use WHOOP API field names (recovery_score, resting_heart_rate, hrv_rmssd_milli, sleep_performance_percentage, strain).
2. Manual entry SHALL support weight, sleep hours, resting HR, and optional HRV, recovery and sleep performance.

## Requirement 9: Sources
Every recommendation SHALL cite a checked source (ISSN 2025, Reale 2018, NFHS, CDC 1998, NATA 2017, MedlinePlus) or be labeled as a MakeWeight guideline.
