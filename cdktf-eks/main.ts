import { Construct } from "constructs";
import { App, TerraformStack } from "cdktf";
import { ClusterProps, Cluster } from "./cluster";

class MyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const clusterProps: ClusterProps = {
      region: "us-east-1",
      clusterName: "cdktf-dylan-eks-cluster",
      s3Backend: true,
    }

    const cluster = new Cluster(this, "cdktf-dylan-eks-cluster", clusterProps);
    console.log(cluster.cluster.arn);
  }
}

const app = new App();
new MyStack(app, "cdktf-eks");
app.synth();
