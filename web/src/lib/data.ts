export type Source = {
  id: string;
  name: string; // display label, e.g. "Reddit"
  host: string; // registrable domain used to fetch the real favicon
  age: string;
  quote: string;
  domain: string; // displayed path, e.g. "reddit.com/r/personalfinance"
};

export type ReviewSeed = {
  id: string;
  title: string;
  confidence: number;
  lead: string;
  why: string[];
  firstVersion: string[];
  scope: string;
  signalCount: number;
  sources: Source[];
};

export type BuildStep = { label: string; done: boolean };

export type BuildingSeed = {
  id: string;
  title: string;
  age: string;
  meta: string;
  steps: BuildStep[];
};

export type BuiltSeed = {
  id: string;
  title: string;
  age: string;
  meta: string;
};

/** Real favicons, pulled from each source's domain (like ChatGPT citations). */
export function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${host}`;
}

export const reviewSeeds: ReviewSeed[] = [
  {
    id: "seed-receipt",
    title: "Roommate Receipt Splitter",
    confidence: 84,
    signalCount: 7,
    lead: "People are repeatedly asking for a simple way to split shared receipts without manually typing every item.",
    why: [
      "Repeated pain found across open-web sources",
      "One clear first interaction",
      "Easy to prototype in a single screen",
      "Useful for students, housemates, freelancers",
    ],
    firstVersion: ["Upload receipt mock", "Assign items", "Split total", "Export summary"],
    scope:
      "A single-page app with mock receipt data, draggable item assignment, and a clean split summary.",
    sources: [
      {
        id: "s1",
        name: "Reddit",
        host: "reddit.com",
        age: "2d",
        quote: "“Does anyone know a simple app for splitting grocery receipts with roommates?”",
        domain: "reddit.com/r/personalfinance",
      },
      {
        id: "s2",
        name: "X",
        host: "x.com",
        age: "3d",
        quote: "“splitting receipts with my flatmates every single week is genuinely painful”",
        domain: "x.com/maya_builds",
      },
      {
        id: "s3",
        name: "GitHub",
        host: "github.com",
        age: "6d",
        quote: "“Feature request: snap a receipt, auto-split the line items.”",
        domain: "github.com/splitkit/issues",
      },
      {
        id: "s4",
        name: "Hacker News",
        host: "news.ycombinator.com",
        age: "6d",
        quote: "“Shared household expenses are still mostly tracked in spreadsheets.”",
        domain: "news.ycombinator.com",
      },
    ],
  },
  {
    id: "seed-subs",
    title: "Subscription Sweeper",
    confidence: 79,
    signalCount: 6,
    lead: "People keep paying for subscriptions they forgot about and want one place to catch and cancel them.",
    why: [
      "Strong, recurring financial frustration online",
      "Clear payoff the moment they see the total",
      "A single dashboard is enough for v1",
      "Appeals to anyone with more than a few subscriptions",
    ],
    firstVersion: ["Import statements", "Detect recurring", "Flag the dead ones", "Draft a cancel note"],
    scope:
      "A single screen that lists detected subscriptions, highlights unused ones, and drafts a cancel message.",
    sources: [
      {
        id: "s1",
        name: "Reddit",
        host: "reddit.com",
        age: "1d",
        quote: "“I just found I’ve paid for two streaming services I never opened in a year.”",
        domain: "reddit.com/r/Frugal",
      },
      {
        id: "s2",
        name: "Hacker News",
        host: "news.ycombinator.com",
        age: "4d",
        quote: "“Subscription creep is the silent budget killer — nothing surfaces it well.”",
        domain: "news.ycombinator.com",
      },
      {
        id: "s3",
        name: "X",
        host: "x.com",
        age: "5d",
        quote: "“why is cancelling a subscription harder than signing up, every single time”",
        domain: "x.com/devnotes",
      },
    ],
  },
  {
    id: "seed-leftovers",
    title: "Leftover Recipe Finder",
    confidence: 73,
    signalCount: 5,
    lead: "People want to type whatever is left in the fridge and instantly get one good thing to cook.",
    why: [
      "Everyday problem with constant fresh demand",
      "One input, one delightful output",
      "Trivial to prototype with mock recipes",
      "Reduces food waste — easy to feel good about",
    ],
    firstVersion: ["List ingredients", "Match recipes", "Pick one", "Show the steps"],
    scope: "A single page where you tag ingredients and get a single, well-formatted recipe card back.",
    sources: [
      {
        id: "s1",
        name: "Reddit",
        host: "reddit.com",
        age: "3d",
        quote: "“I have eggs, spinach and half an onion — what do I even make?”",
        domain: "reddit.com/r/Cooking",
      },
      {
        id: "s2",
        name: "USDA",
        host: "usda.gov",
        age: "1w",
        quote: "“Households throw away nearly a third of the food they buy, often because it’s forgotten.”",
        domain: "usda.gov/foodwaste",
      },
      {
        id: "s3",
        name: "GitHub",
        host: "github.com",
        age: "1w",
        quote: "“Idea: pantry-first recipe search instead of recipe-first shopping.”",
        domain: "github.com/pantry/ideas",
      },
    ],
  },
];

export const initialBuilding: BuildingSeed[] = [
  {
    id: "b-freelance",
    title: "Freelance Invoice Chaser",
    age: "now",
    meta: "11 sources · 79% · Building",
    steps: [
      { label: "Writing spec", done: true },
      { label: "Building prototype", done: true },
      { label: "Publishing cited.md", done: false },
      { label: "Deploying preview", done: false },
    ],
  },
  {
    id: "b-gym",
    title: "Gym Plan Adjuster",
    age: "4m",
    meta: "6 sources · 81% · Building",
    steps: [
      { label: "Writing spec", done: true },
      { label: "Building prototype", done: true },
      { label: "Publishing cited.md", done: true },
      { label: "Deploying preview", done: false },
    ],
  },
];

export const initialBuilt: BuiltSeed[] = [
  { id: "t-feedback", title: "Tiny Feedback Board", age: "2h", meta: "5 sources · 72% · Built" },
  { id: "t-deadline", title: "Student Deadline Radar", age: "1d", meta: "8 sources · 77% · Built" },
];

export function freshBuildSteps(): BuildStep[] {
  return [
    { label: "Writing spec", done: true },
    { label: "Building prototype", done: false },
    { label: "Publishing cited.md", done: false },
    { label: "Deploying preview", done: false },
  ];
}
