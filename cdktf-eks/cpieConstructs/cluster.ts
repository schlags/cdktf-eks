import { S3Backend, ITerraformDependable, Token, TerraformOutput } from 'cdktf';
import { Construct } from 'constructs';
import * as awsVpcModule from '../.gen/modules/vpc';
import { EksCluster } from '@cdktf/provider-aws/lib/eks-cluster';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { DataAwsAvailabilityZones } from '@cdktf/provider-aws/lib/data-aws-availability-zones';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicyAttachment } from '@cdktf/provider-aws/lib/iam-policy-attachment';
import { DataAwsSubnets } from '@cdktf/provider-aws/lib/data-aws-subnets';
import { DataAwsEksClusterAuth } from '@cdktf/provider-aws/lib/data-aws-eks-cluster-auth';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider';


/** 
 * These are the property types for the cluster as a public interface.
 */

export interface ClusterProps {
    readonly region?: string;
    readonly clusterName?: string;
    readonly publicSubnets?: string[];
    readonly privateSubnets?: string[];
    readonly s3Backend?: boolean;
    readonly s3Bucket?: string;
    readonly s3Key?: string;
    readonly awsProvider?: AwsProvider;
    readonly tags?: { [key: string]: string };
}

export class Cluster extends Construct {
    readonly props: ClusterProps;
    readonly publicSubnets: string[];
    readonly privateSubnets: string[];
    readonly clusterName: string;
    readonly cluster: EksCluster;
    readonly vpc?: any;
    readonly vpcId?: string;
    readonly awsProvider?: any;
    readonly k8sProvider?: any;
    private readonly region: string;
    readonly tags: { [key: string]: string };

    constructor(scope: Construct, id: string, props: ClusterProps) {
        super(scope, id);

        this.props = props;
        this.region = props.region ?? 'us-east-1';

        // set tags
        this.tags = props.tags ?? {};

        if (props.awsProvider) {
            this.awsProvider = props.awsProvider;
        } else {
            this.awsProvider = new AwsProvider(this, 'aws', { region: this.region });
        }

        if (props.s3Backend) {
            new S3Backend(this, {
                bucket: props.s3Bucket ?? 'dylan-test-terraform-bucket',
                key: props.s3Key ?? 'cdktf/cdktf-eks.tfstate',
                region: this.region ?? 'us-east-1',
            });
        }

        // no subnets given - create VPC
        if (!props.privateSubnets) {
            const vpc = this._createVpc();
            this.vpc = vpc;
            this.vpcId = Token.asString(vpc.vpcIdOutput);
            this.publicSubnets = Token.asList(vpc.publicSubnetsOutput);
            this.privateSubnets = Token.asList(vpc.privateSubnetsOutput);
        } else {
            this.publicSubnets = props.publicSubnets ?? [];
            this.privateSubnets = props.privateSubnets!;
        }

        // create cluster
        this.clusterName = props.clusterName ?? `${id}-cdktf-cluster`;
        const cluster = new EksCluster(this, 'EksCluster', {
            name: this.clusterName,
            vpcConfig: {
                //associate all available subnets
                subnetIds: this.vpcId ? this.getAllSubnetsFromVpcId(this.vpcId, [this.vpc]).ids :
                    this.privateSubnets.concat(this.publicSubnets)
            },
            roleArn: this._createClusterRole().arn,
            tags: this.tags
        });
        this.cluster = cluster;

        // ensure cluster is created after the vpc
        if (this.vpc) {
            cluster.node.addDependency('depends_on', [this.vpc]);
        }
        
        // create kubernetes provider

        let cert = `\${base64decode(${cluster.certificateAuthority.get(0).data})}`

        const clusterAuth = new DataAwsEksClusterAuth(this, 'EksClusterAuth', {
            name: this.clusterName,
            dependsOn: [cluster]
        });

        this.k8sProvider = new KubernetesProvider(this, 'K8sProvider', {
            host: cluster.endpoint,
            token: clusterAuth.token,
            alias: this.clusterName,
        });
        this.k8sProvider.addOverride('cluster_ca_certificate', cert);
        

        // Provide TerraformOutput for aws eks cluster configuration command

        new TerraformOutput(this, 'AWSEKSCliCommand', {
            value: `aws eks --region ${this.region} update-kubeconfig --name ${this.clusterName} --alias ${this.clusterName}`,
        });
        


    }

    private _createVpc() {
        const vpc = new awsVpcModule.Vpc(this, 'Vpc', {
            name: 'cdktf-eks-vpc',
            cidr: '10.143.128.0/18',
            azs: new DataAwsAvailabilityZones(this, 'AZs', {
                state: 'available',
            }).names,
            publicSubnets: ['10.143.128.0/21', '10.143.136.0/21'],
            publicSubnetTags: {
                'kubernetes.io/role/elb': '1'
            },
            privateSubnets: ['10.143.144.0/21', '10.143.152.0/21'],
            privateSubnetTags: {
                'kubernetes.io/role/internal-elb': '1'
            },
            singleNatGateway: true,
            enableNatGateway: true,
            oneNatGatewayPerAz: false,
            tags: this.tags
        });
        return vpc;
    }

    private getAllSubnetsFromVpcId(vpcId: string, dependable?: ITerraformDependable[]) {
        return new DataAwsSubnets(this, 'subnets', {
            filter : [{
                name: 'vpc-id',
                values: [vpcId]
            }],
            dependsOn: dependable
        })
    }

    private _createClusterRole(): IamRole {
        const role = new IamRole(this, 'EksClusterRole', {
            name: `${this.clusterName}-role`,
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Action: 'sts:AssumeRole',
                        Effect: 'Allow',
                        Principal: {
                            Service: 'eks.amazonaws.com'
                        }
                    }
                ]
            }),
            tags: this.tags
        });
        new IamPolicyAttachment(this, 'EksClusterPolicyAttachment', {
            name: `${this.clusterName}-policy-attachment`,
            roles: [role.name],
            policyArn: 'arn:aws:iam::aws:policy/AmazonEKSClusterPolicy'
        });
        new IamPolicyAttachment(this, 'EKSVPCResourceControllerAttachment', {
            name: `${this.clusterName}-vpc-resource-controller-attachment`,
            roles: [role.name],
            policyArn: 'arn:aws:iam::aws:policy/AmazonEKSVPCResourceController'
        });
        return role;
    }
}