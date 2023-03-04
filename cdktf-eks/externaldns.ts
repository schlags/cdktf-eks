import { EksCluster } from "@cdktf/provider-aws/lib/eks-cluster";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import { Construct } from "constructs";
import { Fn } from "cdktf";
import * as fs from 'fs';
import * as path from 'path';
import * as aws from "@cdktf/provider-aws"
import * as k8s from "@cdktf/provider-kubernetes"
import { DataAwsCallerIdentity } from "@cdktf/provider-aws/lib/data-aws-caller-identity";


export interface ExternalDNSProps {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
}

export class ExternalDNS extends Construct {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
    constructor(scope: Construct, id: string, props: ExternalDNSProps) {
        super(scope, id);
        this.k8sProvider = props.k8sProvider;
        this.awsProvider = props.awsProvider;
        this.cluster = props.cluster;

        // TODO: put eks iam service account creation into a separate construct

        // Create variables for OIDC provider urls (with and without https:// and in arn format)

        const awsIdentity = new DataAwsCallerIdentity(this, 'AwsIdentity', {
            provider: this.awsProvider
        });
        // const issuerUrl: string = this.cluster.identity.get(0).oidc.get(0).issuer;
        const issuerNoHttps = Fn.replace(this.cluster.identity.get(0).oidc.get(0).issuer, 'https://', '');
        const oidcArn = `arn:aws:iam::${awsIdentity.accountId}:oidc-provider/${issuerNoHttps}`;

        // Create the IAM service account for external dns
        // Step 1: Create the IAM policy (document and policy itself)

        const externalDNSPolicyDoc: string = fs.readFileSync(path.join(__dirname, 'iam-policy-docs/externaldns-policy.json'), 'utf8');
        const externalDNSPolicy = new aws.iamPolicy.IamPolicy(this, 'ExternalDNSPolicy', {
            name: `${this.cluster.name}-externaldns-policy`,
            description: `IAM policy for ExternalDNS service account in ${this.cluster.name} EKS cluster`,
            policy: externalDNSPolicyDoc
        });

        // Step 2: Create the IAM role

        const externalDNSRole = new aws.iamRole.IamRole(this, 'ExternalDNSRole', {
            name: `${this.cluster.name}-externaldns-role`,
            description: `IAM role for ExternalDNS service account in ${this.cluster.name} EKS cluster`,
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
                                [`${issuerNoHttps}:sub`]: 'system:serviceaccount:default:external-dns',
                            }
                        }
                    },
                ]
            }),
            dependsOn: []
        });

        // Step 3: Attach the IAM policy to the IAM role

        new aws.iamRolePolicyAttachment.IamRolePolicyAttachment(this, 'ExternalDNSRolePolicyAttachment', {
            role: externalDNSRole.name,
            policyArn: externalDNSPolicy.arn
        });

        // Step 4: Create the Service Account in the Kubernetes cluster
        
        new k8s.serviceAccount.ServiceAccount(this, 'AwsLbcServiceAccount', {
            provider: this.k8sProvider,
            metadata: {
                name: 'external-dns',
                namespace: 'default',
                annotations: {
                    'eks.amazonaws.com/role-arn': externalDNSRole.arn
                }
            },
            dependsOn: [externalDNSRole]
        });

        // Step 5: Deploy ExternalDNS

        new k8s.clusterRole.ClusterRole(this, 'ExternalDNSClusterRole', {
            provider: this.k8sProvider,
            metadata: {
                name: 'external-dns',
            },
            rule: [
                {
                    apiGroups: [''],
                    resources: ['services', 'endpoints', 'pods'],
                    verbs: ['get', 'watch', 'list'],
                },
                {
                    apiGroups: ['extensions', 'networking.k8s.io'],
                    resources: ['ingresses'],
                    verbs: ['get', 'watch', 'list'],
                },
                {
                    apiGroups: [''],
                    resources: ['nodes'],
                    verbs: ['list', 'watch'],
                }
            ]
        });

        new k8s.clusterRoleBinding.ClusterRoleBinding(this, 'ExternalDNSClusterRoleBinding', {
            provider: this.k8sProvider,
            metadata: {
                name: 'external-dns-viewer',
            },
            roleRef: {
                apiGroup: 'rbac.authorization.k8s.io',
                kind: 'ClusterRole',
                name: 'external-dns',
            },
            subject: [
                {
                    kind: 'ServiceAccount',
                    name: 'external-dns',
                    namespace: 'default',
                }
            ]
        });

        const hostedZone = new aws.dataAwsRoute53Zone.DataAwsRoute53Zone(this, 'HostedZone', {
            name: 'dsurecorder.dylanschlager.com',
            provider: this.awsProvider
        });

        new k8s.deployment.Deployment(this, 'ExternalDNSDeployment', {
            provider: this.k8sProvider,
            metadata: {
                name: 'external-dns',
                namespace: 'default',
            },
            spec: {
                strategy: {
                    type: 'Recreate',
                },
                selector: {
                    matchLabels: {
                        app: 'external-dns',
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            app: 'external-dns',
                        },
                    },
                    spec: {
                        serviceAccountName: 'external-dns',
                        container: [
                            {
                                name: 'external-dns',
                                image: 'k8s.gcr.io/external-dns/external-dns:v0.10.2',
                                args: [
                                    '--source=service',
                                    '--source=ingress',
                                    '--domain-filter=dsurecorder.dylanschlager.com', // will make ExternalDNS see only the hosted zones matching provided domain, omit to process all available hosted zones
                                    '--provider=aws',
                                    '--policy=upsert-only', // would prevent ExternalDNS from deleting any records, omit to enable full synchronization
                                    '--aws-zone-type=public', // only look at public hosted zones (valid values are public, private or no value for both)
                                    '--registry=txt',
                                    `--txt-owner-id=${hostedZone.id}`,
                                ]
                            }
                        ],
                        securityContext: {
                            fsGroup: '65534',
                        }
                    }
                }
            }
        });



    }
}