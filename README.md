# CDK SAM Docker Pipeline

This project provisions an infrastructure that enables you to develop Docker-based Labmda functions and rollout it with a pipeline

## Motivation

The main driver was a need to combine the best functionality from both worlds:
- Develop and test Docker-based Lambda function with SAM
- Rollout the whole infrastructure with CDK Pipeline

## How it works

### Prerequisites 

Please ensure you have installed all needed tools:
- AWS CLI (https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)
- AWS SAM (https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)

### Installation

Just run 'cdk deploy'.

The key ressources:
- CodeCommit repository 
- ECR Repository
- CodePipeline

#### Create git-user and push to CodeCommit

Please create your git credentials and push this project to the new created CodeCommit repository.

More information about CodeCommit setup you can find here:
https://docs.aws.amazon.com/codecommit/latest/userguide/setting-up.html#setting-up-standard

## Structure

### CDK Project

The following tutorial was used to create the initial CDK project:
https://docs.aws.amazon.com/cdk/latest/guide/codepipeline_example.html

### SAM Project

The whole SAM package was generated directly in the 'lib' project folder using 'sam init --package-type Image'

https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-init.html

## Magic!

The main idea is to use an ECR created by CDK for SAM builds.
This is done by 'SAM-Build-and-Package' shell action in 'Synth' stage:

See 'lib/cdk-sam-docker-stack.ts'
```typescript
// ECR Login
'aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin "$CDK_DEFAULT_ACCOUNT.dkr.ecr.eu-central-1.amazonaws.com"',

// Build Lambda function 
'sam build', 

// Package and push to ECR
'sam package --image-repository ' + ecrRepo.repositoryUri,

// Get the latest Docker image from repository        
'LATEST_IMAGE=$(aws ecr describe-images --repository-name ' + ecrRepo.repositoryName + ' --query "sort_by(imageDetails,& imagePushedAt)[-1].imageTags[0]" --output text)',
'aws ssm put-parameter --name /sam/ecr/latest --value $LATEST_IMAGE --type String --overwrite'
```

The next step is to pull the new created Docker image.
For this we use a temporary value from SSM parameter.

See 'lib/lambda-stack.ts'
```typescript
// Get latest docker tag from SAM-Package stage in CodePipeline
const ssmEcrLatest = ssm.StringParameter.valueForStringParameter(this, '/sam/ecr/latest');

// Build Lambda function based on the Docker tag
const dockerHandler = new lambda.DockerImageFunction(this, 'LambdaDocker', {
   code: lambda.DockerImageCode.fromEcr(ecrRepo, { tag: ssmEcrLatest}),  
})
```





