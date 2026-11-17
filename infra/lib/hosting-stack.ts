// SPAを配信する入れ物(S3 + CloudFront)。中身は WebStack が置く。
// 仕様: docs/01-architecture/README.md「CDKスタック分割」、docs/04-app/README.md「配信(CloudFront)」
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AllowedMethods, Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export class HostingStack extends Stack {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  /** SPAのオリジン(https://….cloudfront.net)。Cognitoのコールバックと、HTTP APIのCORSに使う */
  readonly webOrigin: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 非公開。CloudFrontだけが読める(オリジンアクセスコントロール)
    this.bucket = new Bucket(this, 'Site', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // 開発初期はDESTROY。本番運用の前にRETAINへ戻す(docs/01-architecture/README.md)
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      },
      defaultRootObject: 'index.html',
      // S3にないパス(/debates/… など)は index.html を返し、画面の切り替えはSPAが行う
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      })),
    });
    this.webOrigin = `https://${this.distribution.distributionDomainName}`;

    new CfnOutput(this, 'WebUrl', { value: `${this.webOrigin}/` });
  }
}
