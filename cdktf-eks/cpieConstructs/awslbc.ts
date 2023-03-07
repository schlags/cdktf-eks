import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import * as helm from "@cdktf/provider-helm"
import * as aws from "@cdktf/provider-aws"
import * as tls from "@cdktf/provider-tls"
import { Construct } from "constructs";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { EksCluster } from "@cdktf/provider-aws/lib/eks-cluster";

import {K8sIAMServiceAccount} from './k8sIAMServiceAccount'

export interface AWSLoadBalancerControllerProps {
    readonly k8sProvider: KubernetesProvider;
    readonly helmProvider: helm.provider.HelmProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
    readonly domainPath: string;
    readonly tags?: {[key: string]: string};
}

export class AWSLoadBalancerController extends Construct {
    readonly k8sProvider: KubernetesProvider;
    readonly helmProvider: helm.provider.HelmProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
    readonly domainPath: string;
    readonly tags: {[key: string]: string};
    constructor(scope: Construct, id: string, props: AWSLoadBalancerControllerProps) {
        super(scope, id);
        this.k8sProvider = props.k8sProvider;
        this.helmProvider = props.helmProvider;
        this.awsProvider = props.awsProvider;
        this.cluster = props.cluster;
        this.domainPath = props.domainPath;

        // set tags
        this.tags = props.tags ?? {};


        // Create iam oidc provider for eks cluster
        const issuerUrl: string = this.cluster.identity.get(0).oidc.get(0).issuer;
        

        const idpConfig = new aws.eksIdentityProviderConfig.EksIdentityProviderConfig (this, 'EksIdentityProviderConfig', {
            clusterName: this.cluster.name,
            oidc: {
                clientId: 'sts.amazonaws.com',
                identityProviderConfigName: `cdktf-oidc`,
                issuerUrl: issuerUrl,
            },
            dependsOn: [this.cluster],
            tags: this.tags
        });

        // Now create the oidc provider in IAM with the thumbprint of the issuer url using a tls provider object

        const openIdThumbprint = new tls.dataTlsCertificate.DataTlsCertificate(this, 'OpenIdThumbprint', {
            provider: new tls.provider.TlsProvider(this, 'TlsProvider', {}),
            url: issuerUrl
        });

        new aws.iamOpenidConnectProvider.IamOpenidConnectProvider(this, 'OidcProvider', {
            url: issuerUrl,
            clientIdList: ['sts.amazonaws.com'],
            thumbprintList: [openIdThumbprint.certificates.get(0).sha1Fingerprint],
            tags: this.tags
        });

        // Create k8sIAMServiceAccount for aws load balancer controller

        const awslbcServiceAccount = new K8sIAMServiceAccount(this, 'AwsLbcServiceAccount', {
            k8sProvider: this.k8sProvider,
            awsProvider: this.awsProvider,
            cluster: this.cluster,
            tags: this.tags,
            name: 'aws-load-balancer-controller',
            namespace: 'kube-system',
            iamPolicyFileProps: {
                policyDocFileLocation: 'iam-policy-docs',
                policyDocFileName: 'alb-controller-policy.json'
            },
            serviceAccountManifestProps: {
                labels: {
                    'app.kubernetes.io/name': 'aws-load-balancer-controller',
                    'app.kubernetes.io/component': 'controller'
                }
            },
            dependsOn: [idpConfig]
        });

        const AWSlbcChart = new helm.release.Release(this, 'AwsLbcRelease', {
            provider: this.helmProvider,
            name: 'aws-load-balancer-controller',
            namespace: awslbcServiceAccount.namespace,
            chart: 'aws-load-balancer-controller',
            repository: 'https://aws.github.io/eks-charts',
            set: [
                {
                    name: 'clusterName',
                    value: this.cluster.name
                },
                {
                    name: 'serviceAccount.create',
                    value: 'false'
                },
                {
                    name: 'serviceAccount.name',
                    value: awslbcServiceAccount.name
                }
            ],
            wait: true
        });
        AWSlbcChart.node.addDependency(idpConfig, awslbcServiceAccount);

    }
}