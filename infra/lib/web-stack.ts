// SPAの中身。ビルドしたSPAと config.json を HostingStack のS3に置き、CloudFrontのキャッシュを消す。
// 仕様: docs/01-architecture/README.md「CDKスタック分割」、docs/04-app/README.md「設定(config.json)」「配信(CloudFront)」
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import type { ApiStack } from './api-stack';
import type { AuthStack } from './auth-stack';
import type { HostingStack } from './hosting-stack';
import type { RealtimeStack } from './realtime-stack';

const DIST = path.join(__dirname, '../../app/web/dist');

export interface WebStackProps extends StackProps {
  hosting: HostingStack;
  auth: AuthStack;
  api: ApiStack;
  realtime: RealtimeStack;
}

export class WebStack extends Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    if (!fs.existsSync(path.join(DIST, 'index.html'))) {
      throw new Error('app/web/dist がありません。先に `npm run build:web` でSPAをビルドしてください');
    }
    const { bucket, distribution } = props.hosting;

    // 名前にハッシュの付くファイル(assets/)は長くキャッシュさせる
    const assets = new BucketDeployment(this, 'Assets', {
      sources: [Source.asset(DIST, { exclude: ['index.html'] })],
      destinationBucket: bucket,
      cacheControl: [CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: false,
    });

    // index.html と config.json はキャッシュさせない(デプロイの後すぐに新しい版を使うため)
    const config = {
      apiUrl: props.api.apiUrl,
      webSocketUrl: props.realtime.webSocketUrl,
      cognito: {
        authority: props.auth.userPool.userPoolProviderUrl,
        domain: props.auth.domainBaseUrl,
        clientId: props.auth.webClient.userPoolClientId,
      },
    };
    const pages = new BucketDeployment(this, 'Pages', {
      sources: [Source.asset(DIST, { exclude: ['*', '!index.html'] }), Source.jsonData('config.json', config)],
      destinationBucket: bucket,
      cacheControl: [CacheControl.noCache()],
      prune: false,
      distribution,
      distributionPaths: ['/*'],
    });
    pages.node.addDependency(assets);
  }
}
