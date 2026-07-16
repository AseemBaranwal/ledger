// Core Data Types
export interface Exercise {
  k: string; // code (SQ, BSS, etc.)
  r: number[]; // reps per set
  ws?: number[]; // weights per set (per-set tracking)
  w?: number; // legacy: single weight fallback
}

export interface Session {
  id?: string;
  d: string; // date (ISO 8601)
  s?: string; // session code (LA, PU, PL, etc.)
  g?: string; // gym
  ex?: Exercise[]; // exercises for PROGRAM sessions
  n?: string; // notes
  type?: 'PROGRAM' | 'REST'; // session type
  t?: string; // title (for REST sessions)
  items?: RestItem[]; // items for REST sessions
}

export interface RestItem {
  n: string; // activity name
  d: string; // duration
  done?: boolean;
}

export interface BodyScan {
  d: string; // date
  wt?: number; // weight (lb)
  bf?: number; // body fat %
  smm?: number; // skeletal muscle mass
  waist?: number; // waist (in)
  fer?: number; // ferritin
}

// Config Types
export interface ProgramExercise {
  k: string;
  n: string;
  s: number; // sets
  r: number; // reps
  w: number; // starting weight
  u: string; // unit (lb, +lb, reps, in)
  group: 'Legs' | 'Push' | 'Pull' | 'Sprint';
  cue: string;
}

export interface ProgramSession {
  name: string;
  full: string;
  colour: string;
  gym: string;
  day: number;
  cardio?: boolean;
  ex: ProgramExercise[];
}

export interface Program {
  [key: string]: ProgramSession;
}

export interface RestDayConfig {
  t: string; // title
  s: string; // subtitle
  items: RestItem[];
}

export interface RestDays {
  [key: string]: RestDayConfig;
}

export interface Config {
  program: Program;
  restDays: RestDays;
  colours: {
    legs: string;
    push: string;
    pull: string;
    sprint: string;
  };
  schedule: {
    weekDays: number[];
    priority: string[];
    restColour: {
      [key: string]: string;
    };
  };
}

// Notification Types
export type NotificationType = 'success' | 'error' | 'info';

export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  timestamp: number;
}

// Trend Data
export interface TrendPoint {
  x: string; // date or label
  y: number; // value
}

export interface ExerciseTrend {
  exercise: string;
  code: string;
  group: string;
  data: TrendPoint[];
  maxWeight: number;
  maxWeightDelta: number;
}
