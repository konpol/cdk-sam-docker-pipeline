#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkSamDockerStack } from '../lib/cdk-sam-docker-stack';

const app = new cdk.App();
new CdkSamDockerStack(app, 'CdkSamDockerStack');
