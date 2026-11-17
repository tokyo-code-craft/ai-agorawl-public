// 動作確認用CLI: Cognitoのユーザーでトークンを得て、HTTP APIを呼び、応答を表示する。WebSocketで議論を購読することもできる。
// 仕様: docs/04-app/README.md「HTTP API」「WebSocket API」「認証」(動作確認用のトークン)
// 使い方:
//   AGORAWL_USER=<メールアドレス> AGORAWL_PASSWORD=<パスワード> npm run call-api -- list [limit] [cursor]
//   … npm run call-api -- get <議論ID>
//   … npm run call-api -- create "テーマ" "先攻の立場" "後攻の立場" [maxTurns]
//   … npm run call-api -- watch <議論ID>   (WebSocketで購読し、届いたメッセージを表示する)
//   … npm run call-api -- raw <METHOD> <パス> [本文のJSON] [--no-auth | --token <トークン>]   (認証や検証の確認用)
// 本番スタックには含めない。パスワードはコミットしない。
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { AdminInitiateAuthCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'watch') {
    if (!args[0]) return usage();
    const o = await loadStackOutputs(['AgorawlAuth', 'AgorawlRealtime']);
    return watch(o.WebSocketUrl!, await userToken(o.UserPoolId!, o.UserPoolClientId!), args[0]);
  }
  const outputs = await loadStackOutputs(['AgorawlAuth', 'AgorawlApi']);
  const apiUrl = outputs.ApiUrl!.replace(/\/$/, '');

  let method = 'GET';
  let path: string;
  let body: unknown;
  let auth: 'user' | 'none' | string = 'user';
  switch (command) {
    case 'list': {
      const [limit, cursor] = args;
      const q = new URLSearchParams({ ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}) }).toString();
      path = `/debates${q ? `?${q}` : ''}`;
      break;
    }
    case 'get':
      if (!args[0]) return usage();
      path = `/debates/${encodeURIComponent(args[0])}`;
      break;
    case 'create': {
      const [theme, pro, con, maxTurns] = args;
      if (!theme || !pro || !con) return usage();
      method = 'POST';
      path = '/debates';
      body = { theme, positions: { pro, con }, ...(maxTurns ? { maxTurns: Number(maxTurns) } : {}) };
      break;
    }
    case 'raw': {
      const rest = [...args];
      const noAuth = rest.indexOf('--no-auth');
      if (noAuth >= 0) {
        auth = 'none';
        rest.splice(noAuth, 1);
      }
      const tokenAt = rest.indexOf('--token');
      if (tokenAt >= 0) {
        auth = rest[tokenAt + 1] ?? '';
        rest.splice(tokenAt, 2);
      }
      const [m, p, b] = rest;
      if (!m || !p) return usage();
      method = m.toUpperCase();
      path = p;
      body = b === undefined ? undefined : b;
      break;
    }
    default:
      return usage();
  }

  const token = auth === 'user' ? await userToken(outputs.UserPoolId!, outputs.UserPoolClientId!) : auth === 'none' ? undefined : auth;
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  console.log(`${method} ${path} → ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  if (!res.ok) process.exitCode = 1;
}

/**
 * WebSocketにつないで議論を購読し、届いたメッセージを表示する(仕様: docs/04-app/README.md「WebSocket API」)。
 * 議論が終わった(status が running 以外の debate が届いた)ら終える
 */
function watch(url: string, token: string, debateId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
    const started = Date.now();
    const elapsed = () => `${Math.round((Date.now() - started) / 1000)}秒`;
    // 無通信の切断を防ぐため、5分ごとに ping を送る
    const ping = setInterval(() => ws.send(JSON.stringify({ action: 'ping' })), 5 * 60 * 1000);
    ws.addEventListener('open', () => {
      console.log(`[${elapsed()}] 接続しました。購読します: ${debateId}`);
      ws.send(JSON.stringify({ action: 'subscribe', debateId }));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data)) as { type: string; [k: string]: unknown };
      if (m.type === 'message') {
        const msg = m.message as { turn: number; role: string; content: string; notes?: unknown };
        console.log(`[${elapsed()}] message ターン${msg.turn} ${msg.role}(${msg.content.length}字、作戦メモ${msg.notes ? 'あり' : 'なし'})`);
      } else if (m.type === 'debate') {
        const d = m.debate as { status: string; endReason?: string; verdict?: { winner?: string } };
        console.log(`[${elapsed()}] debate status=${d.status} endReason=${d.endReason ?? '-'} winner=${d.verdict?.winner ?? '-'}`);
        if (d.status !== 'running') ws.close();
      } else {
        console.log(`[${elapsed()}] ${JSON.stringify(m)}`);
      }
    });
    ws.addEventListener('close', (e) => {
      clearInterval(ping);
      console.log(`[${elapsed()}] 切断しました(code ${e.code})`);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearInterval(ping);
      reject(new Error('WebSocketの接続に失敗しました(トークンが誤っている場合も、ここで失敗します)'));
    });
  });
}

/** 管理者用のパスワード認証(ADMIN_USER_PASSWORD_AUTH)でアクセストークンを得る */
async function userToken(userPoolId: string, clientId: string): Promise<string> {
  const username = process.env.AGORAWL_USER;
  const password = process.env.AGORAWL_PASSWORD;
  if (!username || !password) {
    console.error('環境変数 AGORAWL_USER と AGORAWL_PASSWORD を設定してください');
    process.exit(1);
  }
  const res = await new CognitoIdentityProviderClient({}).send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  );
  const token = res.AuthenticationResult?.AccessToken;
  if (!token) throw new Error(`トークンを得られませんでした(${res.ChallengeName ?? '理由不明'})`);
  return token;
}

async function loadStackOutputs(stackNames: string[]): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({});
  const outputs: Record<string, string> = {};
  for (const StackName of stackNames) {
    const res = await cfn.send(new DescribeStacksCommand({ StackName }));
    for (const o of res.Stacks?.[0]?.Outputs ?? []) {
      if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
    }
  }
  return outputs;
}

function usage(): void {
  console.error('使い方: npm run call-api -- <list [limit] [cursor] | get <議論ID> | watch <議論ID> | create "テーマ" "先攻の立場" "後攻の立場" [maxTurns] | raw <METHOD> <パス> [本文] [--no-auth | --token <トークン>]>');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
