const express = require('express');
const { Octokit } = require('@octokit/rest');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const nodePath = require('path');

dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const PORT = process.env.PORT || 3000;

if (!GITHUB_TOKEN || !OWNER || !REPO) {
  console.warn('Warning: GITHUB_TOKEN, GITHUB_OWNER or GITHUB_REPO not set. API will fail until configured. See server/.env.example');
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve static files (project root)
app.use(express.static(nodePath.join(__dirname, '..')));

app.get('/api/data', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ message: 'Missing path' });

  try {
    const response = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    const data = response.data;
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return res.json({ content, sha: data.sha });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ message: 'File not found' });
    console.error(err);
    return res.status(500).json({ message: 'GitHub API error' });
  }
});

app.post('/api/data', async (req, res) => {
  const { path, content, message } = req.body;
  if (!path || typeof content !== 'string') return res.status(400).json({ message: 'Missing path/content' });

  try {
    // try to get existing file to obtain sha
    let sha;
    try {
      const getRes = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
      sha = getRes.data.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    const encoded = Buffer.from(content, 'utf8').toString('base64');

    const commitRes = await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path,
      message: message || `Update ${path} via app`,
      content: encoded,
      sha,
      branch: BRANCH
    });

    // update local file copy so server stays in sync
    const localPath = nodePath.join(process.cwd(), path);
    fs.mkdirSync(nodePath.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, content, 'utf8');

    return res.json({ ok: true, commit: commitRes.data.commit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'GitHub commit failed' });
  }
});

// List files in a directory (e.g., data/tracks)
app.get('/api/list', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ message: 'Missing path' });

  try {
    const response = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    if (!Array.isArray(response.data)) return res.status(400).json({ message: 'Not a directory' });
    const files = response.data.map(f => ({ name: f.name, path: f.path, sha: f.sha }));
    return res.json({ files });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ message: 'Not found' });
    console.error(err);
    return res.status(500).json({ message: 'GitHub API error' });
  }
});

// Save a single track as its own file under data/tracks/<sanitized-name>.json
app.post('/api/track/save', async (req, res) => {
  let { name, content, message } = req.body;
  if (!name || typeof content !== 'string') return res.status(400).json({ message: 'Missing name/content' });

  const filename = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 120) || 'track';
  const path = `data/tracks/${filename}.json`;

  try {
    let sha;
    try {
      const getRes = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
      sha = getRes.data.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    const encoded = Buffer.from(content, 'utf8').toString('base64');

    const commitRes = await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo: REPO,
      path,
      message: message || `Add/update track ${name}`,
      content: encoded,
      sha,
      branch: BRANCH
    });

    // update local file copy so server stays in sync
    const localPath = nodePath.join(process.cwd(), path);
    fs.mkdirSync(nodePath.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, content, 'utf8');

    return res.json({ ok: true, path, commit: commitRes.data.commit });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'GitHub commit failed' });
  }
});

// Get a single track file by name (sanitized)
app.get('/api/track', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ message: 'Missing name' });
  const filename = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 120) || 'track';
  const path = `data/tracks/${filename}.json`;

  try {
    const response = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: BRANCH });
    const data = response.data;
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return res.json({ content, sha: data.sha, path });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ message: 'Not found' });
    console.error(err);
    return res.status(500).json({ message: 'GitHub API error' });
  }
});

app.listen(PORT, ()=>{
  console.log(`Server running on http://localhost:${PORT}`);
});
