import fs from 'node:fs';
import path from 'node:path';
import { fileExists } from '../../engine/context.js';

/** Walk up from `start` until a `.git` entry is found, or return null. */
export function findGitRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 64; i++) {
    if (fileExists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function resolveGitDir(repoDir: string): string | null {
  const gitPath = path.join(repoDir, '.git');
  if (!fileExists(gitPath)) return null;
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) return gitPath;
    const content = fs.readFileSync(gitPath, 'utf8').trim();
    const m = content.match(/^gitdir:\s*(.+)$/m);
    if (m) return path.resolve(repoDir, m[1].trim());
    return gitPath;
  } catch {
    return null;
  }
}

/** Read remote names and URLs from a git repository's config. */
export function getRemotes(repoDir: string): Record<string, string> {
  const gitDir = resolveGitDir(repoDir);
  if (!gitDir) return {};

  const configPath = path.join(gitDir, 'config');
  if (!fileExists(configPath)) return {};

  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch {
    return {};
  }

  const remotes: Record<string, string> = {};
  let currentRemote: string | null = null;

  for (const line of content.split(/\r?\n/)) {
    const remoteMatch = line.match(/^\[remote "(.+)"\]$/);
    if (remoteMatch) {
      currentRemote = remoteMatch[1];
      continue;
    }
    if (currentRemote) {
      const urlMatch = line.match(/^\s*url\s*=\s*(.+)$/);
      if (urlMatch) {
        remotes[currentRemote] = urlMatch[1].trim();
      }
    }
  }
  return remotes;
}

/** Normalize a git remote URL to canonical `https://github.com/owner/repo`. */
export function normalizeGithubUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');

  const ssh = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return `https://github.com/${ssh[1]}`;

  const https = trimmed.match(/^https?:\/\/github\.com\/(.+?)(?:\.git)?$/i);
  if (https) return `https://github.com/${https[1]}`;

  return trimmed;
}

/** Prefer `origin`, else the first configured remote. */
export function chooseRemoteUrl(remotes: Record<string, string>): string | null {
  if (remotes.origin) return remotes.origin;
  const keys = Object.keys(remotes);
  return keys.length > 0 ? remotes[keys[0]] : null;
}

/** Resolve `project.github` from git remotes in or above `start`, or null. */
export function resolveGithubFromGit(start: string): string | null {
  const repoDir = findGitRoot(start);
  if (!repoDir) return null;

  const remotes = getRemotes(repoDir);
  const rawUrl = chooseRemoteUrl(remotes);
  if (!rawUrl) return null;

  return normalizeGithubUrl(rawUrl);
}
