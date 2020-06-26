#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { PiholeStack } from "../lib/pihole-stack";

const app = new cdk.App();
new PiholeStack(app, "PiholeStack");
