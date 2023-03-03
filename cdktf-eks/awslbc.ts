import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import * as k8s from "@cdktf/provider-kubernetes"
import * as aws from "@cdktf/provider-aws"
import * as fs from "fs";
import * as path from "path";
import { Construct } from "constructs";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { EksCluster } from "@cdktf/provider-aws/lib/eks-cluster";
import { Fn } from "cdktf";
import { DataAwsCallerIdentity } from "@cdktf/provider-aws/lib/data-aws-caller-identity";

export interface AWSLoadBalancerControllerProps {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
}

export class AWSLoadBalancerController extends Construct {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
    constructor(scope: Construct, id: string, props: AWSLoadBalancerControllerProps) {
        super(scope, id);
        this.k8sProvider = props.k8sProvider;
        this.awsProvider = props.awsProvider;
        this.cluster = props.cluster;

        // Get the aws account in use for the provider
        const awsIdentity = new DataAwsCallerIdentity(this, 'AwsIdentity', {
            provider: this.awsProvider
        });

        // Create iam oidc provider for eks cluster
        const issuerUrl: string = this.cluster.identity.get(0).oidc.get(0).issuer;
        const issuerNoHttps = Fn.replace(this.cluster.identity.get(0).oidc.get(0).issuer, 'https://', '');
        const oidcArn = `arn:aws:iam::${awsIdentity.accountId}:oidc-provider/${issuerNoHttps}`;
        

        new aws.eksIdentityProviderConfig.EksIdentityProviderConfig (this, 'EksIdentityProviderConfig', {
            clusterName: this.cluster.name,
            oidc: {
                clientId: 'sts.amazonaws.com',
                identityProviderConfigName: `cdktf-oidc`,
                issuerUrl: issuerUrl,
            }
        });

        // Create iam policy for aws load balancer controller from ./iam-awslbc/iam-policy.json
        const awslbcPolicyDoc: string = fs.readFileSync(path.join(__dirname, 'iam-awslbc/iam-policy.json'), { encoding: 'utf-8' });
        const awslbcPolicy: aws.iamPolicy.IamPolicy = new aws.iamPolicy.IamPolicy(this, 'AwsLbcPolicy', {
            name: `${this.cluster.name}-awslbc-policy`,
            policy: awslbcPolicyDoc
        });

        // Create the iam service account role for the Load Balancer controller with the above policy arn (have to remove https:// from the url)
        
        

        const awslbcRole = new aws.iamRole.IamRole(this, 'AwsLbcRole', {
            name: `${this.cluster.name}-awslbc-role`,
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Action: 'sts:AssumeRoleWithWebIdentity',
                        Effect: 'Allow',
                        Principal: {
                            Federated: oidcArn,
                        },
                        Condition: {
                            StringEquals: {
                                [`${issuerNoHttps}:aud`]: 'sts.amazonaws.com',
                                [`${issuerNoHttps}:sub`]: 'system:serviceaccount:kube-system:aws-load-balancer-controller',
                            }
                        }
                    },
                ]
            })
        });

        // Attach the above policy to the above role
        new aws.iamRolePolicyAttachment.IamRolePolicyAttachment(this, 'AwsLbcRolePolicyAttachment', {
            policyArn: awslbcPolicy.arn,
            role: awslbcRole.name
        });

        // Create the service account in the kubernetes cluster
        new k8s.serviceAccount.ServiceAccount(this, 'AwsLbcServiceAccount', {
            provider: this.k8sProvider,
            metadata: {
                name: 'aws-load-balancer-controller',
                namespace: 'kube-system',
                labels: {
                    'app.kubernetes.io/name': 'aws-load-balancer-controller',
                    'app.kubernetes.io/component': 'controller'
                },
                annotations: {
                    'eks.amazonaws.com/role-arn': awslbcRole.arn
                }
            }
        });


    }
}