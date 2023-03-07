import { EksNodeGroup } from "@cdktf/provider-aws/lib/eks-node-group";
import { IamPolicyAttachment } from "@cdktf/provider-aws/lib/iam-policy-attachment";
import { IamRole } from "@cdktf/provider-aws/lib/iam-role";
import { ITerraformDependable } from "cdktf";
import { Construct } from "constructs";

export interface NodeScalingConfig {
    readonly minCapacity?: number;
    readonly desiredCapacity?: number;
    readonly maxCapacity?: number;
}

export enum NodeCapacityType {
    ON_DEMAND = 'ON_DEMAND',
    SPOT = 'SPOT'
}

export interface NodeGroupBaseProps {
    readonly nodeIAMRole?: string;
    readonly nodeScalingConfig?: NodeScalingConfig;
    readonly nodeCapacityType?: NodeCapacityType;
    readonly instanceTypes?: string[];
    readonly dependsOn?: ITerraformDependable[];
}

// Why do we need this?
// export interface NodeGroupSubnetProps extends NodeGroupBaseProps {
//     readonly subnetIds: string[];
// }

export interface NodeGroupProps extends NodeGroupBaseProps {
    readonly clusterName: string;
    readonly subnets: string[];
    readonly tags?: { [key: string]: string };
}

export class NodeGroup extends Construct {
    readonly nodeGroupIAMRole: string;
    private readonly minCapacity: number;
    private readonly desiredCapacity: number;
    private readonly maxCapacity: number;
    private readonly clusterName: string;
    private readonly tags: { [key: string]: string };
    constructor(scope: Construct, id: string, props: NodeGroupProps) {
        super(scope, id);

        this.clusterName = props.clusterName;

        this.minCapacity = props.nodeScalingConfig?.minCapacity ?? 0;
        this.desiredCapacity = props.nodeScalingConfig?.desiredCapacity ?? this.minCapacity;
        this.maxCapacity = props.nodeScalingConfig?.maxCapacity ?? (this.desiredCapacity > 0) ? this.desiredCapacity : 1;

        this.nodeGroupIAMRole = props.nodeIAMRole ?? this._createNodeGroupIAMRole().arn;

        this.tags = props.tags ?? {};
        

        new EksNodeGroup(this, 'NodeGroup', {
            nodeGroupNamePrefix: `${this.clusterName}-NodeGroup`,
            clusterName: this.clusterName,
            nodeRoleArn: this.nodeGroupIAMRole,
            subnetIds: props.subnets,
            scalingConfig: {
                desiredSize: this.desiredCapacity,
                maxSize: this.maxCapacity,
                minSize: this.minCapacity,
            },
            capacityType: props.nodeCapacityType ?? NodeCapacityType.ON_DEMAND,
            instanceTypes: props.instanceTypes ?? ['t3.medium'],
            dependsOn: props.dependsOn,
            tags: this.tags,
        })

    }

    private _createNodeGroupIAMRole(): IamRole {
        const role = new IamRole(this, 'NodeGroupRole', {
            name: `${this.clusterName}-NodeGroup-Role`,
            assumeRolePolicy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: 'sts:AssumeRole',
                        Principal: {
                            Service: 'ec2.amazonaws.com',
                        },
                    },
                ]
            }),
            tags: this.tags,
        });
        new IamPolicyAttachment(this, 'AmazonEksWorkerNodePolicyAttachment', {
            name: `${this.clusterName}-AmazonEksWorkerNodePolicy-Attachment`,
            policyArn: 'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
            roles: [role.name],
        });
        new IamPolicyAttachment(this, 'AmazonEksCniPolicyAttachment', {
            name: `${this.clusterName}-AmazonEksCniPolicy-Attachment`,
            policyArn: 'arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
            roles: [role.name],
        });
        new IamPolicyAttachment(this, 'AmazonEC2ContainerRegistryReadOnlyAttachment', {
            name: `${this.clusterName}-AmazonEC2ContainerRegistryReadOnly-Attachment`,
            policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
            roles: [role.name],
        });
        return role;
    }
}