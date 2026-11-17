// 開発に使うリポジトリの main を、公開用のリポジトリへ「公開版(日付)」のコミット1つとして写す。
// 仕様: docs/00-overview/README.md「リポジトリの公開」
// 使い方(リポジトリのルートで): npm run publish-public [-- --dry-run]
//   --dry-run  写す中身を作って差分を見せるだけで、コミットもプッシュもしない
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PUBLIC_REPO = 'tokyo-code-craft/ai-agorawl-public';
const SOURCE_BRANCH = 'main';
/** 写さないファイル(公開用では PR を受け付けないので、PR の自動レビューは要らない) */
const EXCLUDE = ['.github/workflows/claude-code-review.yml'];

const dryRun = process.argv.includes('--dry-run');

const run = (cmd: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv) =>
  execFileSync(cmd, args, { cwd, env: env ?? process.env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (args: string[], cwd?: string, env?: NodeJS.ProcessEnv) => run('git', args, cwd, env);

// 写す元: 手元の main が GitHub の main と同じであること(写したものを、あとで開発の側で見つけられるように)
git(['fetch', 'origin', SOURCE_BRANCH]);
const source = git(['rev-parse', SOURCE_BRANCH]);
if (source !== git(['rev-parse', `origin/${SOURCE_BRANCH}`])) {
  throw new Error(`手元の ${SOURCE_BRANCH} が origin/${SOURCE_BRANCH} と違う。git pull してから写す`);
}

// 作者とコミッター: 写す人の GitHub の noreply のアドレス(個人のアドレスを公開しない)
const user = JSON.parse(run('gh', ['api', 'user'])) as { id: number; login: string };
const email = `${user.id}+${user.login}@users.noreply.github.com`;

const work = mkdtempSync(join(tmpdir(), 'agorawl-public-'));
try {
  const clone = join(work, 'repo');
  run('gh', ['repo', 'clone', PUBLIC_REPO, clone, '--', '--quiet']);
  // 作ったばかりの公開用のリポジトリには、コミットがない
  let empty = false;
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD'], clone);
  } catch {
    empty = true;
  }

  // 公開用の中身を、開発の main のファイルで置き換える(.git 以外を消してから、main のファイルを書き出す)
  for (const name of readdirSync(clone)) if (name !== '.git') rmSync(join(clone, name), { recursive: true, force: true });
  const exported = join(work, 'export');
  git(['worktree', 'add', '--detach', exported, source]);
  try {
    for (const name of readdirSync(exported)) {
      if (name !== '.git') cpSync(join(exported, name), join(clone, name), { recursive: true });
    }
  } finally {
    git(['worktree', 'remove', '--force', exported]);
  }
  for (const path of EXCLUDE) rmSync(join(clone, path), { force: true });
  if (existsSync(join(clone, '.github/workflows')) && readdirSync(join(clone, '.github/workflows')).length === 0) {
    rmSync(join(clone, '.github'), { recursive: true, force: true });
  }

  git(['add', '--all'], clone);
  const changed = git(['status', '--porcelain'], clone);
  if (changed === '') {
    console.log('公開用のリポジトリと同じ中身なので、写すものはない');
    process.exit(0);
  }
  console.log(git(['diff', '--cached', '--stat'], clone).split('\n').slice(-1)[0]);
  if (dryRun) {
    console.log(`--dry-run のため、コミットもプッシュもしない(写す元: ${source.slice(0, 8)}…)`);
    process.exit(0);
  }

  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: user.login,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: user.login,
    GIT_COMMITTER_EMAIL: email,
  };
  git(['commit', '--quiet', '-m', `公開版(${date})`], clone, env);
  git(['push', '--quiet', 'origin', `HEAD:${SOURCE_BRANCH}`], clone);
  console.log(`公開版(${date})を ${PUBLIC_REPO} に写した(写す元: ${source.slice(0, 8)}…)${empty ? '。最初の公開版' : ''}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
