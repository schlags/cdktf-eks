import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Construct } from 'constructs';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import * as path from 'path';
import * as fs from 'fs';
import { IamOpenidConnectProvider } from '@cdktf/provider-aws/lib/iam-openid-connect-provider';
import { DataTlsCertificate } from '@cdktf/provider-tls/lib/data-tls-certificate';
import { TlsProvider } from '@cdktf/provider-tls/lib/provider';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { TerraformOutput } from 'cdktf';

const GITHUB_ACTIONS_OIDC_PROVIDER_URL = 'token.actions.githubusercontent.com';

export interface GitHubActionsOIDCBaseProps {
    readonly awsProvider: AwsProvider;
}

export interface GitHubRepositoryDetails {
    readonly name: string;
    readonly owner: string;
}

export interface IAMPolicyFileProps {
    readonly policyDocFileLocation: string;
    readonly policyDocFileName: string;
}

export interface GitHubActionsOIDCProps extends GitHubActionsOIDCBaseProps {
    readonly iamPolicyFileProps?: IAMPolicyFileProps;
    readonly githubRepositoryDetails: GitHubRepositoryDetails;
    readonly tlsProvider?: TlsProvider;
    readonly tags?: {[key: string]: string};
}

export class GitHubActionsOIDC extends Construct {
    readonly awsProvider: AwsProvider;
    readonly githubRepositoryName: string;
    readonly githubRepositoryOwner: string;
    readonly tlsProvider: TlsProvider;
    readonly iamRolePolicyDocument: string;
    readonly tags: {[key: string]: string};

    iamRole?: IamRole;
    iamPolicy?: IamPolicy;
    openIdConnectProvider?: IamOpenidConnectProvider;

    constructor(scope: Construct, name: string, props: GitHubActionsOIDCProps) {
        super(scope, name);

        this.awsProvider = props.awsProvider;
        this.githubRepositoryName = props.githubRepositoryDetails.name;
        this.githubRepositoryOwner = props.githubRepositoryDetails.owner;

        this.tlsProvider = props.tlsProvider ?? new TlsProvider(this, 'GitHubActionsOIDCTlsProvider', {});

        this.tags = props.tags ?? {};

        props.iamPolicyFileProps ? this.iamRolePolicyDocument = fs.readFileSync(path.join(props.iamPolicyFileProps!.policyDocFileLocation, props.iamPolicyFileProps!.policyDocFileName), 'utf8')
            : this.iamRolePolicyDocument = JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: '*',
                        Resource: '*'
                    }
                ]
            });

        this.openIdConnectProvider = this.createOIDCProvider();
        this.iamRole = this.createIAMRole();
    }

    createOIDCProvider() {
        const openIdThumbprint = new DataTlsCertificate(this, 'GitHubActionsOIDCProviderThumbprint', {
            provider: this.tlsProvider,
            url: `https://${GITHUB_ACTIONS_OIDC_PROVIDER_URL}`
        });
        return new IamOpenidConnectProvider(this, 'GitHubActionsOIDCProvider', {
            url: `https://${GITHUB_ACTIONS_OIDC_PROVIDER_URL}`,
            clientIdList: ['sts.amazonaws.com'],
            thumbprintList: [openIdThumbprint.certificates.get(0).sha1Fingerprint]
        });
    }

    createIAMRole() {
        const openIdConnectProviderArn = this.openIdConnectProvider?.arn;

        const iamRole = new IamRole(this, 'GitHubActionsOIDCIamRole', {
            name: `${this.githubRepositoryName}-GitHubActionsOIDCIamRole`,
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: {
                            Federated: openIdConnectProviderArn
                        },
                        Action: 'sts:AssumeRoleWithWebIdentity',
                        Condition: {
                            StringLike: {
                                [`${GITHUB_ACTIONS_OIDC_PROVIDER_URL}:sub`]: `repo:${this.githubRepositoryOwner}/${this.githubRepositoryName}:*`
                            },
                            'ForAllValues:StringEquals': {
                                [`${GITHUB_ACTIONS_OIDC_PROVIDER_URL}:aud`]: 'sts.amazonaws.com',
                                [`${GITHUB_ACTIONS_OIDC_PROVIDER_URL}:iss`]: `https://${GITHUB_ACTIONS_OIDC_PROVIDER_URL}`
                            }
                        }
                    }
                ]
            }),
            tags: this.tags
        });

        new IamRolePolicy(this, 'GitHubActionsOIDCIamRolePolicy', {
            name: `${this.githubRepositoryName}-GitHubActionsOIDCIamRolePolicy`.substring(0, 128),
            role: iamRole.name,
            policy: this.iamRolePolicyDocument
        })

        new TerraformOutput(this, 'GitHubActionsOIDCIamRoleArn', {
            value: iamRole.arn
        });

        return iamRole;
    }
}