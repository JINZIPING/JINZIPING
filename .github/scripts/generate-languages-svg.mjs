import { mkdirSync, writeFileSync } from "node:fs";

const owner =
  process.env.GITHUB_REPOSITORY_OWNER ||
  process.env.GITHUB_REPOSITORY?.split("/")[0];
const token = process.env.GITHUB_TOKEN;

if (!owner) {
  throw new Error("GITHUB_REPOSITORY_OWNER is required");
}

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const languageColors = {
  C: "#555555",
  CSS: "#663399",
  Dockerfile: "#384d54",
  Go: "#00ADD8",
  HTML: "#e34c26",
  JavaScript: "#f1e05a",
  "Jupyter Notebook": "#DA5B0B",
  Lua: "#000080",
  Python: "#3572A5",
  Shell: "#89e051",
  "Vim Script": "#199f4b",
  Other: "#8c959f",
};

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }

  return response.json();
}

async function getRepos() {
  const repos = [];

  for (let page = 1; ; page += 1) {
    const batch = await github(
      `/users/${owner}/repos?per_page=100&type=owner&page=${page}`,
    );

    repos.push(...batch);

    if (batch.length < 100) {
      return repos;
    }
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatBytes(bytes) {
  if (bytes < 1000) {
    return `${bytes} B`;
  }

  return `${(bytes / 1000).toFixed(1)} KB`;
}

function toPercent(value, total) {
  return `${((value / total) * 100).toFixed(2)}%`;
}

function buildSvg(entries, total) {
  const rows = entries.slice(0, 8);
  const otherBytes = entries.slice(8).reduce((sum, item) => sum + item.bytes, 0);

  if (otherBytes > 0) {
    rows.push({ language: "Other", bytes: otherBytes });
  }

  const width = 640;
  const rowHeight = 34;
  const height = 96 + rows.length * rowHeight;
  const chartWidth = 500;
  let offset = 0;

  const segments = rows
    .map((item) => {
      const segmentWidth = Math.max((item.bytes / total) * chartWidth, 2);
      const segment = `<rect x="${70 + offset}" y="58" width="${segmentWidth.toFixed(
        2,
      )}" height="12" fill="${languageColors[item.language] || languageColors.Other}" />`;
      offset += segmentWidth;
      return segment;
    })
    .join("\n");

  const rowSvg = rows
    .map((item, index) => {
      const y = 96 + index * rowHeight;
      const color = languageColors[item.language] || languageColors.Other;
      return `
  <circle cx="80" cy="${y - 5}" r="5" fill="${color}" />
  <text x="96" y="${y}" class="name">${escapeXml(item.language)}</text>
  <text x="440" y="${y}" class="number">${formatBytes(item.bytes)}</text>
  <text x="560" y="${y}" class="number">${toPercent(item.bytes, total)}</text>`;
    })
    .join("\n");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Most Used Languages</title>
  <desc id="desc">Dynamic language usage percentages generated from ${escapeXml(owner)} public GitHub repositories.</desc>
  <style>
    .title { fill: #0969da; font: 600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .label { fill: #57606a; font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .name { fill: #24292f; font: 500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .number { fill: #57606a; font: 500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-anchor: end; }
    @media (prefers-color-scheme: dark) {
      .title { fill: #58a6ff; }
      .label, .number { fill: #8b949e; }
      .name { fill: #c9d1d9; }
    }
  </style>
  <text x="70" y="32" class="title">Most Used Languages</text>
  <text x="440" y="32" class="label" text-anchor="end">Code</text>
  <text x="560" y="32" class="label" text-anchor="end">Share</text>
  <clipPath id="bar"><rect x="70" y="58" width="${chartWidth}" height="12" rx="6" /></clipPath>
  <g clip-path="url(#bar)">
${segments}
  </g>
${rowSvg}
</svg>
`;
}

const repos = await getRepos();
const totals = new Map();

for (const repo of repos) {
  if (repo.fork || repo.archived) {
    continue;
  }

  const languages = await github(`/repos/${owner}/${repo.name}/languages`);

  for (const [language, bytes] of Object.entries(languages)) {
    totals.set(language, (totals.get(language) || 0) + bytes);
  }
}

const entries = [...totals.entries()]
  .map(([language, bytes]) => ({ language, bytes }))
  .sort((a, b) => b.bytes - a.bytes);
const total = entries.reduce((sum, item) => sum + item.bytes, 0);

mkdirSync("dist", { recursive: true });
writeFileSync(
  "dist/most-used-languages.svg",
  buildSvg(entries, total || 1),
  "utf8",
);
