import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as logs from '@aws-cdk/aws-logs';

// 6/22/2020 - trying to get volumes mounted correctly on the container
//   Need to add DNS server and other configuration
export class PiholeStack extends cdk.Stack {
  CLIENT_VPN_ENDPOINT_CIDR = "10.1.0.0/16";
  PUBLIC_INTERNET_CIDR = "0.0.0.0/0";
  VPC_CIDR = "10.0.0.0/16"; // same as default

  // These cannot be provisioned automatically
  VPN_CLIENT_CERTIFICATE_ARN =
    "arn:aws:acm:us-west-2:628178282749:certificate/2dfc2d16-227c-4ba4-9388-602d5d733613";
  VPN_SERVER_CERTIFICATE_ARN =
    "arn:aws:acm:us-west-2:628178282749:certificate/7708232b-1fdf-475a-a67a-669df7207318";

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      cidr: this.VPC_CIDR,
      maxAzs: 1,
    });

    this.defineVpnResources(vpc);

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: vpc,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'FargateTaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
      // The CDK and CloudFormation do not currently support EFS volumes for
      // Fargate tasks. See https://github.com/aws/aws-cdk/issues/6918
      // volumes: [{ name: 'application_scratch' }],
    });

    const container = taskDefinition.addContainer('Container', {
      // dnsServers: ['127.0.0.1', '1.1.1.1'],
      environment: {
        'TZ': 'America/Los_Angeles',
        // 'WEBPASSWORD': '',
      },
      image: ecs.ContainerImage.fromRegistry('pihole/pihole'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'pihole',
        logRetention: logs.RetentionDays.ONE_MONTH,
      })
    });
    // Setting these causes startup failures
    // container.addMountPoints(
    //   {
    //     containerPath: '/etc/pihole/',
    //     readOnly: false,
    //     sourceVolume: 'application_scratch',
    //   },
    //   {
    //     containerPath: '/etc/dnsmasq.d/',
    //     readOnly: false,
    //     sourceVolume: 'application_scratch',
    //   },
    // );

    const service = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
    });
  }

  // The CDK does not currently support client VPN configuration, so we must do
  // this ourselves. See https://github.com/aws/aws-cdk/issues/4206
  defineVpnResources(vpc: ec2.Vpc) {
    // we only have one subnet
    const privateSubnetId = vpc.privateSubnets[0].subnetId;

    const clientVpnLogGroup = new logs.LogGroup(this, 'ClientVpnLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const clientVpnEndpoint = new ec2.CfnClientVpnEndpoint(this, 'ClientVpnEndpoint', {
      authenticationOptions: [{
        type: "certificate-authentication",
        mutualAuthentication: {
          clientRootCertificateChainArn: this.VPN_CLIENT_CERTIFICATE_ARN,
        },
      }],
      clientCidrBlock: this.CLIENT_VPN_ENDPOINT_CIDR,
      connectionLogOptions: {
        cloudwatchLogGroup: clientVpnLogGroup.logGroupName,
        enabled: true,
      },
      serverCertificateArn: this.VPN_SERVER_CERTIFICATE_ARN,
    });

    const clientVpnAuthorizationRule = new ec2.CfnClientVpnAuthorizationRule(this,
        'ClientVpnAuthorizationRule', {
          authorizeAllGroups: true,
          clientVpnEndpointId: clientVpnEndpoint.ref,
          targetNetworkCidr: this.PUBLIC_INTERNET_CIDR,
        });

    const clientVpnTargetNetworkAssociation = new ec2.CfnClientVpnTargetNetworkAssociation(this,
        'ClientVpnTargetNetworkAssociation', {
          clientVpnEndpointId: clientVpnEndpoint.ref,
          subnetId: privateSubnetId,
        });

    const clientVpnRoute = new ec2.CfnClientVpnRoute(this, 'ClientVpnRoute', {
      clientVpnEndpointId: clientVpnEndpoint.ref,
      destinationCidrBlock: this.PUBLIC_INTERNET_CIDR,
      targetVpcSubnetId: privateSubnetId,
    });
    clientVpnRoute.addDependsOn(clientVpnTargetNetworkAssociation);
  }
}
