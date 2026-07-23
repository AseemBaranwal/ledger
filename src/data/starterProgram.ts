import type { Config } from '@/types'

// Seeded into a brand-new user's `profiles.routine_config` on first sign-in
// (see configStore.ts's loadOrSeedProgram) — a generic, usable-on-day-one
// program instead of a blank slate or the app owner's own personal routine.
// Fully editable afterward via the exercise swap/add picker already built
// for this app; nothing about this template is special-cased.
//
// Exercise codes are real Strava exercise_type constants (not short
// abbreviations like the codes elsewhere in this codebase use) — this
// means Strava posting resolves every exercise correctly with zero extra
// mapping work, the same trick the exercise-swap picker already relies on
// (see api/_lib/stravaMapping.ts's stravaExerciseTypeForCode: a code that's
// already a valid Strava type passes through unchanged).
export const STARTER_PROGRAM: Config = {
  program: {
    PUSH: {
      name: 'Push',
      full: 'Push — Chest, Shoulders, Triceps',
      colour: 'push',
      gym: 'Gym',
      day: 1,
      ex: [
        {
          k: 'BARBELL_BENCH_PRESS', n: 'Barbell Bench Press', s: 4, r: 8, w: 45, u: 'lb', group: 'Push',
          cue: 'Feet planted, shoulder blades pulled back. Control it down, drive it up.',
        },
        {
          k: 'OVERHEAD_BARBELL_PRESS', n: 'Overhead Press', s: 3, r: 8, w: 45, u: 'lb', group: 'Push',
          cue: 'Brace your core and press straight overhead without arching your lower back.',
        },
        {
          k: 'INCLINE_DUMBBELL_BENCH_PRESS', n: 'Incline Dumbbell Press', s: 3, r: 10, w: 20, u: 'lb', group: 'Push',
          cue: 'Squeeze at the top, control the way down.',
        },
        {
          k: 'CABLE_LATERAL_RAISE', n: 'Lateral Raise', s: 3, r: 15, w: 10, u: 'lb', group: 'Push',
          cue: 'Light weight, strict form — lead with your elbows, not your hands.',
        },
        {
          k: 'TRICEPS_PRESSDOWN', n: 'Triceps Pushdown', s: 3, r: 12, w: 30, u: 'lb', group: 'Push',
          cue: 'Keep your elbows pinned to your sides through the whole set.',
        },
      ],
    },
    PULL: {
      name: 'Pull',
      full: 'Pull — Back, Biceps',
      colour: 'pull',
      gym: 'Gym',
      day: 3,
      ex: [
        {
          k: 'BARBELL_DEADLIFT', n: 'Deadlift', s: 3, r: 5, w: 95, u: 'lb', group: 'Pull',
          cue: 'Flat back, bar close to your shins, drive through your heels.',
        },
        {
          k: 'PULL_UP_GENERIC', n: 'Pull-Up', s: 3, r: 6, w: 0, u: 'reps', group: 'Pull',
          cue: 'Full range — dead hang to chin over the bar.',
        },
        {
          k: 'BENT_OVER_BARBELL_ROW', n: 'Barbell Row', s: 3, r: 10, w: 65, u: 'lb', group: 'Pull',
          cue: 'Hinge at the hips, pull to your lower ribs, no jerking.',
        },
        {
          k: 'FACE_PULL', n: 'Face Pulls', s: 3, r: 15, w: 25, u: 'lb', group: 'Pull',
          cue: 'Elbows high, pull to your face, squeeze your rear delts.',
        },
        {
          k: 'BARBELL_BICEPS_CURL', n: 'Barbell Curl', s: 3, r: 10, w: 30, u: 'lb', group: 'Pull',
          cue: 'No swinging — strict elbows pinned at your sides.',
        },
      ],
    },
    LEGS: {
      name: 'Legs',
      full: 'Legs — Quads, Hamstrings, Glutes',
      colour: 'legs',
      gym: 'Gym',
      day: 5,
      ex: [
        {
          k: 'BARBELL_BACK_SQUAT', n: 'Back Squat', s: 4, r: 6, w: 65, u: 'lb', group: 'Legs',
          cue: 'Sit back and down, knees tracking over your toes, chest up.',
        },
        {
          k: 'BARBELL_ROMANIAN_DEADLIFT', n: 'Romanian Deadlift', s: 3, r: 10, w: 65, u: 'lb', group: 'Legs',
          cue: 'Hinge at the hips, soft knees, feel it in your hamstrings.',
        },
        {
          k: 'LEG_PRESS', n: 'Leg Press', s: 3, r: 12, w: 90, u: 'lb', group: 'Legs',
          cue: "Don't lock your knees out hard at the top.",
        },
        {
          k: 'STANDING_CALF_RAISE', n: 'Standing Calf Raise', s: 4, r: 15, w: 45, u: 'lb', group: 'Legs',
          cue: 'Full stretch at the bottom, pause at the top.',
        },
        {
          k: 'MACHINE_LEG_CURL_SEATED', n: 'Seated Leg Curl', s: 3, r: 12, w: 40, u: 'lb', group: 'Legs',
          cue: "Slow and controlled — don't let the weight stack slam.",
        },
      ],
    },
  },
  restDays: {},
  colours: { legs: '#00C2A8', push: '#4C9BE8', pull: '#B57CF6', sprint: '#FF6B4A' },
  schedule: { weekDays: [1, 2, 3, 4, 5, 6, 0], priority: ['PUSH', 'PULL', 'LEGS'], restColour: {} },
}
