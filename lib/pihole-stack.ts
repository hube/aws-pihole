import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2";
import * as logs from "@aws-cdk/aws-logs";

export interface PiholeStackProps extends cdk.StackProps {
  dnsServerIpAddresses?: string[];
  vpnClientCertificateArn?: string;
  vpnServerCertificateArn?: string;
}

export class PiholeStack extends cdk.Stack {
  CLIENT_VPN_ENDPOINT_CIDR = "10.1.0.0/16";
  PUBLIC_INTERNET_CIDR = "0.0.0.0/0";
  VPC_CIDR = "10.0.0.0/16"; // same as default, but defining it here for clarity

  constructor(scope: cdk.Construct, id: string, props?: PiholeStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      cidr: this.VPC_CIDR,
      maxAzs: 1,
      vpnGateway: true,
    });

    // We only have one private subnet
    const privateSubnet = vpc.privateSubnets[0];

    // Define a client VPN endpoint only when we have setup both a server
    // certificate and a client certificate
    if (props?.vpnServerCertificateArn && props?.vpnClientCertificateArn) {
      this.defineVpnResources(
        vpc,
        privateSubnet,
        props?.vpnServerCertificateArn,
        props?.vpnClientCertificateArn,
        props?.dnsServerIpAddresses
      );
    }

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc: vpc,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "FargateTaskDefinition",
      {
        cpu: 256,
        memoryLimitMiB: 512,
        // The CDK and CloudFormation do not currently support EFS volumes for
        // Fargate tasks. See https://github.com/aws/aws-cdk/issues/6918
        // volumes: [{ name: 'application_scratch' }],
      }
    );

    const container = taskDefinition.addContainer("Container", {
      // dnsServers: ['127.0.0.1', '1.1.1.1'],
      environment: {
        TZ: "America/Los_Angeles",
        // 'WEBPASSWORD': '',
      },
      image: ecs.ContainerImage.fromRegistry("pihole/pihole"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "pihole",
        logRetention: logs.RetentionDays.ONE_MONTH,
      }),
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

    const vpcDefaultSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "VpcDefaultSecurityGroup",
      vpc.vpcDefaultSecurityGroup
    );

    const service = new ecs.FargateService(this, "FargateService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      // TODO: decide if the service belongs in its own security group
      securityGroups: [vpcDefaultSecurityGroup],
    });
  }

  // The CDK does not currently support client VPN configuration, so we must do
  // this ourselves. See https://github.com/aws/aws-cdk/issues/4206
  defineVpnResources(
    vpc: ec2.Vpc,
    privateSubnet: ec2.ISubnet,
    vpnServerCertificateArn: string,
    vpnClientCertificateArn: string,
    dnsServerIpAddresses?: string[]
  ) {
    const clientVpnLogGroup = new logs.LogGroup(this, "ClientVpnLogGroup", {
      // TODO: remove this removal policy when ready for prime time
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const clientVpnEndpoint = new ec2.CfnClientVpnEndpoint(
      this,
      "ClientVpnEndpoint",
      {
        authenticationOptions: [
          {
            type: "certificate-authentication",
            mutualAuthentication: {
              clientRootCertificateChainArn: vpnClientCertificateArn,
            },
          },
        ],
        clientCidrBlock: this.CLIENT_VPN_ENDPOINT_CIDR,
        connectionLogOptions: {
          cloudwatchLogGroup: clientVpnLogGroup.logGroupName,
          enabled: true,
        },
        dnsServers: dnsServerIpAddresses,
        serverCertificateArn: vpnServerCertificateArn,
        vpcId: vpc.vpcId,
      }
    );

    const clientVpnAuthorizationRule = new ec2.CfnClientVpnAuthorizationRule(
      this,
      "ClientVpnAuthorizationRule",
      {
        authorizeAllGroups: true,
        clientVpnEndpointId: clientVpnEndpoint.ref,
        targetNetworkCidr: this.PUBLIC_INTERNET_CIDR,
      }
    );

    const clientVpnTargetNetworkAssociation = new ec2.CfnClientVpnTargetNetworkAssociation(
      this,
      "ClientVpnTargetNetworkAssociation",
      {
        clientVpnEndpointId: clientVpnEndpoint.ref,
        subnetId: privateSubnet.subnetId,
      }
    );

    const clientVpnRoute = new ec2.CfnClientVpnRoute(this, "ClientVpnRoute", {
      clientVpnEndpointId: clientVpnEndpoint.ref,
      destinationCidrBlock: this.PUBLIC_INTERNET_CIDR,
      targetVpcSubnetId: privateSubnet.subnetId,
    });
    clientVpnRoute.addDependsOn(clientVpnTargetNetworkAssociation);
  }
}
