import * as cdk from '@aws-cdk/core';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as codepipeline_actions from '@aws-cdk/aws-codepipeline-actions';
import * as codecommit from '@aws-cdk/aws-codecommit';
import * as ecr from '@aws-cdk/aws-ecr';
import * as pipelines from '@aws-cdk/pipelines';
import * as ssm from '@aws-cdk/aws-ssm';
import * as iam from '@aws-cdk/aws-iam';
import { LambdaStage } from './lambda-stage';
import { LinuxBuildImage } from '@aws-cdk/aws-codebuild';

export class CdkSamDockerStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const sourceOutput = new codepipeline.Artifact("SrcOutput");
    const cdkBuildOutput = new codepipeline.Artifact('CdkBuildOutput');

    // ECR repository needed for SAM Docker Images
    const ecrRepo = new ecr.Repository(this, 'EcrRepo', {
      imageScanOnPush: true
    })

    // Lambda stack needs this both values for ECR lookup and to enable late binding
    const ssmEcrArn = new ssm.StringParameter(this, 'SsmEcrArn', {
      parameterName: '/sam/ecr/arn',
      stringValue: ecrRepo.repositoryArn,
    });
    const ssmEcrName = new ssm.StringParameter(this, 'SsmEcrName', {
      parameterName: '/sam/ecr/name',
      stringValue: ecrRepo.repositoryName,
    });

    // CodeCommitRepo with this project
    const codeCommitRepo = new codecommit.Repository(this, 'CodeCommit', {
      repositoryName: 'CdkSamRepo'
    })

    // Initial source action that triggers the pipeline by pushes
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      repository: codeCommitRepo,
      actionName: 'Source',
      output: sourceOutput,
    });

    // CDK Synth action
    const synthAction = new pipelines.SimpleSynthAction({
      installCommands: ['npm install -g aws-cdk', 'cdk --version', 'npm install'],
      synthCommand: 'npm run build && cdk synth',
      sourceArtifact: sourceOutput,
      cloudAssemblyArtifact: cdkBuildOutput,
    });

    // SAM build and package action
    const samAction = new pipelines.ShellScriptAction({
      actionName: 'SAM-Build-and-Package',
      commands: [
        // Current CodeBuild Image contains only aws-sam-cli-1.10.0 version
        'pip install --upgrade pip', 
        'pip install aws-sam-cli==1.15.0', 
        'sam --version', 
        'cd lib/sam-app', 
        'CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)',
        // Login to ECR
        'aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin "$CDK_DEFAULT_ACCOUNT.dkr.ecr.eu-central-1.amazonaws.com"',
        // Build Lambda function 
        'sam build', 
        // Package and push to ECR
        'sam package --image-repository ' + ecrRepo.repositoryUri,
        // Get the latest Docker image from repository        
        'LATEST_IMAGE=$(aws ecr describe-images --repository-name ' + ecrRepo.repositoryName + ' --query "sort_by(imageDetails,& imagePushedAt)[-1].imageTags[0]" --output text)',
        'aws ssm put-parameter --name /sam/ecr/latest --value $LATEST_IMAGE --type String --overwrite'
      ],
      additionalArtifacts: [
        sourceOutput,
      ],
      // this places SAM-action and CDK-Synth in one action group
      runOrder: 1,
      // Docker privileged needed for Lambda
      environment: {
        buildImage: LinuxBuildImage.STANDARD_4_0,
        privileged: true,
      },
      // Additional policies for shell scripting, allowing SSM and ECR actions
      rolePolicyStatements: [
        // Allo ECR login
        new iam.PolicyStatement({
          actions: ['ecr:GetAuthorizationToken'],
          resources: ['*'],
        }),        
        // Allow all acctions for ECR
        new iam.PolicyStatement({
          actions: ['ecr:*'],
          resources: [ecrRepo.repositoryArn],
        }),        
        // Allow all actions for it's own SSM params
        new iam.PolicyStatement({
          actions: ['ssm:PutParameter'],
          resources: ['arn:aws:ssm:*:*:parameter/sam/ecr/*'],
        }),        
      ]
    });
    
    // Build pipeline
    const cp = new codepipeline.Pipeline(this, 'Pipeline');

    cp.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    })
    const synthStage = cp.addStage({
      stageName: 'Synth',
      actions: [synthAction, samAction],
    })

    const cdkPipeline = new pipelines.CdkPipeline(this, 'CdkPipeline', {
      cloudAssemblyArtifact: cdkBuildOutput,
      selfMutating: true,
      codePipeline: cp,
    });

    // Add Lambda Stage
    cdkPipeline.addApplicationStage(
      new LambdaStage(this, 'LambdaStage')
    );

  }
}
