// Renders the github-readme-stats card to a local SVG using the project's own
// code, run with your PAT so PRIVATE commits are counted. No external host.
//
// This mirrors what github-readme-stats' own api/index.js does, minus the
// Express request/response plumbing. See:
//   node_modules/github-readme-stats/api/index.js
//
// The token is read from PAT_1 (the project's retryer scans for PAT_<n>).
import { writeFileSync } from "node:fs";
import { fetchStats } from "github-readme-stats/src/fetchers/stats.js";
import { renderStatsCard } from "github-readme-stats/src/cards/stats.js";

const USERNAME = "JWriter20";
const TOKEN = process.env.PAT_1;

if (!TOKEN) {
  console.error("Missing PAT_1 env var (your GitHub token).");
  process.exit(1);
}

// github-readme-stats' fetcher reads only `totalCommitContributions` (public).
// It DROPS `restrictedContributionsCount` (your private commits). We fetch that
// number ourselves with the same token and add it to the card's commit total.
async function fetchRestrictedCommits() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `{ user(login:"${USERNAME}"){ contributionsCollection{ restrictedContributionsCount } } }`,
    }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data.user.contributionsCollection.restrictedContributionsCount;
}

// include_all_commits MUST be false here:
//   false -> GraphQL totalCommitContributions, which counts contributions over
//            the last-12-months window.
//   true  -> REST commit-search, which is all-time but PUBLIC-ONLY.
const includeAllCommits = false;

const stats = await fetchStats(
  USERNAME,
  includeAllCommits,
  [], // exclude_repo
  false, // include_merged_pull_requests
  false, // include_discussions
  false, // include_discussions_answers
  undefined, // commits_year (undefined = lifetime contribution window)
);

// Fold private (restricted) commits into the public total the card computed.
const publicCommits = stats.totalCommits;
const restricted = await fetchRestrictedCommits();
stats.totalCommits = publicCommits + restricted;
console.log(
  "commits: %d public + %d private = %d total",
  publicCommits,
  restricted,
  stats.totalCommits,
);

const svg = renderStatsCard(stats, {
  show_icons: true,
  include_all_commits: includeAllCommits,
  theme: "dark",
});

writeFileSync("github-stats.svg", svg);
console.log("Wrote github-stats.svg (totalCommits=%d)", stats.totalCommits);
