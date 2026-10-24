// Generates data/sample-athlete.json: a demo high school wrestler (113 -> 106 lb,
// 10 days out from states) with 14 days of WHOOP-format wearable data.
// Field names follow the WHOOP developer API (RecoveryScore, SleepScore, CycleScore).
// Run with: node scripts/build-sample.mjs

import { writeFileSync } from 'node:fs';

const H = 3_600_000;

// dayOffset relative to "today" when the demo is loaded.
// [offset, weightLb, recovery%, restingHr, hrvMs, sleepPerf%, hoursAsleep, strain]
const rows = [
  [-13, 113.6, 71, 52, 86.4, 88, 8.3, 13.8],
  [-12, 113.4, 66, 53, 82.1, 84, 7.9, 15.1],
  [-11, 113.8, 74, 51, 90.2, 91, 8.6, 12.4],
  [-10, 113.2, 62, 53, 80.3, 80, 7.6, 15.6],
  [-9, 113.4, 69, 52, 85.0, 86, 8.1, 14.2],
  [-8, 113.2, 73, 51, 88.7, 89, 8.4, 11.9],
  [-7, 113.0, 65, 52, 83.2, 85, 8.0, 14.8], // plan starts: 10 days out from states
  [-6, 112.8, 61, 53, 79.4, 82, 7.7, 15.3],
  [-5, 112.4, 58, 53, 76.1, 79, 7.5, 15.9],
  [-4, 112.2, 55, 54, 72.5, 77, 7.3, 16.2],
  [-3, 111.9, 52, 54, 70.2, 76, 7.2, 15.4],
  [-2, 111.7, 47, 55, 66.0, 73, 7.0, 16.0],
  [-1, 111.6, 41, 56, 60.3, 71, 6.8, 15.7], // water loading starts
  [0, 111.5, 27, 61, 48.1, 62, 6.0, 4.2], // today: recovery crash (day 8 of the cut)
];

const days = rows.map(([dayOffset, weight, rec, rhr, hrv, perf, hours, strain]) => {
  const asleep = Math.round(hours * H);
  const awake = Math.round((0.35 + (100 - perf) / 100) * H * 0.6);
  const light = Math.round(asleep * 0.52);
  const sws = Math.round(asleep * 0.21);
  const rem = asleep - light - sws;
  return {
    dayOffset,
    scale: { weight_lb: weight, note: 'Morning weigh-in from a smart scale or typed in' },
    recovery: {
      score_state: 'SCORED',
      score: {
        user_calibrating: false,
        recovery_score: rec,
        resting_heart_rate: rhr,
        hrv_rmssd_milli: hrv,
        spo2_percentage: 97.4,
        skin_temp_celsius: 33.7,
      },
    },
    sleep: {
      score_state: 'SCORED',
      nap: false,
      score: {
        stage_summary: {
          total_in_bed_time_milli: asleep + awake,
          total_awake_time_milli: awake,
          total_no_data_time_milli: 0,
          total_light_sleep_time_milli: light,
          total_slow_wave_sleep_time_milli: sws,
          total_rem_sleep_time_milli: rem,
          sleep_cycle_count: Math.max(3, Math.round(hours / 1.6)),
          disturbance_count: Math.round(4 + (100 - perf) / 5),
        },
        respiratory_rate: 15.1,
        sleep_performance_percentage: perf,
        sleep_consistency_percentage: Math.max(55, perf - 6),
        sleep_efficiency_percentage: Math.round((asleep / (asleep + awake)) * 1000) / 10,
      },
    },
    cycle: {
      score_state: 'SCORED',
      score: {
        strain,
        kilojoule: Math.round(6500 + strain * 260),
        average_heart_rate: Math.round(rhr + 18 + strain),
        max_heart_rate: Math.round(150 + strain * 2.2),
      },
    },
  };
});

const sample = {
  description:
    'Demo athlete for MakeWeight: a 17-year-old high school wrestler cutting from 113 to 106 lb for states, ' +
    '10 days out at plan start. Wearable fields mirror the WHOOP developer API. All data is made up.',
  profile: { sex: 'male', age: 17, heightIn: 64, trainingLoad: 'hard' },
  goal: { startWeightLb: 113.0, targetWeightLb: 106, startOffsetDays: -7, weighInOffsetDays: 3, recoveryWindow: 'under1h' },
  days,
};

writeFileSync(new URL('../data/sample-athlete.json', import.meta.url), JSON.stringify(sample, null, 2) + '\n');
console.log(`Wrote ${days.length} days to data/sample-athlete.json`);
