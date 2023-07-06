import { EksCluster } from "@cdktf/provider-aws/lib/eks-cluster";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import { Construct } from "constructs";
// import { Fn, TerraformOutput } from "cdktf";
// import * as fs from 'fs';
// import * as path from 'path';
// import * as aws from "@cdktf/provider-aws"
// import * as k8s from "@cdktf/provider-kubernetes"
// import * as helm from "@cdktf/provider-helm"
// import { DataAwsCallerIdentity } from "@cdktf/provider-aws/lib/data-aws-caller-identity";

export interface AwsPcaIssuerProps {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
}

export class AwsPcaIssuer extends Construct {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
    constructor(scope: Construct, id: string, props: AwsPcaIssuerProps) {
        super(scope, id);
        this.k8sProvider = props.k8sProvider;
        this.awsProvider = props.awsProvider;
        this.cluster = props.cluster;

        // TODO: put eks iam service account creation into a separate construct

        // Create variables for OIDC provider urls (with and without https:// and in arn format)

        // const awsIdentity = new DataAwsCallerIdentity(this, 'AwsIdentity', {
        //     provider: this.awsProvider
        // });
        // // const issuerUrl: string = this.cluster.identity.get(0).oidc.get(0).issuer;
        // const issuerNoHttps = Fn.replace(this.cluster.identity.get(0).oidc.get(0).issuer, 'https://', '');
        // const oidcArn = `arn:aws:iam::${awsIdentity.accountId}:oidc-provider/${issuerNoHttps}`;

        // // Create the IAM service account for pca-issuer
        // // Step 1: Create the IAM policy (document and policy itself)

        // const pcaPolicyDoc: string = fs.readFileSync(path.join(__dirname, 'iam-policy-docs/pca-policy.json'), 'utf8');
        // const pcaPolicy = new aws.iamPolicy.IamPolicy(this, 'PcaPolicy', {
        //     name: `${this.cluster.name}-pca-policy`,
        //     description: `IAM policy for PCA Issuer service account in ${this.cluster.name} EKS cluster`,
        //     policy: pcaPolicyDoc
        // });

        // // Step 2: Create the IAM role

        // const pcaRole = new aws.iamRole.IamRole(this, 'PcaRole', {
        //     name: `${this.cluster.name}-pca-role`,
        //     description: `IAM role for PCA Issuer service account in ${this.cluster.name} EKS cluster`,
        //     assumeRolePolicy: JSON.stringify({
        //         Version: '2012-10-17',
        //         Statement: [
        //             {
        //                 Action: 'sts:AssumeRoleWithWebIdentity',
        //                 Effect: 'Allow',
        //                 Principal: {
        //                     Federated: oidcArn,
        //                 },
        //                 Condition: {
        //                     StringEquals: {
        //                         [`${issuerNoHttps}:aud`]: 'sts.amazonaws.com',
        //                         [`${issuerNoHttps}:sub`]: 'system:serviceaccount:aws-pca-issuer:aws-pca-issuer',
        //                     }
        //                 }
        //             },
        //         ]
        //     }),
        // });

        // // Step 3: Attach the IAM policy to the IAM role
        // new aws.iamRolePolicyAttachment.IamRolePolicyAttachment(this, 'PcaRolePolicyAttachment', {
        //     role: pcaRole.name,
        //     policyArn: pcaPolicy.arn
        // });

        // // Step 4: Create the IAM service account in the EKS cluster
        // // First create the namespace aws-pca-issuer

        // const pcaNamespace = new k8s.namespace.Namespace(this, 'AwsPcaIssuerNamespace', {
        //     provider: this.k8sProvider,
        //     metadata: {
        //         name: 'aws-pca-issuer'
        //     }
        // });

        // new k8s.serviceAccount.ServiceAccount(this, 'AwsLbcServiceAccount', {
        //     provider: this.k8sProvider,
        //     metadata: {
        //         name: 'aws-pca-issuer',
        //         namespace: pcaNamespace.metadata.name,
        //         annotations: {
        //             'eks.amazonaws.com/role-arn': pcaRole.arn
        //         }
        //     },
        //     dependsOn: [pcaRole]
        // });

        // Install the PCA Issuer Helm chart
        // STEP 1: Create the Helm provider
        // new helm.provider.HelmProvider(this, 'HelmProvider', {
        //     alias: 'pca-helm-provider',
        //     kubernetes: {
        //         host: this.k8sProvider.host,
        //         clusterCaCertificate: this.k8sProvider.clusterCaCertificate,
        //         exec: {
        //             apiVersion: 'client.authentication.k8s.io/v1beta1',
        //             args: ["eks", "get-token", "--cluster-name", this.cluster.name],
        //             command: 'aws',
        //         },
        //         // TODO: investigate why 509 error is thrown when using token
        //         insecure: true
        //     },
        // });

    //     // STEP 2: Create the Helm release
    //     new helm.release.Release(this, 'PcaIssuerHelmRelease', {
    //         provider: helmProvider,
    //         name: 'aws-pca-issuer',
    //         chart: 'aws-pca-issuer',
    //         namespace: pcaNamespace.metadata.name,
    //         repository: 'https://cert-manager.github.io/aws-privateca-issuer',
    //         set: [
    //             {
    //                 name: 'serviceAccount.create',
    //                 value: 'false'
    //             },
    //             {
    //                 name: 'serviceAccount.name',
    //                 value: 'aws-pca-issuer'
    //             }
    //         ]
    //     });
    }
}