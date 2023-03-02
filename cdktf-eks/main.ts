import { Construct } from "constructs";
import { App, TerraformStack } from "cdktf";
import { ClusterProps, Cluster } from "./cluster";
import { NodeGroup, NodeGroupProps } from "./nodegroup";
import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";

class MyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const clusterProps: ClusterProps = {
      region: "us-east-1",
      clusterName: "cdktf-dylan-eks-cluster",
      s3Backend: true,
    }

    const cluster = new Cluster(this, "cdktf-dylan-eks-cluster", clusterProps);
    
    const nodegroupProps: NodeGroupProps = {
      clusterName: cluster.clusterName,
      subnets: cluster.privateSubnets,
      dependsOn: [cluster.cluster],
      nodeScalingConfig: {
        desiredCapacity: 1,
      }
    }

    new NodeGroup(this, "cdktf-dylan-eks-nodegroup", nodegroupProps);

    const k8sprovider: KubernetesProvider = cluster.createKubenetesProvider();
    
    // TODO: add k8s resources
    //       this provider object can be used to do k8s deployments with cdktf
    console.log(`Got k8s provider alias: ${k8sprovider.alias}`);
  }
}

const app = new App();
new MyStack(app, "cdktf-eks");
app.synth();
