import { Construct } from "constructs";
import { App, TerraformStack } from "cdktf";
import { ClusterProps, Cluster } from "./cluster";
import { NodeGroup, NodeGroupProps } from "./nodegroup";
import { AWSLoadBalancerController, AWSLoadBalancerControllerProps } from "./awslbc"
import { ExternalDNSProps, ExternalDNS } from "./externaldns";
// import { TwentyFortyEight } from "./k8s";
import { KubernetesProvider } from "@cdktf/provider-kubernetes/lib/provider";
import { AwsPcaIssuer, AwsPcaIssuerProps } from "./aws-pca-issuer";

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
    console.log(`Got k8s provider alias: ${k8sprovider.alias}`);

    // new Kubernetes(this, "cdktf-dylan-eks-k8s", {
    //   provider: k8sprovider,
    //   clusterName: cluster.clusterName,
    //   createDeployment: true
    // });

    const awslbcProps: AWSLoadBalancerControllerProps = {
      k8sProvider: k8sprovider,
      cluster: cluster.cluster,
      awsProvider: cluster.awsProvider
    };

    new AWSLoadBalancerController(this, "cdktf-dylan-eks-awslbc", awslbcProps);

    const externalDNSProps: ExternalDNSProps = {
      k8sProvider: k8sprovider,
      cluster: cluster.cluster,
      awsProvider: cluster.awsProvider
    }

    new ExternalDNS(this, "cdktf-dylan-eks-externaldns", externalDNSProps);

    const awsPcaIssuerProps: AwsPcaIssuerProps = {
      k8sProvider: k8sprovider,
      cluster: cluster.cluster,
      awsProvider: cluster.awsProvider
    }

    // Don't think we need the private cert authority for this
    new AwsPcaIssuer(this, "cdktf-dylan-eks-awspcaissuer", awsPcaIssuerProps);

  }
}

const app = new App();
new MyStack(app, "cdktf-eks");
app.synth();
