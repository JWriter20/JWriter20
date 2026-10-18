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
import { calculateRank } from "github-readme-stats/src/calculateRank.js";

const USERNAME = "JWriter20";
// Orgs I own. fetchStats only counts repos with ownerAffiliations: OWNER, i.e.
// repos under my personal account, so stars on org repos never show up.
const ORGS = ["CaptchaKraken", "JobHarvest", "CamoufoxCloud"];
const TOKEN = process.env.PAT_1;

if (!TOKEN) {
  console.error("Missing PAT_1 env var (your GitHub token).");
  process.exit(1);
}

// github-readme-stats' fetcher reads only `totalCommitContributions` (public).
// It DROPS `restrictedContributionsCount` (your private commits). We fetch that
// number ourselves with the same token and add it to the card's commit total.
// Fetch the numbers the card's own fetcher can't see with a public token:
//   - restrictedContributionsCount: your PRIVATE commits (last 12 months)
//   - followers: not stored on the stats object by fetchStats, so we read it
//     here to feed the rank accurately (rather than defaulting it to 0).
async function fetchExtraStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `{ user(login:"${USERNAME}"){
        contributionsCollection{ restrictedContributionsCount }
        followers { totalCount }
      } }`,
    }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  const u = json.data.user;
  return {
    restricted: u.contributionsCollection.restrictedContributionsCount,
    followers: u.followers.totalCount,
  };
}

// Sum stargazers across every repo in each org (forks included, matching how
// fetchStats counts my personal repos). Private repos are only visible if the
// token has access to the org.
async function fetchOrgStars(org) {
  let stars = 0;
  let after = null;
  do {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query($org: String!, $after: String) {
          organization(login: $org) {
            repositories(first: 100, after: $after) {
              nodes { stargazerCount }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        variables: { org, after },
      }),
    });
    const json = await res.json();
    if (json.errors || !json.data?.organization) {
      throw new Error(`GraphQL error for org ${org}: ${JSON.stringify(json.errors)}`);
    }
    const repos = json.data.organization.repositories;
    for (const r of repos.nodes) stars += r.stargazerCount;
    after = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null;
  } while (after);
  return stars;
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
const { restricted, followers } = await fetchExtraStats();
stats.totalCommits = publicCommits + restricted;
console.log(
  "commits: %d public + %d private = %d total",
  publicCommits,
  restricted,
  stats.totalCommits,
);

// Add stars from repos owned by my orgs.
const personalStars = stats.totalStars;
const orgStars = await Promise.all(ORGS.map(fetchOrgStars));
stats.totalStars = personalStars + orgStars.reduce((a, b) => a + b, 0);
console.log(
  "stars: %d personal + %s = %d total",
  personalStars,
  ORGS.map((o, i) => `${orgStars[i]} ${o}`).join(" + "),
  stats.totalStars,
);

// fetchStats already computed stats.rank using the PUBLIC commit count only.
// Recompute it with the private-inclusive commit total (and org-inclusive star
// total) so the letter grade matches the numbers shown. NOTE: the rank is a percentile whose commit term saturates
// near ~1000 commits (weight 2 of 11; stars/PRs dominate), so extra commits
// nudge the grade rather than vaulting it.
stats.rank = calculateRank({
  all_commits: includeAllCommits,
  commits: stats.totalCommits,
  prs: stats.totalPRs,
  issues: stats.totalIssues,
  reviews: stats.totalReviews,
  repos: 0, // unused by calculateRank
  stars: stats.totalStars,
  followers,
});
console.log("rank recomputed: %s (top %d%%)", stats.rank.level, Math.round(stats.rank.percentile));

const svg = renderStatsCard(stats, {
  show_icons: true,
  include_all_commits: includeAllCommits,
  theme: "dark",
});

writeFileSync("github-stats.svg", svg);
console.log("Wrote github-stats.svg (totalCommits=%d)", stats.totalCommits);
