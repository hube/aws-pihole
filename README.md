# Welcome to your CDK TypeScript project!

This is a blank project for TypeScript development with CDK.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template

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
