# AWS Pi-hole

[Pi-hole][pi-hole] running on AWS and provisioned with the [AWS CDK][cdk]
(mostly)!

# Features
- Automatically provisions an EC2 container on Fargate running Pi-hole
    - The Pi-hole container is deployed in a private subnet of a VPC so no
      inbound internet access is allowed by default
- Secures the Pi-hole container behind a VPN
- Configures the VPN connection to use Pi-hole as the DNS server

# Caveats

- AWS Client VPN is [expensive][clientvpnpricing]! As of 6/2020, each client VPN
  endpoint association costs at least $0.10 USD per hour and each client VPN
  connection costs at least $0.05 USD per hour, depending on the AWS region you
  use. That's \$72 USD per month just for maintaining the client VPN endpoint
  association alone. Running a VPN in another container (e.g.
  [kylemanna/openvpn][kylemanna/openvpn]) instead of using AWS's
  infrastructure would eliminate this issue.
- Setting up the VPN configuration requires manual work in provisioning CA,
  client, and server certificates as well as in creating and distributing the
  VPN client configuration. Running OpenVPN in another container may also
  reduce some of this manual effort.
- Configuring the VPN DNS server requires provisioning the infrastructure first
  and then updating the VPN configuration with the Pi-hole task IP address. If
  the Pi-hole task is restarted, the VPN DNS configuration is not automatically
  updated with the new task IP address. There may be a way to setup an NLB with
  a fixed private IP address to resolve this issue.
- The Pi-hole container does not have persistent storage because it is not
  currently possible to provision EFS volumes for ECS through CloudFormation
  (and therefore, the CDK). See [aws-cdk#6918][aws-cdk-6918] for details.

# Setting up VPN certs

```sh
$ AWS_PROFILE=
$ CLIENT_DOMAIN_NAME=
$ SERVER_DOMAIN_NAME=
$ ./easyrsa init-pki
$ ./easyrsa build-ca
$ ./easyrsa gen-req $SERVER_DOMAIN_NAME
$ ./easyrsa sign-req server $SERVER_DOMAIN_NAME
$ ./easyrsa gen-req $CLIENT_DOMAIN_NAME
$ ./easyrsa sign-req server $CLIENT_DOMAIN_NAME
$ aws acm import-certificate --certificate fileb://pki/issued/$SERVER_DOMAIN_NAME.crt --private-key fileb://pki/private/$SERVER_DOMAIN_NAME.key --certificate-chain fileb://pki/ca.crt --profile $AWS_PROFILE
$ aws acm import-certificate --certificate fileb://pki/issued/$CLIENT_DOMAIN_NAME.crt --private-key fileb://pki/private/$CLIENT_DOMAIN_NAME.key --certificate-chain fileb://pki/ca.crt --profile $AWS_PROFILE
```

```sh
$ CLIENT_VPN_ENDPOINT_ID=cvpn-endpoint-04cc056c459a8e837
$ aws ec2 export-client-vpn-client-configuration --client-vpn-endpoint-id $CLIENT_VPN_ENDPOINT_ID --output text --profile $AWS_PROFILE > pihole_vpn_config.ovpn
```

[aws-cdk-6918]: https://github.com/aws/aws-cdk/issues/6918
[clientvpnpricing]: https://aws.amazon.com/vpn/pricing/#AWS_Client_VPN_pricing
[cdk]: https://github.com/aws/aws-cdk
[kylemanna/openvpn]: https://hub.docker.com/r/kylemanna/openvpn
[pi-hole]: https://pi-hole.net
