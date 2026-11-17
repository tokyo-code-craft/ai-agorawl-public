// WebSocketの $connect のLambdaオーソライザー。クエリの token(Cognitoのアクセストークン)を検証する。
// 仕様: docs/04-app/README.md「認証」(WebSocketのオーソライザー)
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { adminContext } from './logic';

interface AuthorizerEvent {
  methodArn: string;
  queryStringParameters?: Record<string, string | undefined>;
}

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
};

// 署名(Cognitoの公開鍵)、期限、token_use が access、client_id がアプリクライアントのIDであることを確かめる
const verifier = CognitoJwtVerifier.create({
  userPoolId: env('USER_POOL_ID'),
  clientId: env('USER_POOL_CLIENT_ID'),
  tokenUse: 'access',
});

export async function handler(event: AuthorizerEvent) {
  const token = event.queryStringParameters?.token;
  if (!token) throw new Error('Unauthorized');
  let sub: string;
  let admin: 'true' | 'false';
  try {
    const payload = await verifier.verify(token);
    sub = payload.sub;
    admin = adminContext(payload['cognito:groups']);
  } catch {
    // オーソライザーが Unauthorized を投げると、API Gatewayは接続を401で拒む
    throw new Error('Unauthorized');
  }
  return {
    principalId: sub,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: event.methodArn }],
    },
    // 管理者かどうかは、各ルート(subscribe など)の requestContext.authorizer に渡る(docs/04-app/README.md「認証」)
    context: { sub, admin },
  };
}
