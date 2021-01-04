import * as apigw from '@aws-cdk/aws-apigateway';
import * as lambda from '@aws-cdk/aws-lambda';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ssm from '@aws-cdk/aws-ssm';
import { CfnOutput, Construct, Stack, StackProps } from '@aws-cdk/core';

export class LambdaStack extends Stack {
    /**
     * The URL of the API Gateway endpoint, for use in the integ tests
     */
    public readonly urlOutput: CfnOutput;

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Get SSM parameter for ECR to enable late binding
        const repositoryArn = ssm.StringParameter.valueForStringParameter(this, '/sam/ecr/arn');
        const repositoryName = ssm.StringParameter.valueForStringParameter(this, '/sam/ecr/name');
        // Get ECR based on SSM parameter values
        const ecrRepo = ecr.Repository.fromRepositoryAttributes(this, 'EcrRepo', {
            repositoryArn, repositoryName
        });

        // Get latest docker tag from SAM-Package stage in CodePipeline
        const ssmEcrLatest = ssm.StringParameter.valueForStringParameter(this, '/sam/ecr/latest');
        // Build Lambda function based on the Docker tag
        const dockerHandler = new lambda.DockerImageFunction(this, 'LambdaDocker', {
            code: lambda.DockerImageCode.fromEcr(ecrRepo, { tag: ssmEcrLatest}),  
        })

        // An API Gateway to make the Lambda web-accessible
        const gw = new apigw.RestApi(this, 'Gateway', {
            description: 'Endpoint for a simple Lambda-powered web service',
        });
        const lambdaIntegration = new apigw.LambdaIntegration(dockerHandler, {
            requestTemplates: { "application/json": '{ "statusCode": "200" }' }
        });
        gw.root.addMethod('GET', lambdaIntegration);
        
        this.urlOutput = new CfnOutput(this, 'Url', {
            value: gw.url,
        });
    }
}