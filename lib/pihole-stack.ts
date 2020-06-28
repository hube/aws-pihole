import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2";
import * as logs from "@aws-cdk/aws-logs";

// 6/22/2020 - trying to get volumes mounted correctly on the container
//   Need to add DNS server and other configuration
export class PiholeStack extends cdk.Stack {
  CLIENT_VPN_ENDPOINT_CIDR = "10.1.0.0/16";
  // // Take the second-to-last IP address in the private subnet's IPv4 CIDR block
  // // The last address is reserved by AWS:
  // // https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Subnets.html#vpc-sizing-ipv4
  // // TODO: Look into configuring the subnet CIDR blocks to avoid issues with
  // // hardcoding this IP address
  // DNS_NLB_IP_ADDRESS = "10.0.255.253";
  // // Ports taken from:
  // // https://github.com/pi-hole/docker-pi-hole/#user-content-quick-start
  // PIHOLE_ECS_PORT_MAPPINGS =
  //   [
  //     {
  //       containerPort: 53,
  //       protocol: ecs.Protocol.TCP,
  //     },
  //     {
  //       containerPort: 53,
  //       protocol: ecs.Protocol.UDP,
  //     },
  //     {
  //       containerPort: 67,
  //       protocol: ecs.Protocol.UDP,
  //     },
  //     {
  //       containerPort: 80,
  //       protocol: ecs.Protocol.TCP,
  //     },
  //     {
  //       containerPort: 443,
  //       protocol: ecs.Protocol.TCP,
  //     },
  //   ];
  // PIHOLE_ELB_PORT_MAPPINGS =
  //   [
  //     {
  //       port: 53,
  //       protocol: elb.Protocol.TCP,
  //     },
  //     // AWS does not appear to support IP address target types with UDP load
  //     // balancing: https://github.com/terraform-aws-modules/terraform-aws-alb/issues/132
  //     // {
  //     //   port: 53,
  //     //   protocol: elb.Protocol.TCP_UDP,
  //     // },
  //     // {
  //     //   port: 67,
  //     //   protocol: elb.Protocol.UDP,
  //     // },
  //     {
  //       port: 80,
  //       protocol: elb.Protocol.TCP,
  //     },
  //     {
  //       port: 443,
  //       protocol: elb.Protocol.TCP,
  //     },
  //   ];
  PUBLIC_INTERNET_CIDR = "0.0.0.0/0";
  VPC_CIDR = "10.0.0.0/16"; // same as default, but defining it here for clarity

  // These cannot be provisioned automatically
  VPN_CLIENT_CERTIFICATE_ARN =
    "arn:aws:acm:us-west-2:628178282749:certificate/2dfc2d16-227c-4ba4-9388-602d5d733613";
  VPN_SERVER_CERTIFICATE_ARN =
    "arn:aws:acm:us-west-2:628178282749:certificate/7708232b-1fdf-475a-a67a-669df7207318";

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      cidr: this.VPC_CIDR,
      maxAzs: 1,
      vpnGateway: true,
    });

    // We only have one private subnet
    const privateSubnet = vpc.privateSubnets[0];

    this.defineVpnResources(vpc, privateSubnet);

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

    // container.addPortMappings(...this.PIHOLE_ECS_PORT_MAPPINGS);

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

    const vpcDefaultSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, "VpcDefaultSecurityGroup", vpc.vpcDefaultSecurityGroup);

    const service = new ecs.FargateService(this, "FargateService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      // TODO: decide if the service belongs in its own security group
      securityGroups: [vpcDefaultSecurityGroup],
    });

    // The CDK does not currently support setting the SubnetMappings property on
    // NLBs.
    // TODO: create GitHub issue or PR
    // const nlb = new class extends elb.NetworkLoadBalancer {
    //   constructor(scope: cdk.Construct, id: string, props: elb.NetworkLoadBalancerProps) {
    //     super(scope, id, props);
    //   }
    // }(this, "NetworkLoadBalancer", {
    //   vpc: vpc,
    // });

    // this.defineDnsNlb(vpc, privateSubnet, service);
  }

  // defineDnsNlb(vpc: ec2.Vpc, privateSubnet: ec2.ISubnet, service: ecs.FargateService) {
  //   const cfnNlb = new elb.CfnLoadBalancer(this, "CfnNetworkLoadBalancer", {
  //     scheme: "internal",
  //     subnetMappings: [{
  //       privateIPv4Address: this.DNS_NLB_IP_ADDRESS,
  //       subnetId: privateSubnet.subnetId,
  //     }],
  //     type: "network",
  //   });

  //   const nlb = elb.NetworkLoadBalancer.fromNetworkLoadBalancerAttributes(this, "NetworkLoadBalancer", {
  //     loadBalancerArn: cfnNlb.ref
  //   });

  //   this.PIHOLE_ELB_PORT_MAPPINGS.forEach((portMapping) => {
  //     const port = portMapping.port;

  //     new elb.NetworkListener(this, `Port${port}NetworkListener`, {
  //       defaultTargetGroups: [
  //         new elb.NetworkTargetGroup(this, `Port${port}NetworkTargetGroup`, {
  //         ...portMapping,
  //         targets: [service],
  //         vpc: vpc,
  //       })],
  //       loadBalancer: nlb,
  //       ...portMapping,
  //     });
  //   });
  // }

  // The CDK does not currently support client VPN configuration, so we must do
  // this ourselves. See https://github.com/aws/aws-cdk/issues/4206
  defineVpnResources(vpc: ec2.Vpc, privateSubnet: ec2.ISubnet) {
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
              clientRootCertificateChainArn: this.VPN_CLIENT_CERTIFICATE_ARN,
            },
          },
        ],
        clientCidrBlock: this.CLIENT_VPN_ENDPOINT_CIDR,
        connectionLogOptions: {
          cloudwatchLogGroup: clientVpnLogGroup.logGroupName,
          enabled: true,
        },
        dnsServers: ["10.0.150.240"], // list of string
        serverCertificateArn: this.VPN_SERVER_CERTIFICATE_ARN,
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
