import { EksCluster } from "@cdktf/provider-aws/lib/eks-cluster";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import { Construct } from "constructs";
import * as aws from "@cdktf/provider-aws"
import * as k8s from "@cdktf/provider-kubernetes"
import { K8sIAMServiceAccount } from './k8sIAMServiceAccount'


export interface ExternalDNSProps {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
    readonly hostedZoneName?: string;
    readonly namespace?: string;
    readonly tags?: {[key: string]: string};
}

export class ExternalDNS extends Construct {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
    readonly hostedZoneName: string;
    readonly namespace: string;
    readonly tags: {[key: string]: string};
    constructor(scope: Construct, id: string, props: ExternalDNSProps) {
        super(scope, id);
        this.k8sProvider = props.k8sProvider;
        this.awsProvider = props.awsProvider;
        this.cluster = props.cluster;

        if (!props.hostedZoneName) {
            this.hostedZoneName = 'example.com';
        } else {
            this.hostedZoneName = props.hostedZoneName;
        }

        this.namespace = props.namespace ?? 'default';

        // set tags
        this.tags = props.tags ?? {};


        // Step 1: Create k8sIAMServiceAccount for external dns

        const externalDnsServiceAccount = new K8sIAMServiceAccount(this, 'AwsLbcServiceAccount', {
            k8sProvider: this.k8sProvider,
            awsProvider: this.awsProvider,
            cluster: this.cluster,
            tags: this.tags,
            name: 'external-dns',
            namespace: this.namespace,
            iamPolicyFileProps: {
                policyDocFileLocation: 'iam-policy-docs',
                policyDocFileName: 'externaldns-policy.json'
            }
        });

        // Step 2: Deploy ExternalDNS

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
            ],
            dependsOn: externalDnsServiceAccount.dependables
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
                    name: externalDnsServiceAccount.name,
                    namespace: this.namespace,
                }
            ],
            dependsOn: externalDnsServiceAccount.dependables
        });

        const hostedZone = new aws.dataAwsRoute53Zone.DataAwsRoute53Zone(this, 'HostedZone', {
            name: this.hostedZoneName,
            provider: this.awsProvider
        });

        new k8s.deployment.Deployment(this, 'ExternalDNSDeployment', {
            provider: this.k8sProvider,
            metadata: {
                name: 'external-dns',
                namespace: this.namespace,
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
                        serviceAccountName: externalDnsServiceAccount.name,
                        container: [
                            {
                                name: 'external-dns',
                                image: 'k8s.gcr.io/external-dns/external-dns:v0.10.2',
                                args: [
                                    '--source=service',
                                    '--source=ingress',
                                    `--domain-filter=${this.hostedZoneName}`, // will make ExternalDNS see only the hosted zones matching provided domain, omit to process all available hosted zones
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
            },
            dependsOn: externalDnsServiceAccount.dependables
        });

    }
}