import { Construct } from "constructs";
import { App, TerraformOutput, TerraformStack } from "cdktf";
import { ClusterProps, Cluster } from "./cluster";
import { NodeGroup, NodeGroupProps } from "./nodegroup";
import { AWSLoadBalancerController, AWSLoadBalancerControllerProps } from "./awslbc"
import { Kubernetes } from "./k8s";
import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import { DataKubernetesAllNamespaces } from "@cdktf/provider-kubernetes/lib/data-kubernetes-all-namespaces";

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

    const k8sprovider: KubernetesProvider = cluster.k8sProvider as KubernetesProvider;

    // Use provider to get k8s resources
    const nameSpacesWithProvider: DataKubernetesAllNamespaces = new DataKubernetesAllNamespaces(this, "cdktf-dylan-eks-ns", {
      provider: k8sprovider,
    })
    
    // TODO: add k8s resources
    //       this provider object can be used to do k8s deployments with cdktf
    console.log(`Got k8s provider alias: ${k8sprovider.alias}`);

    new TerraformOutput(this, "KubectlNamespaces", {
      value: nameSpacesWithProvider.namespaces
    });

    new Kubernetes(this, "cdktf-dylan-eks-k8s", {
      provider: k8sprovider,
      clusterName: cluster.clusterName,
      createDeployment: true
    });

    const awslbcProps: AWSLoadBalancerControllerProps = {
      k8sProvider: k8sprovider,
      cluster: cluster.cluster,
      awsProvider: cluster.awsProvider,
    };

    new AWSLoadBalancerController(this, "cdktf-dylan-eks-awslbc", awslbcProps);
  }
}

const app = new App();
new MyStack(app, "cdktf-eks");
app.synth();
