import { ServiceAccount } from '@cdktf/provider-kubernetes/lib/service-account';
import { Construct } from 'constructs';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import * as fs from 'fs';
import * as path from 'path';
import { Fn, TerraformOutput } from 'cdktf';
import { ITerraformDependable } from 'cdktf';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { EksCluster } from '@cdktf/provider-aws/lib/eks-cluster';

export interface K8sIAMServiceAccountPropsBase {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly cluster: EksCluster;
    readonly tags?: {[key: string]: string};
}

export interface IAMPolicyFileProps {
    readonly policyDocFileLocation: string;
    readonly policyDocFileName: string;
}

export interface ServiceAccountManifestProps {
    readonly labels?: {[key: string]: string};
    readonly excludeRoleArnAnnotation?: boolean;
    readonly extraAnnotations?: {[key: string]: string};
}

export interface K8sIAMServiceAccountProps extends K8sIAMServiceAccountPropsBase {
    readonly namespace?: string;
    readonly name: string;
    readonly policyName?: string;
    readonly dependsOn?: ITerraformDependable[];
    readonly iamPolicyFileProps?: IAMPolicyFileProps;
    readonly serviceAccountManifestProps?: ServiceAccountManifestProps;
}

export class K8sIAMServiceAccount extends Construct {
    readonly k8sProvider: KubernetesProvider;
    readonly awsProvider: AwsProvider;
    readonly namespace: string;
    readonly name: string;
    readonly policyName: string;
    readonly tags: {[key: string]: string};
    readonly dependsOn?: ITerraformDependable[];
    readonly iamPolicyFileProps?: IAMPolicyFileProps;
    readonly serviceAccountManifestProps?: ServiceAccountManifestProps;

    readonly cluster: EksCluster;
    readonly clusterName: string;
    readonly issuerUrl: string;

    readonly awsAccountId?: string;

    readonly iamRole?: IamRole;
    readonly iamPolicy?: IamPolicy;
    readonly serviceAccount?: ServiceAccount;

    readonly saAnnotations?: {[key: string]: string};
    readonly saLabels?: {[key: string]: string};

    readonly dependables: ITerraformDependable[] = [];

    constructor(scope: Construct, id: string, props: K8sIAMServiceAccountProps) {
        super(scope, id);

        // Required props
        this.k8sProvider = props.k8sProvider;
        this.awsProvider = props.awsProvider;
        this.name = props.name;
        this.cluster = props.cluster;

        // Cluster Variables
        this.clusterName = this.cluster.name;
        this.issuerUrl = Fn.replace(this.cluster.identity.get(0).oidc.get(0).issuer, 'https://', '');

        // Optional props
        this.namespace = props.namespace ?? 'default';
        this.tags = props.tags ?? {};
        this.dependsOn = props.dependsOn ?? [];
        this.policyName = props.policyName ?? `${this.clusterName}-${this.name}-policy`.substring(0, 128);
        

        // Optional IAM Policy File props
        props.iamPolicyFileProps ? this.iamPolicyFileProps = props.iamPolicyFileProps : this.iamPolicyFileProps = {
            policyDocFileName: `${this.policyName}.json`,
            policyDocFileLocation: path.join(__dirname, 'iam-policy-docs')
        };

        // Optional Service Account Manifest props
        props.serviceAccountManifestProps ? this.serviceAccountManifestProps = props.serviceAccountManifestProps : this.serviceAccountManifestProps = {
            labels: {},
            extraAnnotations: {}
        };

        // Get AWS Account ID
        this.awsAccountId = new DataAwsCallerIdentity(this, `dataAwsAcct-${Date.now()}`, {
            provider: this.awsProvider
        }).accountId;

        // Create IAM Role
        this.iamRole = new IamRole(this, `${this.name}-role`, {
            // Ensure role name is less than 128 characters
            name: `${this.clusterName}-${this.name}-role`.substring(0, 128),
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: 'sts:AssumeRoleWithWebIdentity',
                        Principal: {
                            Federated: `arn:aws:iam::${this.awsAccountId}:oidc-provider/${this.issuerUrl}`
                        },
                        Condition: {
                            StringEquals: {
                                [`${this.issuerUrl}:aud`]: 'sts.amazonaws.com',
                                [`${this.issuerUrl}:sub`]: `system:serviceaccount:${this.namespace}:${this.name}`
                            }
                        }
                    }
                ]
            }),
            tags: this.tags,
            dependsOn: this.dependsOn
        });
        this.dependables.push(this.iamRole);

        // Create IAM Policy
        const iamPolicyDoc: string = fs.readFileSync(path.join(this.iamPolicyFileProps.policyDocFileLocation, this.iamPolicyFileProps.policyDocFileName), 'utf8');
        this.iamPolicy = new IamPolicy(this, `${this.name}-policy`, {
            name: this.policyName,
            policy: iamPolicyDoc,
            tags: this.tags,
        });
        this.dependables.push(this.iamPolicy);

        // Attach IAM Policy to IAM Role
        new IamRolePolicyAttachment(this, `${this.name}-policy-attachment`, {
            role: this.iamRole.name,
            policyArn: this.iamPolicy.arn,
        });

        // Create K8s Service Account

        // Create Service Account Annotations and Labels
        if (this.serviceAccountManifestProps.excludeRoleArnAnnotation) {
            this.saAnnotations = this.serviceAccountManifestProps.extraAnnotations;
        } else {
            this.saAnnotations = {
                'eks.amazonaws.com/role-arn': this.iamRole.arn,
                ...this.serviceAccountManifestProps.extraAnnotations
            };
        }
        

        // if labels are provided, add them to the saLabels object
        if (this.serviceAccountManifestProps.labels) {
            this.saLabels = {
                // add any default labels here
                ...this.serviceAccountManifestProps.labels
            };
        }

        this.serviceAccount = new ServiceAccount(this, `${this.name}-sa`, {
            provider: this.k8sProvider,
            metadata: {
                name: this.name,
                namespace: this.namespace,
                labels: this.saLabels,
                annotations: this.saAnnotations
            },
            dependsOn: this.dependsOn
        });
        this.dependables.push(this.serviceAccount);

        new TerraformOutput(this, `${this.name}-IamRoleArnOutput`, {
            value: this.iamRole?.arn
        });
    }

}